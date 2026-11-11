/* PDFdukan — PDF to Word converter (editable .docx, with OCR for scanned pages)
 * Everything runs in the browser:
 *  - pdf.js reads the text layer, fonts, links and images of each page
 *  - Tesseract.js (open-source OCR, WebAssembly) reads pages that are only a scan
 *  - JSZip writes the .docx file
 * The PDF is not uploaded. The OCR engine and language data are downloaded
 * from a public CDN the first time a scanned page is read.
 *
 * Rebuilt Nov 2026:
 *  - OCR for scanned / image-only pages (auto, all pages, or off), 37 languages + mixed, Urdu/Arabic RTL
 *  - two- and three-column pages read column by column (left column first)
 *  - lines joined into real paragraphs (no forced line breaks), hyphenated words re-joined
 *  - headings from font size, bold / italic / font size / font family kept per run
 *  - stricter table detection, real Word tables
 *  - images placed near their position, links stay clickable
 *  - password-protected PDFs, page range, cancel
 */
(function () {
  'use strict';

  var MAX_BYTES = 100 * 1024 * 1024;
  var MAX_PAGES = 300;        // pages per run
  var MAX_OCR_PAGES = 50;     // scanned pages read with OCR per run
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var RTL_LANG = /(^|\+)(urd|ara|fas|heb)(\+|$)/;
  var RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

  var st = { file: null, bytes: null, pdf: null, password: '', busy: false, cancelled: false, worker: null, out: null, base: 'document' };

  function $(id) { return document.getElementById(id); }
  function say(m, t) { if (window.toast) window.toast(m, t); }
  function size(b) { return b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }
  function escHtml(v) { var s = document.createElement('span'); s.textContent = v; return s.innerHTML; }
  function escXml(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function loadScript(src) {
    if (window.loadScriptOnce) return window.loadScriptOnce(src);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
  function progress(pct, label) {
    if (window.PDLoader && st.busy) { window.PDLoader.update(null, label || ''); return; }
    $('progressCard').style.display = 'block';
    $('progressFill').style.width = Math.max(1, Math.min(100, pct)) + '%';
    $('progressLabel').textContent = label || '';
  }
  async function ensurePdfjs() {
    if (!window.pdfjsLib) await loadScript(PDFJS_URL);
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }

  /* ── Opening the PDF ─────────────────────────────────────── */
  async function pickFile(f) {
    if (!f || st.busy) return;
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { say('Please choose a PDF file.', 'error'); return; }
    if (f.size > MAX_BYTES) { say('This PDF is over 100 MB. Split it first with Extract PDF Pages.', 'error'); return; }
    clearAll(true);
    st.file = f; st.base = f.name.replace(/\.pdf$/i, '') || 'document';
    $('p2wFileName').textContent = f.name;
    $('p2wFileMeta').textContent = size(f.size) + ' · opening…';
    $('p2wFile').hidden = false; $('dropZone').classList.add('p2w-has-file');
    try {
      await ensurePdfjs();
      st.bytes = new Uint8Array(await f.arrayBuffer());
      await openPdf('');
    } catch (e) {
      console.error(e);
      $('p2wFileMeta').textContent = size(f.size) + ' · could not be opened';
      say('"' + f.name + '" could not be opened as a PDF. It may be damaged.', 'error');
    }
  }

  async function openPdf(pw) {
    try {
      var task = window.pdfjsLib.getDocument({ data: st.bytes.slice(), password: pw || undefined, isEvalSupported: false });
      st.pdf = await task.promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        $('p2wPwRow').hidden = false;
        $('p2wFileMeta').textContent = size(st.file.size) + ' · password-protected';
        if (pw) say('That password is not correct. Try again.', 'error');
        else say('This PDF is password-protected. Type its password to open it.', 'info');
        setTimeout(function () { $('p2wPw').focus(); }, 50);
        return false;
      }
      throw e;
    }
    st.password = pw || '';
    $('p2wPwRow').hidden = true;
    var n = st.pdf.numPages;
    $('p2wFileMeta').textContent = size(st.file.size) + ' · ' + n + (n === 1 ? ' page' : ' pages') + (pw ? ' · unlocked' : '');
    $('p2wPages').placeholder = n > MAX_PAGES ? '1-' + MAX_PAGES : 'All (1-' + n + ')';
    $('p2wRunBtn').disabled = false; $('p2wClearBtn').disabled = false;
    // quick look at the first pages: tell the user if it looks scanned
    try {
      var scanned = 0, look = Math.min(n, 3);
      for (var p = 1; p <= look; p++) {
        var pg = await st.pdf.getPage(p), tc = await pg.getTextContent();
        var chars = tc.items.reduce(function (a, it) { return a + String(it.str || '').replace(/\s/g, '').length; }, 0);
        if (chars < 20 && await imageCover(pg, pg.getViewport({ scale: 1 })) >= 0.1) scanned++;
      }
      $('p2wHint').textContent = scanned === look ? 'This looks like a scanned PDF. OCR will read the text (choose the document language below).'
        : scanned ? 'Some pages look scanned. OCR will read those pages; the rest use the PDF text.' : '';
      $('p2wHint').hidden = !scanned;
    } catch (e) { $('p2wHint').hidden = true; }
    setTimeout(run, 0);   // convert right away with the default options
    return true;
  }

  function parsePages(v, n) {
    v = String(v || '').trim();
    if (!v) { var all = []; for (var i = 1; i <= n; i++) all.push(i); return { list: all.slice(0, MAX_PAGES), capped: n > MAX_PAGES }; }
    var set = {}, parts = v.split(/[,;\s]+/);
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k]; if (!p) continue;
      var m = p.match(/^(\d+)(?:-(\d*))?$/);
      if (!m) return { err: 'Type pages like 1-3, 8. "' + p + '" is not a page or range.' };
      var a = +m[1], b = m[2] === undefined ? a : (m[2] === '' ? n : +m[2]);
      if (a < 1 || b < a || a > n) return { err: 'This PDF has ' + n + ' pages. Check the range "' + p + '".' };
      for (var x = a; x <= Math.min(b, n); x++) set[x] = 1;
    }
    var list = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    return { list: list.slice(0, MAX_PAGES), capped: list.length > MAX_PAGES };
  }

  /* ── Text layer → positioned items ───────────────────────── */
  function fontInfo(page, fontName, styles) {
    var fam = (styles[fontName] && styles[fontName].fontFamily) || 'sans-serif';
    var name = '', bold = false, italic = false;
    try {
      if (page.commonObjs.has(fontName)) {
        var f = page.commonObjs.get(fontName);
        name = String(f.name || f.fallbackName || '');
        bold = !!(f.bold || f.black); italic = !!f.italic;
      }
    } catch (e) { }
    var clean = name.replace(/^[A-Z]{6}\+/, '');
    if (/bold|black|heavy|semibold|demi/i.test(clean)) bold = true;
    if (/italic|oblique/i.test(clean)) italic = true;
    return { family: mapFont(clean, fam), bold: bold, italic: italic };
  }
  function mapFont(n, fam) {
    var t = n.toLowerCase();
    if (/times|tinos|liberationserif|nimbusrom/.test(t)) return 'Times New Roman';
    if (/arial|helvetica|arimo|liberationsans|nimbussan/.test(t)) return 'Arial';
    if (/calibri|carlito/.test(t)) return 'Calibri';
    if (/cambria|caladea/.test(t)) return 'Cambria';
    if (/courier|cousine|mono/.test(t)) return 'Courier New';
    if (/georgia/.test(t)) return 'Georgia';
    if (/verdana/.test(t)) return 'Verdana';
    if (/garamond/.test(t)) return 'Garamond';
    if (/tahoma/.test(t)) return 'Tahoma';
    if (/segoe/.test(t)) return 'Segoe UI';
    if (/palatino|palladio/.test(t)) return 'Palatino Linotype';
    if (/bookman/.test(t)) return 'Bookman Old Style';
    if (/century/.test(t)) return 'Century Gothic';
    if (/^cm|computermodern|lmroman|nimbus|^sf[rbt]/.test(t)) return 'Times New Roman';
    if (fam === 'monospace') return 'Courier New';
    if (fam === 'serif') return 'Times New Roman';
    return 'Arial';
  }
  function garbled(s) {
    var bad = 0, tot = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i); if (c === 32 || c === 10 || c === 9) continue; tot++;
      if ((c >= 0xE000 && c <= 0xF8FF) || c === 0xFFFD || c < 32) bad++;
    }
    return tot > 30 && bad / tot > 0.3;
  }

  /* ── Page graphics: text colors, filled boxes, lines, drawings ── */
  function hex(c) { return ((1 << 24) + (c[0] << 16) + (c[1] << 8) + (c[2] | 0)).toString(16).slice(1).toUpperCase(); }
  function isWhite(h) { return parseInt(h.slice(0, 2), 16) > 245 && parseInt(h.slice(2, 4), 16) > 245 && parseInt(h.slice(4), 16) > 245; }
  function isBlack(h) { return parseInt(h.slice(0, 2), 16) < 40 && parseInt(h.slice(2, 4), 16) < 40 && parseInt(h.slice(4), 16) < 40; }
  function analyzeGraphics(list, vp) {
    var O = window.pdfjsLib.OPS, ctm = [1, 0, 0, 1, 0, 0], st = [], fill = [0, 0, 0], stroke = [0, 0, 0], lw = 1, trMode = 0;
    var glyphColors = [], paths = [], cur = null;
    function pt(x, y) { return vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]); }
    var last = null;
    function add(q) { if (!cur) cur = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, curves: 0, segs: 0, rects: 0, diag: 0 }; cur.x0 = Math.min(cur.x0, q[0]); cur.x1 = Math.max(cur.x1, q[0]); cur.y0 = Math.min(cur.y0, q[1]); cur.y1 = Math.max(cur.y1, q[1]); }
    var n = list.fnArray.length;
    for (var i = 0; i < n; i++) {
      var fn = list.fnArray[i], a = list.argsArray[i];
      if (fn === O.save) st.push([ctm.slice(), fill, stroke, lw]);
      else if (fn === O.restore) { var r = st.pop(); if (r) { ctm = r[0]; fill = r[1]; stroke = r[2]; lw = r[3]; } }
      else if (fn === O.transform) ctm = mul(ctm, a);
      else if (fn === O.paintFormXObjectBegin) { st.push([ctm.slice(), fill, stroke, lw]); if (a && a[0]) ctm = mul(ctm, a[0]); }
      else if (fn === O.paintFormXObjectEnd) { var r2 = st.pop(); if (r2) { ctm = r2[0]; fill = r2[1]; stroke = r2[2]; lw = r2[3]; } }
      else if (fn === O.setFillRGBColor) fill = [a[0], a[1], a[2]];
      else if (fn === O.setStrokeRGBColor) stroke = [a[0], a[1], a[2]];
      else if (fn === O.setLineWidth) lw = a[0];
      else if (fn === O.setTextRenderingMode) trMode = a[0];
      else if (fn === O.showText || fn === O.showSpacedText) {
        var col = hex(trMode === 1 ? stroke : fill), gl = a[0] || [];
        for (var g = 0; g < gl.length; g++) { var G = gl[g]; if (G && typeof G === 'object' && G.unicode) { var u = String(G.unicode).replace(/\s/g, ''); for (var c = 0; c < u.length; c++) glyphColors.push(col); } }
      }
      else if (fn === O.constructPath) {
        var ops = a[0], co = a[1], j = 0;
        for (var k = 0; k < ops.length; k++) {
          var op = ops[k];
          if (op === O.rectangle) { var x = co[j], y = co[j + 1], w = co[j + 2], h = co[j + 3]; j += 4; add(pt(x, y)); add(pt(x + w, y + h)); add(pt(x + w, y)); add(pt(x, y + h)); cur.rects++; }
          else if (op === O.moveTo) { last = pt(co[j], co[j + 1]); add(last); j += 2; }
          else if (op === O.lineTo) { var q2 = pt(co[j], co[j + 1]); add(q2); if (last && Math.abs(q2[0] - last[0]) > 0.5 && Math.abs(q2[1] - last[1]) > 0.5) cur.diag++; last = q2; j += 2; cur.segs++; }
          else if (op === O.curveTo) { add(pt(co[j], co[j + 1])); add(pt(co[j + 2], co[j + 3])); add(pt(co[j + 4], co[j + 5])); j += 6; cur.curves++; }
          else if (op === O.curveTo2 || op === O.curveTo3) { add(pt(co[j], co[j + 1])); add(pt(co[j + 2], co[j + 3])); j += 4; cur.curves++; }
        }
      }
      else if (fn === O.endPath || fn === O.clip || fn === O.eoClip) { if (fn === O.endPath) cur = null; }
      else if (fn >= O.stroke && fn <= O.closeEOFillStroke) {
        if (cur) {
          var doF = fn >= O.fill, doS = fn === O.stroke || fn === O.closeStroke || fn >= O.fillStroke;
          var sc = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) * vp.scale;
          cur.fill = doF ? hex(fill) : null; cur.stroke = doS ? hex(stroke) : null; cur.lw = Math.max(0.25, lw * sc);
          cur.rectOnly = cur.rects > 0 && !cur.segs && !cur.curves;
          paths.push(cur);
        }
        cur = null;
      }
    }
    var A = vp.width * vp.height;
    paths = paths.filter(function (q) { return (q.x1 - q.x0) * (q.y1 - q.y0) < 0.6 * A || (q.x1 - q.x0) < 3 || (q.y1 - q.y0) < 3; });
    return { glyphColors: glyphColors, paths: paths };
  }
  function inBox(x, y, b, pad) { pad = pad || 0; return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad; }
  function overlap(a, b, pad) { return a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1; }
  /* vector drawings (pen signatures, charts, shapes) → regions to keep as pictures */
  function findDrawings(g, items) {
    var thin = function (q) { return Math.min(q.x1 - q.x0, q.y1 - q.y0) < 2.5; };
    var strong = g.paths.filter(function (q) {
      if (q.rectOnly || thin(q) && !q.curves) return false;
      if (q.fill && !q.stroke && isWhite(q.fill)) return false;
      return q.curves > 0 || (q.segs >= 3 && q.diag > 0);
    });
    var cl = [];
    strong.forEach(function (q) {
      var b = { x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1, curves: q.curves + (q.segs >= 4 ? 4 : 0), n: 1 };
      for (var i = 0; i < cl.length; i++) if (overlap(cl[i], b, 10)) { var c = cl[i]; c.x0 = Math.min(c.x0, b.x0); c.y0 = Math.min(c.y0, b.y0); c.x1 = Math.max(c.x1, b.x1); c.y1 = Math.max(c.y1, b.y1); c.curves += b.curves; c.n++; return; }
      cl.push(b);
    });
    // merge clusters that now touch
    for (var a1 = cl.length - 1; a1 > 0; a1--) for (var b1 = a1 - 1; b1 >= 0; b1--) if (overlap(cl[a1], cl[b1], 10)) { var A1 = cl[a1], B1 = cl[b1]; B1.x0 = Math.min(A1.x0, B1.x0); B1.y0 = Math.min(A1.y0, B1.y0); B1.x1 = Math.max(A1.x1, B1.x1); B1.y1 = Math.max(A1.y1, B1.y1); B1.curves += A1.curves; B1.n += A1.n; cl.splice(a1, 1); break; }
    cl = cl.filter(function (c) {
      // a box or frame around ordinary text is not a drawing
      var inside = items.reduce(function (a, o) { return a + (inBox((o.x0 + o.x1) / 2, o.y - o.size * 0.4, c) ? o.str.length : 0); }, 0);
      return inside <= 120;
    });
    cl = cl.filter(function (c) { return (c.curves >= 4 || c.n >= 2) && (c.x1 - c.x0) * (c.y1 - c.y0) >= 400 && (c.x1 - c.x0) > 15 && (c.y1 - c.y0) > 8; });
    var sizes = items.map(function (o) { return o.size; }), med = median(sizes) || 10;
    cl.forEach(function (c) {
      // axes, grid lines and filled bars that touch the drawing
      g.paths.forEach(function (q) { if (overlap(c, q, 4) && (q.x1 - q.x0) < 3 * (c.x1 - c.x0 + 20)) { c.x0 = Math.min(c.x0, q.x0); c.y0 = Math.min(c.y0, q.y0); c.x1 = Math.max(c.x1, q.x1); c.y1 = Math.max(c.y1, q.y1); } });
      // small labels next to / inside the drawing belong to it
      var ob = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
      items.forEach(function (o) {
        var cx = (o.x0 + o.x1) / 2, cy = o.y - o.size * 0.4;
        if ((inBox(cx, cy, ob, 0) || (o.size < med * 0.95 && inBox(cx, cy, ob, 14))) && (o.x1 - o.x0) < (ob.x1 - ob.x0) * 0.6) { c.x0 = Math.min(c.x0, o.x0); c.x1 = Math.max(c.x1, o.x1); c.y0 = Math.min(c.y0, o.y - o.size); c.y1 = Math.max(c.y1, o.y + o.size * 0.3); }
      });
    });
    return cl;
  }

  async function readTextPage(page, vp, opts) {
    var tc = await page.getTextContent();
    var opl = null; try { opl = await page.getOperatorList(); } catch (e) { }   // also loads fonts (bold / italic / names)
    var gfx = null; try { gfx = opl ? analyzeGraphics(opl, vp) : null; } catch (e) { gfx = null; }
    var gi = 0;
    var links = [];
    try {
      (await page.getAnnotations()).forEach(function (a) {
        if (a.subtype === 'Link' && a.url && /^(https?:|mailto:)/i.test(a.url)) {
          var r = vp.convertToViewportRectangle(a.rect);
          links.push({ x0: Math.min(r[0], r[2]), x1: Math.max(r[0], r[2]), y0: Math.min(r[1], r[3]), y1: Math.max(r[1], r[3]), url: a.url });
        }
      });
    } catch (e) { }
    var items = [], rotated = [], fcache = {};
    tc.items.forEach(function (it) {
      if (!it.str || !it.transform) return;
      var t = window.pdfjsLib.Util.transform(vp.transform, it.transform);
      var sz = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
      if (!(sz > 0.5)) return;
      var f = fcache[it.fontName] || (fcache[it.fontName] = fontInfo(page, it.fontName, tc.styles));
      var w = (it.width || 0) * vp.scale;
      if (/[\uFB50-\uFDFF\uFE70-\uFEFF]/.test(it.str)) it = Object.assign({}, it, { str: it.str.replace(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g, function (c) { return c.normalize('NFKC'); }) });
      var o = { str: it.str, x0: t[4], x1: t[4] + w, y: t[5], size: sz, bold: f.bold, italic: f.italic, family: f.family, link: null, color: null, fontName: it.fontName };
      var nch = it.str.replace(/\s/g, '').length;
      if (gfx && nch && gi < gfx.glyphColors.length) { var ccol = gfx.glyphColors[gi]; if (!isBlack(ccol)) o.color = ccol; }
      gi += nch;
      if (Math.abs(t[1]) > Math.abs(t[0]) * 0.2 || Math.abs(t[2]) > Math.abs(t[3]) * 0.2) { rotated.push(o); return; }
      if (!o.str.trim()) { o.space = true; }
      var cx = (o.x0 + o.x1) / 2, cy = o.y - sz * 0.3;
      for (var k = 0; k < links.length; k++) { var L = links[k]; if (cx >= L.x0 && cx <= L.x1 && cy >= L.y0 - 2 && cy <= L.y1 + 2) { o.link = L.url; break; } }
      items.push(o);
    });
    // highlighted text: a small coloured box behind it
    if (gfx) gfx.paths.forEach(function (q) {
      if (!q.fill || !q.rectOnly || isWhite(q.fill) || (q.y1 - q.y0) > 40) return;
      items.forEach(function (o) { if (!o.hl && o.color !== q.fill && inBox((o.x0 + o.x1) / 2, o.y - o.size * 0.35, q)) o.hl = q.fill; });
    });
    var drawings = gfx ? findDrawings(gfx, items) : [];
    // Urdu Nastaleeq fonts (Jameel Noori, InPage exports) store letters in a broken order: the text layer can't be trusted
    var badUrdu = false;
    tc.items.forEach(function (it) { try { if (!badUrdu && page.commonObjs.has(it.fontName) && /nasta|jameel|noori|inpage/i.test(String(page.commonObjs.get(it.fontName).name || '')) && RTL_CHARS.test(it.str)) badUrdu = true; } catch (e) { } });
    var text = items.map(function (o) { return o.str; }).join('');
    return { badUrdu: badUrdu, gfx: gfx, drawings: drawings, items: items, rotated: rotated, chars: text.replace(/\s/g, '').length, garbled: garbled(text), cover: await imageCover(page, vp) };
  }

  /* share of the page covered by the largest image (scans are one big image) */
  async function imageCover(page, vp) {
    var OPS = window.pdfjsLib.OPS, list;
    try { list = await page.getOperatorList(); } catch (e) { return 0; }
    var ctm = [1, 0, 0, 1, 0, 0], stack = [], best = 0, A = vp.width * vp.height;
    for (var i = 0; i < list.fnArray.length; i++) {
      var fn = list.fnArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, list.argsArray[i]);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
        var a = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) / A; if (a > best) best = a;
      }
    }
    return Math.min(1, best);
  }

  /* group items into fragments: same baseline, no big horizontal gap */
  function buildFrags(items, tight) {
    var solid = items.filter(function (o) { return !o.space; });
    solid.sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; });
    var rows = [];
    solid.forEach(function (o) {
      var r = null;
      for (var i = rows.length - 1; i >= 0 && i >= rows.length - 4; i--) {
        var R = rows[i];
        if (Math.abs(o.y - R.y) <= Math.max(1.5, 0.45 * Math.min(o.size, R.size))) { r = R; break; }
      }
      if (!r) { r = { y: o.y, size: o.size, items: [] }; rows.push(r); }
      r.items.push(o);
      if (o.size > r.size) { r.size = o.size; }
    });
    var frags = [];
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x0 - b.x0; });
      var cur = null;
      r.items.forEach(function (o) {
        var gapLimit = tight ? Math.max(3, 0.6 * Math.max(o.size, cur ? cur.size : 0)) : Math.max(6, 1.0 * Math.max(o.size, cur ? cur.size : 0));
        if (cur && o.x0 - cur.x1 <= gapLimit) { cur.items.push(o); cur.x1 = Math.max(cur.x1, o.x1); if (o.size > cur.size) cur.size = o.size; }
        else { cur = { items: [o], x0: o.x0, x1: o.x1, y: r.y, size: o.size }; frags.push(cur); }
      });
    });
    // baseline of a fragment = baseline of its largest-size items (superscripts sit higher)
    frags.forEach(function (f) {
      var main = f.items.filter(function (o) { return o.size >= f.size * 0.9; });
      f.y = median(main.map(function (o) { return o.y; }));
      f.top = f.y - f.size;
    });
    return frags;
  }

  /* ── Reading order: find column gutters recursively ──────── */
  /* rows with 3+ separate cells, 3+ rows in a row = a table that spans the columns */
  function tableLike(frags) {
    var set = new Set(), rows = [];
    frags.slice().sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; }).forEach(function (f) {
      var R = rows[rows.length - 1];
      if (R && Math.abs(f.y - R.y) <= 0.45 * Math.min(f.size, R.size)) R.f.push(f); else rows.push({ y: f.y, size: f.size, f: [f] });
    });
    var i = 0;
    while (i < rows.length) {
      if (rows[i].f.length < 3) { i++; continue; }
      var j = i + 1;
      while (j < rows.length && rows[j].f.length >= 3 && rows[j].y - rows[j - 1].y < rows[j].size * 3) j++;
      if (j - i >= 3) for (var k = i; k < j; k++) rows[k].f.forEach(function (f) { set.add(f); });
      i = j;
    }
    return set;
  }
  function findGutter(frags, x0, x1) {
    var W = x1 - x0; if (W < 120 || frags.length < 8) return null;
    var n = Math.ceil(W), cov = new Int32Array(n + 1);
    frags.forEach(function (f) {
      var a = Math.max(0, Math.floor(f.x0 - x0)), b = Math.min(n, Math.ceil(f.x1 - x0));
      for (var i = a; i <= b; i++) cov[i]++;
    });
    var lo = Math.floor(W * 0.2), hi = Math.ceil(W * 0.8), levels = {};
    for (var i = lo; i <= hi; i++) levels[cov[i]] = 1;
    var lv = Object.keys(levels).map(Number).sort(function (a, b) { return a - b; });
    var limit = lv[0] + Math.max(3, 0.4 * frags.length), tried = {}, tries = 0, grid = tableLike(frags);
    for (var L = 0; L < lv.length && lv[L] <= limit && tries < 12; L++) {
      var s = -1, runs = [];
      for (var j = lo; j <= hi + 1; j++) {
        if (j <= hi && cov[j] <= lv[L]) { if (s < 0) s = j; }
        else if (s >= 0) { if (j - s >= 6) runs.push({ s: s, w: j - s }); s = -1; }
      }
      runs.sort(function (a, b) { return b.w - a.w; });
      for (var r = 0; r < runs.length && r < 3; r++) {
        var key = runs[r].s + ':' + runs[r].w; if (tried[key]) continue; tried[key] = 1; tries++;
        var res = tryGutter(frags, x0 + runs[r].s + runs[r].w / 2, runs[r].w, W, grid);
        if (res) return res;
      }
    }
    return null;
  }
  function tryGutter(frags, g, gw, W, grid) {
    var best = { w: gw };
    var cross = [], left = [], right = [], nGrid = 0;
    frags.forEach(function (f) { if (grid.has(f) || (f.x0 < g - 1 && f.x1 > g + 1)) { cross.push(f); if (grid.has(f)) nGrid++; } else if (f.x1 <= g + 1) left.push(f); else right.push(f); });
    if (left.length < 5 || right.length < 5) return null;
    if (cross.length - nGrid > 0.35 * (left.length + right.length)) return null;
    // text columns have long lines; tables have short cells
    var lspan = g - Math.min.apply(null, left.map(function (f) { return f.x0; }));
    var rspan = Math.max.apply(null, right.map(function (f) { return f.x1; })) - g;
    var lw = left.filter(function (f) { return f.x1 - f.x0 >= 0.6 * lspan; }).length, rw = right.filter(function (f) { return f.x1 - f.x0 >= 0.6 * rspan; }).length;
    if (lw < Math.max(4, 0.15 * left.length) || rw < Math.max(4, 0.15 * right.length)) return null;
    // the two sides must sit next to each other, not one above the other
    var ly0 = Math.min.apply(null, left.map(function (f) { return f.top; })), ly1 = Math.max.apply(null, left.map(function (f) { return f.y; }));
    var ry0 = Math.min.apply(null, right.map(function (f) { return f.top; })), ry1 = Math.max.apply(null, right.map(function (f) { return f.y; }));
    var ov = Math.min(ly1, ry1) - Math.max(ly0, ry0);
    if (ov < 0.4 * Math.min(ly1 - ly0, ry1 - ry0)) return null;
    return { g: g, cross: cross, left: left, right: right };
  }

  var regionSeq = 0;
  function orderRegion(frags, x0, x1, depth, out) {
    if (!frags.length) return;
    var gut = depth < 3 ? findGutter(frags, x0, x1) : null;
    if (!gut) { out.push({ id: ++regionSeq, full: depth === 0, x0: Math.min.apply(null, frags.map(function (f) { return f.x0; })), x1: Math.max.apply(null, frags.map(function (f) { return f.x1; })), frags: frags }); return; }
    // split into horizontal bands at full-width fragments
    var cross = gut.cross.slice().sort(function (a, b) { return a.y - b.y; });
    var groups = [];
    cross.forEach(function (f) {
      var g = groups[groups.length - 1];
      var between = g && gut.left.concat(gut.right).some(function (c) { return c.y > g.y1 && c.y < f.y; });
      if (g && !between) { g.frags.push(f); g.y1 = f.y; } else groups.push({ frags: [f], y0: f.y, y1: f.y });
    });
    var bands = [];
    for (var i = 0; i <= groups.length; i++) bands.push({ left: [], right: [] });
    function bandOf(f) { var k = 0; while (k < groups.length && f.y > groups[k].y0) k++; return k; }
    gut.left.forEach(function (f) { bands[bandOf(f)].left.push(f); });
    gut.right.forEach(function (f) { bands[bandOf(f)].right.push(f); });
    for (var b = 0; b <= groups.length; b++) {
      orderRegion(bands[b].left, x0, gut.g, depth + 1, out);
      orderRegion(bands[b].right, gut.g, x1, depth + 1, out);
      if (b < groups.length) orderRegion(groups[b].frags, x0, x1, 3, out);
    }
  }

  /* fragments of a region → lines (one per baseline) */
  function regionLines(reg) {
    var fr = reg.frags.slice().sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; });
    var lines = [];
    fr.forEach(function (f) {
      var L = lines[lines.length - 1];
      if (L && Math.abs(f.y - L.y) <= 0.45 * Math.min(f.size, L.size)) { L.frags.push(f); L.x0 = Math.min(L.x0, f.x0); L.x1 = Math.max(L.x1, f.x1); L.size = Math.max(L.size, f.size); }
      else lines.push({ frags: [f], x0: f.x0, x1: f.x1, y: f.y, size: f.size });
    });
    lines.forEach(function (L) {
      var raw = L.frags.map(function (f) { return f.items.map(function (o) { return o.str; }).join(''); }).join('');
      var rtlN = (raw.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g) || []).length, ltrN = (raw.match(/[A-Za-z]/g) || []).length;
      L.rtl = rtlN > ltrN;
      if (L.rtl) { L.frags.sort(function (a, b) { return b.x1 - a.x1; }); L.frags.forEach(function (f) { f.items.sort(function (a, b) { return b.x1 - a.x1; }); }); }
      else L.frags.sort(function (a, b) { return a.x0 - b.x0; });
      // a list marker ("•", "1.", "a)") set apart from its text belongs to the same line, not a table cell
      if (!L.rtl && L.frags.length >= 2 && /^\s*([•●▪■◦‣∙·○◆►✓✔\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s*$/.test(fragText(L.frags[0])) && L.frags[1].x0 - L.frags[0].x1 < 40) {
        var m = L.frags[0], n2 = L.frags[1];
        L.frags.splice(0, 2, { items: m.items.concat(n2.items), x0: m.x0, x1: n2.x1, y: n2.y, size: Math.max(m.size, n2.size), top: Math.min(m.top, n2.top) });
      }
      L.text = L.frags.map(fragText).join(' ').replace(/\s+/g, ' ').trim();
      var sz = 0; L.frags.forEach(function (f) { f.items.forEach(function (o) { if (/[\p{L}\p{N}]/u.test(o.str) && o.size > sz) sz = o.size; }); });
      if (sz) L.size = sz;
    });
    return lines;
  }
  function fragText(f) { return itemsText(f.items); }
  function itemsText(items) {
    var s = '';
    items.forEach(function (o, i) {
      if (i > 0) { var p = items[i - 1]; if (Math.max(o.x0 - p.x1, p.x0 - o.x1) > 0.15 * Math.min(o.size, p.size) && !/\s$/.test(s) && !/^\s/.test(o.str)) s += ' '; }
      s += o.str;
    });
    return s;
  }

  /* ── Tables: rows of several cells with shared empty gaps ── */
  function detectTables(lines) {
    var res = [], i = 0;
    while (i < lines.length) {
      if (lines[i].frags.length < 2 || lines[i].rtl) { res.push(lines[i]); i++; continue; }
      var j = i;
      while (j < lines.length && lines[j].frags.length >= 2 && (j === i || lines[j].y - lines[j - 1].y < Math.max(lines[j].size, lines[j - 1].size) * 3.2)) j++;
      var run = lines.slice(i, j), tbl = run.length >= 3 || (run.length >= 2 && run.every(function (l) { return l.frags.length >= 3; })) ? makeTable(run) : null;
      if (tbl) { res.push(tbl); i = j; } else { res.push(lines[i]); i++; }
    }
    return res;
  }
  function makeTable(run) {
    var x0 = Math.min.apply(null, run.map(function (l) { return l.x0; })), x1 = Math.max.apply(null, run.map(function (l) { return l.x1; }));
    var n = Math.ceil(x1 - x0) + 1, cov = new Uint8Array(n);
    run.forEach(function (l) { l.frags.forEach(function (f) { for (var k = Math.floor(f.x0 - x0); k <= Math.ceil(f.x1 - x0) && k < n; k++) cov[Math.max(0, k)] = 1; }); });
    var seps = [], s = -1;
    for (var k = 0; k < n; k++) {
      if (!cov[k]) { if (s < 0) s = k; } else if (s >= 0) { if (k - s >= 6) seps.push(x0 + (s + k) / 2); s = -1; }
    }
    if (!seps.length || seps.length > 12) return null;
    var cols = seps.length + 1, rows = [], multi = 0;
    run.forEach(function (l) {
      var cells = []; for (var c = 0; c < cols; c++) cells.push([]);
      l.frags.forEach(function (f) { var cx = (f.x0 + f.x1) / 2, c = 0; while (c < seps.length && cx > seps[c]) c++; cells[c].push(f); });
      if (cells.filter(function (c) { return c.length; }).length >= 2) multi++;
      rows.push(cells);
    });
    if (multi < 0.6 * run.length) return null;
    var edges = [x0].concat(seps, [x1]), widths = [];
    for (var e = 0; e < cols; e++) widths.push(Math.max(10, edges[e + 1] - edges[e]));
    var pitch = []; for (var pi2 = 1; pi2 < run.length; pi2++) pitch.push(run[pi2].y - run[pi2 - 1].y);
    return { table: true, pitch: median(pitch), rows: rows, widths: widths, edges: edges, rowY: run.map(function (l) { return [l.y - l.size * 1.25, l.y + l.size * 0.55]; }), y: run[0].y, top: run[0].y - run[0].size, x0: x0, x1: x1, size: run[0].size };
  }

  /* ── Lines → paragraphs ──────────────────────────────────── */
  var BULLET = /^\s*([•●▪■◦‣∙·○◆►✓✔\-–—*]\s+|\(?\d{1,3}[.)]\s+|\(?[a-zA-Z][.)]\s+|\([ivxIVX]{1,4}\)\s+)/;
  function buildParagraphs(lines, reg, body, keepLines, pageRight) {
    var out = [], cur = null;
    var right = lines.length ? quant(lines.map(function (l) { return l.x1; }), 0.85) : reg.x1;
    var limit = reg.full && pageRight ? Math.max(right, pageRight) : right;   // where a full line would end
    var left = lines.length ? quant(lines.map(function (l) { return l.x0; }), 0.15) : reg.x0;
    var W = Math.max(40, right - left);
    var pitches = [];
    for (var i = 1; i < lines.length; i++) { var d = lines[i].y - lines[i - 1].y; if (d > 0 && Math.abs(lines[i].size - lines[i - 1].size) < 0.5) pitches.push(d); }
    var pitch = median(pitches) || body * 1.25;
    lines.forEach(function (L, idx) {
      if (L.table) { if (cur) out.push(cur); cur = null; out.push(L); return; }
      var head = L.size >= body * 1.18 && L.text.length < 200;
      var bullet = BULLET.test(L.text) && !head;
      var P = idx > 0 ? lines[idx - 1] : null;
      var mode = 'new';
      if (cur && P && !P.table) {
        var gap = L.y - P.y;
        var sameSize = Math.abs(L.size - P.size) <= 0.12 * Math.max(L.size, P.size);
        var close = gap > 0 && gap <= Math.max(pitch * 1.35, Math.max(L.size, P.size) * 1.45) && gap < Math.max(L.size, P.size) * 2.4;
        if (cur.head) { if (head && sameSize && close) mode = 'space'; }
        else if (!head && !bullet && sameSize && close) {
          // the previous line ended early if the next line's first word would have fitted on it
          var fw = (L.text.split(' ')[0] || '').length * ((L.x1 - L.x0) / Math.max(1, L.text.length));
          var pShort = P.x1 < right - Math.max(3 * P.size, 0.18 * W) || P.x1 + fw + 0.3 * P.size < limit - 2;
          var indented = L.x0 > cur.leftX + Math.max(L.size * 0.9, 8) && !cur.bullet;
          var outdent = L.x0 < cur.leftX - L.size * 1.2 && !(cur.lines.length === 1 && cur.firstIndent);
          if ((indented || outdent) && !(P.rtl && L.rtl)) mode = 'new';
          else if (cur.bullet && L.x0 <= cur.x0 + 2) mode = 'new';
          else if (P.rtl && L.rtl) mode = (L.x1 < P.x1 - Math.max(L.size * 2, 20)) ? 'new' : (/[.!?۔؟]$/.test(P.text) && P.x0 > left + Math.max(3 * P.size, 0.18 * W) ? 'new' : 'space');
          else if (pShort) mode = /[.!?:]["”’)]?$/.test(P.text) ? 'new' : 'break';
          else mode = 'space';
        }
      }
      if (mode !== 'new' && keepLines) mode = 'break';
      if (mode === 'new') {
        if (cur) out.push(cur);
        cur = { lines: [L], joins: [], head: head, bullet: bullet, size: L.size, leftX: L.x0, x0: L.x0, x1: L.x1, top: L.y - L.size, y: L.y, firstIndent: L.x0 > left + L.size * 0.9 };
      } else {
        cur.lines.push(L); cur.joins.push(mode); cur.x0 = Math.min(cur.x0, L.x0); cur.x1 = Math.max(cur.x1, L.x1);
        if (cur.lines.length === 2) cur.leftX = cur.bullet ? cur.leftX : L.x0; // body lines set the left edge
      }
    });
    if (cur) out.push(cur);
    // alignment + heading level + indent
    out.forEach(function (p) {
      if (p.table) return;
      p.rtl = p.lines.filter(function (l) { return l.rtl; }).length > p.lines.length / 2;
      if (p.lines.length >= 3 && p.lines.filter(function (l) { return /[0-9][)%]?$/.test(l.text); }).length >= 0.6 * p.lines.length) p.joins = p.joins.map(function () { return 'break'; });
      var allCentered = p.lines.every(function (l) { var c = (l.x0 + l.x1) / 2, mid = (reg.x0 + reg.x1) / 2; return Math.abs(c - mid) < 0.06 * (reg.x1 - reg.x0) && l.x0 > left + 0.08 * W && (l.x1 - l.x0) < 0.85 * W; });
      var allRight = !allCentered && !p.rtl && p.lines.every(function (l) { return l.x1 > right - 4 && l.x0 > left + 0.35 * W; });
      p.align = allCentered ? 'center' : allRight ? 'right' : '';
      if (p.align && !p.head) p.joins = p.joins.map(function () { return 'break'; });
      if (p.head) { var r = p.size / body; p.level = r >= 1.6 ? 1 : r >= 1.3 ? 2 : 3; }
      var ind = (p.bullet ? p.x0 : (p.lines.length > 1 ? p.leftX : p.x0)) - left;
      p.indent = !p.align && ind > 8 ? ind : 0;
    });
    return out;
  }
  function quant(a, q) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(q * (b.length - 1)))]; }

  /* ── Images of a page ────────────────────────────────────── */
  function mul(m1, m2) {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  }
  function objGet(objs, name) {
    return new Promise(function (res) {
      var done = false; var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 4000);
      try { objs.get(name, function (o) { if (!done) { done = true; clearTimeout(t); res(o); } }); }
      catch (e) { try { var o = objs.get(name); done = true; clearTimeout(t); res(o); } catch (e2) { done = true; clearTimeout(t); res(null); } }
    });
  }
  function imgToCanvas(img) {
    var w = img.width, h = img.height; if (!w || !h) return null;
    var c = document.createElement('canvas'); c.width = w; c.height = h; var ctx = c.getContext('2d'), alpha = false;
    if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return { c: c, alpha: true }; }
    var src = img.data; if (!src) return null;
    var out = ctx.createImageData(w, h), d = out.data;
    if (img.kind === 3) { d.set(src.subarray(0, d.length)); alpha = true; }
    else if (img.kind === 2) { for (var i = 0, j = 0; i < src.length && j < d.length; i += 3, j += 4) { d[j] = src[i]; d[j + 1] = src[i + 1]; d[j + 2] = src[i + 2]; d[j + 3] = 255; } }
    else if (img.kind === 1) {
      var rb = Math.ceil(w / 8);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var v = (src[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, k = (y * w + x) * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
    } else return null;
    ctx.putImageData(out, 0, 0);
    return { c: c, alpha: alpha };
  }
  async function readImages(page, vp, skipBig, regions) {
    var OPS = window.pdfjsLib.OPS, list;
    try { list = await page.getOperatorList(); } catch (e) { return []; }
    var out = [], ctm = [1, 0, 0, 1, 0, 0], stack = [], seen = 0;
    var pageArea = vp.width * vp.height;
    for (var i = 0; i < list.fnArray.length; i++) {
      var fn = list.fnArray[i], args = list.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject) {
        if (++seen > 60) break;
        var obj = typeof args[0] === 'string' ? await objGet(args[0].indexOf('g_') === 0 ? page.commonObjs : page.objs, args[0]) : args[0];
        if (!obj) continue;
        var pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(function (p) { return vp.convertToViewportPoint(ctm[0] * p[0] + ctm[2] * p[1] + ctm[4], ctm[1] * p[0] + ctm[3] * p[1] + ctm[5]); });
        var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
        var bx0 = Math.max(0, Math.min.apply(null, xs)), bx1 = Math.min(vp.width, Math.max.apply(null, xs)), by0 = Math.max(0, Math.min.apply(null, ys)), by1 = Math.min(vp.height, Math.max.apply(null, ys));
        var wPt = bx1 - bx0, hPt = by1 - by0;
        if (wPt < 6 || hPt < 6) continue;
        if (skipBig && wPt * hPt > 0.45 * pageArea) continue;
        if (regions && regions.some(function (r) { return inBox((bx0 + bx1) / 2, (by0 + by1) / 2, r); })) continue;
        if ((obj.width || 0) < 12 || (obj.height || 0) < 12) continue;
        var cv = imgToCanvas(obj); if (!cv) continue;
        var c = cv.c, maxD = 2000;
        if (Math.max(c.width, c.height) > maxD) {
          var s = maxD / Math.max(c.width, c.height), c2 = document.createElement('canvas');
          c2.width = Math.round(c.width * s); c2.height = Math.round(c.height * s); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); c.width = 0; c = c2;
        }
        var jpg = !cv.alpha && c.width * c.height > 40000;
        if (jpg) { var c3 = document.createElement('canvas'); c3.width = c.width; c3.height = c.height; var x3 = c3.getContext('2d'); x3.fillStyle = '#fff'; x3.fillRect(0, 0, c3.width, c3.height); x3.drawImage(c, 0, 0); c = c3; }
        var blob = await new Promise(function (r) { c.toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.9); });
        c.width = c.height = 0;
        if (blob) out.push({ img: true, blob: blob, ext: jpg ? 'jpeg' : 'png', wPt: wPt, hPt: hPt, x0: bx0, x1: bx1, top: by0, y: by1 });
      }
    }
    return out;
  }

  /* table borders and cell colours from the PDF drawing */
  function styleTable(t, g) {
    if (!g) return;
    var box = { x0: t.x0 - 6, x1: t.x1 + 6, y0: t.rowY[0][0] - 6, y1: t.rowY[t.rowY.length - 1][1] + 6 };
    var cnt = {}, lws = [];
    g.paths.forEach(function (q) {
      if (!q.stroke && !(q.fill && Math.min(q.x1 - q.x0, q.y1 - q.y0) < 2.5)) return;
      if (!overlap(box, q, 0)) return;
      if (q.stroke && !q.rectOnly && Math.min(q.x1 - q.x0, q.y1 - q.y0) >= 2.5) return;
      var col = q.stroke || q.fill; cnt[col] = (cnt[col] || 0) + 1; lws.push(q.stroke ? q.lw : Math.min(q.x1 - q.x0, q.y1 - q.y0));
    });
    var cols = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    t.border = cols.length && cnt[cols[0]] >= 2 ? { color: cols[0], sz: Math.max(2, Math.min(24, Math.round(median(lws) * 8))) } : null;
    t.fills = t.rows.map(function (cells, ri) {
      return cells.map(function (c, ci) {
        var cx = (t.edges[ci] + t.edges[ci + 1]) / 2, cy = (t.rowY[ri][0] + t.rowY[ri][1]) / 2, hit = null;
        g.paths.forEach(function (q) { if (q.fill && q.rectOnly && !isWhite(q.fill) && inBox(cx, cy, q) && (q.x1 - q.x0) > 6 && (q.y1 - q.y0) > 6) hit = q.fill; });
        return hit;
      });
    });
    // the cell colour already shows; drop the same colour as text highlight
    t.rows.forEach(function (cells, ri) { cells.forEach(function (fr, ci) { var f = t.fills[ri][ci]; if (f) fr.forEach(function (x) { x.items.forEach(function (o) { if (o.hl === f) o.hl = null; }); }); }); });
  }
  async function renderPage(page, scale, noText) {
    var v = page.getViewport({ scale: scale }), c = document.createElement('canvas');
    c.width = Math.floor(v.width); c.height = Math.floor(v.height);
    var ctx = c.getContext('2d');
    // text can also be drawn on helper canvases (transparency groups, e.g. Canva PDFs), so switch it off for every canvas while this page draws
    var P = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, keepF, keepS;
    if (noText && P) { keepF = P.fillText; keepS = P.strokeText; P.fillText = function () { }; P.strokeText = function () { }; }
    try { await page.render({ canvasContext: ctx, viewport: v, background: 'rgb(255,255,255)' }).promise; }
    finally { if (noText && P) { P.fillText = keepF; P.strokeText = keepS; } }
    return c;
  }
  async function cropRegions(page, regions) {
    var sc = 2, c = await renderPage(page, sc, false), out = [];
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i], x0 = Math.max(0, r.x0 - 3), y0 = Math.max(0, r.y0 - 3), x1 = Math.min(c.width / sc, r.x1 + 3), y1 = Math.min(c.height / sc, r.y1 + 3);
      var w = Math.round((x1 - x0) * sc), h = Math.round((y1 - y0) * sc); if (w < 4 || h < 4) continue;
      var d = document.createElement('canvas'); d.width = w; d.height = h; d.getContext('2d').drawImage(c, x0 * sc, y0 * sc, w, h, 0, 0, w, h);
      var blob = await new Promise(function (res) { d.toBlob(res, 'image/png'); }); d.width = 0;
      if (blob) out.push({ img: true, blob: blob, ext: 'png', wPt: x1 - x0, hPt: y1 - y0, x0: x0, x1: x1, top: y0, y: y1 });
    }
    c.width = c.height = 0;
    return out;
  }
  function canvasJpeg(c, maxW) {
    var d = c;
    if (c.width > maxW) { d = document.createElement('canvas'); d.width = maxW; d.height = Math.round(c.height * maxW / c.width); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); }
    return new Promise(function (res) { d.toBlob(function (b) { if (d !== c) d.width = 0; res(b); }, 'image/jpeg', 0.85); });
  }

  /* ── OCR for scanned pages ───────────────────────────────── */
  async function ensureWorker(lang) {
    if (st.worker && st.workerLang === lang) return st.worker;
    if (st.worker) { try { await st.worker.terminate(); } catch (e) { } st.worker = null; }
    if (typeof Tesseract === 'undefined') await loadScript(TESS_URL);
    var langs = lang.split('+');
    var label = lang === $('p2wLang').value && $('p2wLang').selectedOptions[0] ? $('p2wLang').selectedOptions[0].textContent : lang;
    var last = Date.now();
    var make = Tesseract.createWorker(langs.length > 1 ? langs : langs[0], 1, Object.assign({}, window.P2W_TESS || {}, {
      logger: function (m) { last = Date.now(); if (m && m.status === 'loading language traineddata' && !st.cancelled) progress(st.pct || 5, 'Loading ' + label + ' OCR data… ' + Math.round((m.progress || 0) * 100) + '%'); }
    }));
    // never hang silently: if the OCR data stops downloading for 45 s, stop with a clear message
    st.worker = await new Promise(function (res, rej) {
      var t = setInterval(function () {
        if (st.cancelled) { clearInterval(t); rej(new Error('cancelled')); }
        else if (Date.now() - last > 45000) { clearInterval(t); rej(new Error('the OCR language data could not be downloaded. Check your internet connection or allow cdn.jsdelivr.net in your ad blocker')); }
      }, 1000);
      make.then(function (w) { clearInterval(t); res(w); }, function (e) { clearInterval(t); rej(e); });
    });
    await st.worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    st.workerLang = lang;
    return st.worker;
  }
  /* Second look at a column of item numbers ("01", "02" …) that the page layout pass can skip */
  async function markerPass(w, c, d) {
    var MARK = /^\(?\d{1,3}[.)]?$/, marks = [], text = [];
    (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) {
      var ws = (l.words || []).filter(function (x) { return String(x.text || '').trim(); });
      if (ws.length && ws.length <= 3 && ws.every(function (x) { return MARK.test(String(x.text).trim()); })) marks = marks.concat(ws); else if (ws.length) text.push(l);
    }); }); });
    if (marks.length < 3 || !text.length) return null;
    var x0 = Math.min.apply(null, marks.map(function (m) { return m.bbox.x0; }));
    var x1 = Math.max.apply(null, marks.map(function (m) { return m.bbox.x1; }));
    var right = Math.min.apply(null, text.filter(function (l) { return l.bbox.x0 > x1; }).map(function (l) { return l.bbox.x0; }).concat([c.width]));
    var h = median(marks.map(function (m) { return m.bbox.y1 - m.bbox.y0; })) || 20;
    var top = Math.max(0, Math.min.apply(null, text.map(function (l) { return l.bbox.y0; })) - h);
    var bottom = Math.min(c.height, Math.max.apply(null, text.map(function (l) { return l.bbox.y1; })) + h);
    var left = Math.max(0, x0 - h * 2), width = Math.min(c.width - left, right - 2 - left);
    if (width < h || bottom - top < h * 3) return null;
    await w.setParameters({ tessedit_pageseg_mode: '6' });
    var r2;
    try { r2 = await w.recognize(c, { rectangle: { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(bottom - top) } }, { blocks: true }); }
    finally { await w.setParameters({ tessedit_pageseg_mode: '3' }); }
    var out = [];
    (r2.data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (x) { if (MARK.test(String(x.text || '').trim())) out.push(x); }); }); }); });
    return out.length > marks.length ? out : null;
  }
  async function ocrPage(page, vp, lang, keepLines, exact) {
    var v1 = page.getViewport({ scale: 1 });
    var sc = Math.min(300 / 72, 4200 / Math.max(v1.width, v1.height));
    var rv = page.getViewport({ scale: sc });
    var c = document.createElement('canvas'); c.width = Math.floor(rv.width); c.height = Math.floor(rv.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: rv, background: 'rgb(255,255,255)' }).promise;
    var w = await ensureWorker(lang);
    var r = await w.recognize(c, { rotateAuto: true }, { text: true, blocks: true, imageColor: !!exact });
    if (exact && r.data.imageColor && Math.abs(r.data.rotateRadians || 0) > 0.001) {
      // a tilted scan was straightened for OCR; use the straightened picture so the words line up
      var im = new Image(); im.src = r.data.imageColor; await im.decode();
      c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0);
    }
    var extraMarks = null;
    try { extraMarks = await markerPass(w, c, r.data); } catch (e) { extraMarks = null; }
    var exactOut = null;
    if (exact) {
      // erase the printed words from the scan, keep logos, stamps and signatures; the words come back as editable text on top
      var ctx2 = c.getContext('2d', { willReadFrequently: true }), kk = vp.width / c.width, eLines = [];
      // paper colour: a bright, common colour of the scan
      var smp = [], img = ctx2.getImageData(0, 0, c.width, c.height).data;
      for (var sy = 5; sy < 40; sy++) for (var sx = 5; sx < 40; sx++) { var ix = ((Math.floor(sy * c.height / 45)) * c.width + Math.floor(sx * c.width / 45)) * 4; smp.push([img[ix], img[ix + 1], img[ix + 2], img[ix] + img[ix + 1] + img[ix + 2]]); }
      smp.sort(function (a, b) { return a[3] - b[3]; }); var pc = smp[Math.floor(smp.length * 0.8)];
      ctx2.fillStyle = 'rgb(' + pc[0] + ',' + pc[1] + ',' + pc[2] + ')';
      var mctx = document.createElement('canvas').getContext('2d'); mctx.font = '100px Arial';
      (r.data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) {
        var ws = (l.words || []).filter(function (x) { return String(x.text || '').trim(); });
        if (!ws.length) return;
        ws.forEach(function (x) { var bb = x.bbox; ctx2.fillRect(bb.x0 - 3, bb.y0 - 3, bb.x1 - bb.x0 + 6, bb.y1 - bb.y0 + 6); });
        var lb = l.bbox, txt = ws.map(function (x) { return String(x.text).trim(); }).join(' ');
        var hpt = (lb.y1 - lb.y0) * kk, wpt = (lb.x1 - lb.x0) * kk, fit = wpt / Math.max(1, mctx.measureText(txt).width / 100);
        var sz = Math.max(hpt * 0.55, Math.min(hpt * 1.1, fit));   // font size that fills the line's width
        eLines.push({ text: txt, x0: lb.x0 * kk, x1: lb.x1 * kk, top: lb.y0 * kk, y: lb.y1 * kk, size: Math.max(5, sz), rtl: RTL_LANG.test(lang) && RTL_CHARS.test(txt) });
      }); }); });
      exactOut = { bg: await canvasJpeg(c, 1700), lines: eLines };
    }
    c.width = c.height = 0;
    var d = r.data, k = vp.width / rv.width, rtlLang = RTL_LANG.test(lang);
    var paras = [], confs = [], heights = [];
    (d.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        var lines = (p.lines || []).filter(function (l) { return String(l.text || '').trim(); });
        if (!lines.length) return;
        lines.forEach(function (l) { heights.push(l.bbox.y1 - l.bbox.y0); (l.words || []).forEach(function (wd) { if (String(wd.text || '').trim() && isFinite(wd.confidence)) confs.push(+wd.confidence); }); });
        paras.push({ lines: lines, bbox: p.bbox });
      });
    });
    var mh = median(heights) || 30;
    // numbered items: Tesseract often reads the "01, 02 …" column as its own block.
    // Put each number back in front of the line it belongs to.
    var MARK = /^\(?\d{1,3}[.)]?$/, marks = extraMarks ? extraMarks.slice() : [], textLines = [];
    paras.forEach(function (p) {
      p.lines = p.lines.filter(function (l) {
        var ws = (l.words || []).filter(function (w) { return String(w.text || '').trim(); });
        if (ws.length && ws.length <= 3 && ws.every(function (w) { return MARK.test(String(w.text).trim()); })) { if (!extraMarks) ws.forEach(function (w) { marks.push(w); }); l._marks = ws; return true; }
        textLines.push(l); return true;
      });
    });
    var used = [];
    marks.forEach(function (w) {
      var cy = (w.bbox.y0 + w.bbox.y1) / 2, best = null;
      textLines.forEach(function (l) {
        var h = l.bbox.y1 - l.bbox.y0;
        if (l.bbox.x0 > w.bbox.x1 - 2 && Math.abs((l.bbox.y0 + l.bbox.y1) / 2 - cy) < h * 0.6 && !l.prefix && (!best || l.bbox.x0 < best.bbox.x0)) best = l;
      });
      if (best && best.bbox.x0 - w.bbox.x1 < 0.25 * vp.width / k) { best.prefix = String(w.text).trim(); used.push(w); }
    });
    if (used.length) {
      paras.forEach(function (p) {
        p.lines = p.lines.filter(function (l) { return !(l._marks && (extraMarks || l._marks.every(function (w) { return used.indexOf(w) >= 0; }))); });
        // a paragraph that now starts with a number starts a new item
      });
      paras = paras.filter(function (p) { return p.lines.length; });
      // split paragraphs where a numbered line starts
      var split = [];
      paras.forEach(function (p) {
        var cur = null;
        p.lines.forEach(function (l, i) {
          if (!cur || (l.prefix && i > 0)) { cur = { lines: [], bbox: { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 } }; split.push(cur); }
          cur.lines.push(l); cur.bbox.x0 = Math.min(cur.bbox.x0, l.bbox.x0); cur.bbox.x1 = Math.max(cur.bbox.x1, l.bbox.x1); cur.bbox.y1 = l.bbox.y1;
        });
      });
      paras = split;
    }
    // Tesseract sometimes cuts one paragraph in two; join them back
    for (var q = paras.length - 1; q > 0; q--) {
      var A = paras[q - 1], B = paras[q], la = A.lines[A.lines.length - 1], lb = B.lines[0];
      var h = Math.max(la.bbox.y1 - la.bbox.y0, lb.bbox.y1 - lb.bbox.y0);
      if (!lb.prefix && lb.bbox.y0 - la.bbox.y1 < h * 0.8 && lb.bbox.y0 > la.bbox.y0 && Math.abs(lb.bbox.x0 - A.bbox.x0) < h * 1.5 && !/[.!?:]["”)]?$/.test(String(la.text).trim()) && Math.abs((lb.bbox.y1 - lb.bbox.y0) - (la.bbox.y1 - la.bbox.y0)) < h * 0.3) {
        A.lines = A.lines.concat(B.lines); A.bbox = { x0: Math.min(A.bbox.x0, B.bbox.x0), y0: A.bbox.y0, x1: Math.max(A.bbox.x1, B.bbox.x1), y1: B.bbox.y1 }; paras.splice(q, 1);
      }
    }
    var out = paras.map(function (p) {
      var texts = p.lines.map(function (l) {
        var ws = (l.words || []).filter(function (w) { return String(w.text || '').trim(); });
        var t = '';
        if (!ws.length) t = String(l.text).replace(/\s+/g, ' ').trim();
        else {
          var lh = l.bbox.y1 - l.bbox.y0;
          ws.forEach(function (w, i) { if (i) t += Math.max(w.bbox.x0 - ws[i - 1].bbox.x1, ws[i - 1].bbox.x0 - w.bbox.x1) > lh * 1.5 ? '\t' : ' '; t += String(w.text).trim(); });
        }
        t = t.replace(/^[=»«*■●◦•·¢©®]\s+/, '• ');   // square bullets are often read as = or »
        return (l.prefix ? l.prefix + '\t' : '') + t;
      });
      var pw = p.bbox.x1 - p.bbox.x0, joins = [];
      var listy = texts.length >= 3 && texts.filter(function (t) { return /[0-9][)%]?$/.test(t); }).length >= 0.6 * texts.length;
      for (var i = 1; i < texts.length; i++) {
        var prev = p.lines[i - 1], short = prev.bbox.x1 < p.bbox.x1 - 0.2 * pw;
        joins.push(keepLines || short || listy || /^• /.test(texts[i]) || /\t/.test(texts[i - 1].replace(/^\d{1,3}\t/, '') + texts[i]) ? 'break' : 'space');
      }
      var lh = median(p.lines.map(function (l) { return l.bbox.y1 - l.bbox.y0; }));
      var all = texts.join(' ');
      var rtl = rtlLang && RTL_CHARS.test(all);
      var x0 = p.bbox.x0 * k, x1 = p.bbox.x1 * k, mid = vp.width / 2;
      var centered = !rtl && texts.length <= 4 && p.lines.every(function (l) { var a = l.bbox.x0 * k, b = l.bbox.x1 * k; return Math.abs((a + b) / 2 - mid) < 0.05 * vp.width && a > 0.12 * vp.width; });
      if (centered) joins = joins.map(function () { return 'break'; });
      var head = lh >= mh * 1.45 && all.length < 150;
      return { ocr: true, texts: texts, joins: joins, rtl: rtl, head: head, level: lh >= mh * 2 ? 1 : 2, align: centered ? 'center' : '', top: p.bbox.y0 * k, y: p.bbox.y1 * k, x0: x0, x1: x1 };
    });
    if (!out.length && String(d.text || '').trim()) {
      String(d.text).split(/\n\s*\n/).forEach(function (t) { t = t.trim(); if (t) out.push({ ocr: true, texts: t.split('\n'), joins: t.split('\n').slice(1).map(function () { return keepLines ? 'break' : 'space'; }), rtl: rtlLang && RTL_CHARS.test(t), align: '', top: 0, y: 0, x0: 0, x1: 0 }); });
    }
    return { blocks: out, confs: confs, exact: exactOut };
  }

  /* ── Convert ─────────────────────────────────────────────── */
  async function run() {
    if (!st.pdf || st.busy) return;
    var n = st.pdf.numPages, r = parsePages($('p2wPages').value, n);
    if (r.err) { say(r.err, 'error'); $('p2wPages').focus(); return; }
    var ocrMode = $('p2wOcr').value, lang = $('p2wLang').value, keepLines = $('p2wLayout').value === 'lines', exact = $('p2wLayout').value === 'exact', auto = $('p2wLayout').value === 'auto';
    var withImages = $('p2wImages').checked, pageBreaks = $('p2wBreaks').checked;
    st.busy = true; st.cancelled = false; st.pct = 2; regionSeq = 0;
    if (window.PDLoader) window.PDLoader.show('Converting to Word…', st.file ? st.file.name : '', function () { $('p2wCancel').click(); });
    $('p2wRunBtn').disabled = true; $('p2wClearBtn').disabled = true; resetResult();
    var t0 = Date.now(), pages = [], confs = [], ocrCount = 0, ocrSkipped = [], emptyPages = [], garbledPages = [], urduPages = [];
    try {
      if (!window.JSZip) await loadScript(JSZIP_URL);
      for (var i = 0; i < r.list.length; i++) {
        if (st.cancelled) return;
        var pn = r.list[i];
        st.pct = 3 + Math.round(i / r.list.length * 90);
        progress(st.pct, 'Reading page ' + pn + ' (' + (i + 1) + ' of ' + r.list.length + ')…');
        await tick();
        var page = await st.pdf.getPage(pn), vp = page.getViewport({ scale: 1 });
        var tp = await readTextPage(page, vp);
        var hasImg = false;
        var needOcr = ocrMode === 'all' || (ocrMode === 'auto' && ((tp.chars < 20 && tp.cover >= 0.1) || tp.garbled || tp.badUrdu));
        if (tp.badUrdu && needOcr) urduPages.push(pn);
        if (tp.garbled && ocrMode !== 'all') garbledPages.push(pn);
        var pg = { n: pn, w: vp.width, h: vp.height, blocks: [], ocr: false, items: tp.items, allItems: tp.items, rotated: tp.rotated };
        pg.designed = designedPage(tp, vp);
        if (window.PD_DEBUG) console.log('P2WPAGE', pn, JSON.stringify(pg.designed));
        var pgEx = exact || (auto && !needOcr && pg.designed.yes); pg.exact = pgEx;
        if (needOcr && ocrCount >= MAX_OCR_PAGES) { ocrSkipped.push(pn); needOcr = false; }
        if (needOcr) {
          progress(st.pct, 'Reading scanned page ' + pn + ' with OCR (' + (i + 1) + ' of ' + r.list.length + ')…');
          var o = await ocrPage(page, vp, tp.badUrdu && !/urd/.test(lang) ? 'urd+eng' : lang, keepLines, exact);
          if (st.cancelled) return;
          pg.ocr = true; ocrCount++; pg.blocks = o.blocks; confs = confs.concat(o.confs); pg.items = [];
          if (o.exact) { pg.bg = o.exact.bg; pg.ocrLines = o.exact.lines; }
          if (!o.blocks.length) emptyPages.push(pn);
        } else if (!tp.chars) emptyPages.push(pn);
        pg.gfx = pg.ocr ? null : tp.gfx;
        var drawn = [], regs = pg.ocr || pgEx ? [] : tp.drawings;
        if (withImages && regs.length) {
          progress(st.pct, 'Keeping drawings and signatures on page ' + pn + '…');
          drawn = await cropRegions(page, regs);
          pg.items = pg.items.filter(function (o) { return !regs.some(function (d) { return inBox((o.x0 + o.x1) / 2, o.y - o.size * 0.35, d); }); });
        }
        if (withImages && !pgEx) { var imgs = await readImages(page, vp, pg.ocr, regs); pg.images = imgs.concat(drawn); hasImg = pg.images.length > 0; }
        if (pgEx && !pg.ocr) { var bgc = await renderPage(page, 2, true); eraseDrawnText(bgc, page, vp, pg.items, 2); pg.bg = await canvasJpeg(bgc, 1700); bgc.width = bgc.height = 0; }
        pages.push(pg);
        page.cleanup();
      }
      if (st.cancelled) return;
      // when at least half the pages are designed (a two-page CV, a brochure), keep every page in the same exact look
      if (auto) {
        var nd = pages.filter(function (p) { return p.exact; }).length;
        if (nd && nd * 2 >= pages.length) for (var pe = 0; pe < pages.length; pe++) {
          var P2 = pages[pe]; if (P2.exact || P2.ocr) continue;
          progress(94, 'Keeping the layout of page ' + P2.n + '…');
          var pgo = await st.pdf.getPage(P2.n), vpo = pgo.getViewport({ scale: 1 });
          var bc2 = await renderPage(pgo, 2, true); eraseDrawnText(bc2, pgo, vpo, P2.allItems, 2);
          P2.bg = await canvasJpeg(bc2, 1700); bc2.width = bc2.height = 0; pgo.cleanup();
          P2.exact = true; P2.items = P2.allItems; P2.images = [];
        }
      }
      progress(95, 'Building the Word file…');
      // body font size = most common size by characters (text pages)
      var hist = {};
      pages.forEach(function (p) { p.items.forEach(function (o) { var k = Math.round(o.size * 2) / 2; hist[k] = (hist[k] || 0) + o.str.length; }); });
      var body = 11, bestN = 0; Object.keys(hist).forEach(function (k) { if (hist[k] > bestN) { bestN = hist[k]; body = +k; } });
      var famHist = {}; pages.forEach(function (p) { p.items.forEach(function (o) { if (Math.abs(o.size - body) < 0.6) famHist[o.family] = (famHist[o.family] || 0) + o.str.length; }); });
      var bodyFont = Object.keys(famHist).sort(function (a, b) { return famHist[b] - famHist[a]; })[0] || 'Calibri';
      var margins = null;
      pages.forEach(function (p) {
        if (!p.ocr) {
          var frags = buildFrags(p.items);
          if (!margins && frags.length > 5) {
            margins = { l: quant(frags.map(function (f) { return f.x0; }), 0.05), r: p.w - quant(frags.map(function (f) { return f.x1; }), 0.95), t: quant(frags.map(function (f) { return f.top; }), 0.02), b: p.h - quant(frags.map(function (f) { return f.y; }), 0.98) };
          }
          var regions = []; orderRegion(frags, 0, p.w, 0, regions);
          var pageRight = frags.length ? p.w - quant(frags.map(function (f) { return f.x0; }), 0.05) : 0;
          var blocks = [];
          regions.forEach(function (reg) {
            var lines = detectTables(regionLines(reg));
            buildParagraphs(lines, reg, body, keepLines, pageRight).forEach(function (b) { b.reg = reg; if (b.table) styleTable(b, p.gfx); blocks.push(b); });
          });
          // a paragraph that runs from the bottom of one column to the top of the next
          for (var q = blocks.length - 1; q > 0; q--) {
            var A = blocks[q - 1], C = blocks[q];
            if (A.table || C.table || A.head || C.head || C.bullet || A.reg === C.reg || keepLines) continue;
            var lastA = A.lines[A.lines.length - 1].text, firstC = C.lines[0].text;
            if (!/[.!?:]["”’)]?$/.test(lastA) && /^[a-z(]/.test(firstC) && Math.abs(A.size - C.size) < 0.6 && C.top < A.top) {
              A.lines = A.lines.concat(C.lines); A.joins = A.joins.concat(['space'], C.joins); blocks.splice(q, 1);
            }
          }
          if (p.rotated.length) {
            var rt = p.rotated.map(function (o) { return o.str; }).join('').replace(/\s+/g, ' ').trim();
            if (rt) blocks.push({ lines: [{ frags: [{ items: p.rotated }] }], joins: [], size: body, x0: 0, x1: p.w, top: p.h, y: p.h, plain: rt });
          }
          p.blocks = blocks;
        }
        // place images into the flow
        (p.images || []).forEach(function (im) {
          var cx = (im.x0 + im.x1) / 2, at = -1;
          for (var b = 0; b < p.blocks.length; b++) {
            var B = p.blocks[b]; if (B.img) continue;
            var bx0 = B.reg ? B.reg.x0 : B.x0, bx1 = B.reg ? B.reg.x1 : B.x1;
            var overlap = Math.min(bx1, im.x1) - Math.max(bx0, im.x0);
            if ((overlap > 0 || (cx >= bx0 && cx <= bx1)) && (B.top >= im.top - 2)) { at = b; break; }
          }
          if (at < 0) p.blocks.push(im); else p.blocks.splice(at, 0, im);
        });
      });
      st.out = { exact: exact, pages: pages, body: body, bodyFont: bodyFont, margins: margins, pageBreaks: pageBreaks, lang: lang };
      var built = await buildDocx(st.out);
      st.out.blob = built.blob; st.out.text = built.text;
      st.out.stats = { pages: pages.length, words: built.words, paras: built.paras, tables: built.tables, images: built.images, ocr: ocrCount, conf: confs.length ? Math.round(confs.reduce(function (a, b) { return a + b; }, 0) / confs.length) : null, ms: Date.now() - t0 };
      progress(100, 'Done in ' + Math.max(1, Math.round((Date.now() - t0) / 1000)) + ' s');
      var formy = !exact && !auto && pages.some(function (p) { return p.gfx && p.items.length < 400 && p.gfx.paths.filter(function (q) { return q.rectOnly || Math.min(q.x1 - q.x0, q.y1 - q.y0) < 2.5; }).length > 60; });
      showResult(built, { formy: formy, urdu: urduPages, capped: r.capped, ocrSkipped: ocrSkipped, empty: emptyPages, garbled: garbledPages, ocrMode: ocrMode });
    } catch (e) {
      if (st.cancelled) return;
      console.error(e);
      say('Conversion stopped: ' + (e && e.message ? e.message : 'unknown error') + '. Try fewer pages or another browser.', 'error');
    } finally {
      if (st.worker) { try { await st.worker.terminate(); } catch (e) { } st.worker = null; st.workerLang = null; }
      st.busy = false; $('p2wRunBtn').disabled = !st.pdf; $('p2wClearBtn').disabled = false;
      if (window.PDLoader) window.PDLoader.hide();
      setTimeout(function () { if (!st.busy) $('progressCard').style.display = 'none'; }, 1200);
    }
  }

  /* Some fonts (Type 3, common in PDFs printed from Chrome) are drawn as shapes, so switching text off
     does not hide them: paint over those words with the colour right around them */
  function eraseDrawnText(c, page, vp, items, sc) {
    var ctx = c.getContext('2d', { willReadFrequently: true }), W = c.width, H = c.height, todo = [];
    items.forEach(function (o) {
      var t3 = false; try { var fo = o.fontName && page.commonObjs.has(o.fontName) ? page.commonObjs.get(o.fontName) : null; t3 = !!(fo && (fo.isType3Font || fo.type === 'Type3')); } catch (e) { }
      if (t3 && o.str && o.str.trim()) todo.push(o);
    });
    if (!todo.length) return 0;
    var img = ctx.getImageData(0, 0, W, H), d = img.data;
    var boxes = todo.map(function (o) {
      var x0 = Math.max(0, Math.floor((o.x0 - 0.6) * sc)), x1 = Math.min(W - 1, Math.ceil((o.x1 + 0.6) * sc));
      var y0 = Math.max(0, Math.floor((o.y - o.size * 0.95) * sc)), y1 = Math.min(H - 1, Math.ceil((o.y + o.size * 0.26) * sc));
      var ring = [], q, xx, yy;
      for (xx = x0; xx <= x1; xx += 2) [y0 - 2, y1 + 2].forEach(function (yv) { if (yv >= 0 && yv < H) { q = (yv * W + xx) * 4; ring.push([d[q], d[q + 1], d[q + 2], d[q] + d[q + 1] + d[q + 2]]); } });
      for (yy = y0; yy <= y1; yy += 2) [x0 - 2, x1 + 2].forEach(function (xv) { if (xv >= 0 && xv < W) { q = (yy * W + xv) * 4; ring.push([d[q], d[q + 1], d[q + 2], d[q] + d[q + 1] + d[q + 2]]); } });
      ring.sort(function (a, b) { return b[3] - a[3]; });
      var bg = ring.length ? ring[Math.floor(ring.length * 0.25)] : [255, 255, 255];
      return [x0, y0, x1 - x0 + 1, y1 - y0 + 1, bg];
    });
    boxes.forEach(function (b) { ctx.fillStyle = 'rgb(' + b[4][0] + ',' + b[4][1] + ',' + b[4][2] + ')'; ctx.fillRect(b[0], b[1], b[2], b[3]); });
    return boxes.length;
  }

  /* A designed page (invoice, form, certificate, flyer): coloured boxes, ruled lines and short labels
     placed around the page. Flowing paragraphs can't hold that look, so these pages keep the exact layout. */
  function designedPage(tp, vp) {
    var g = tp.gfx; if (!g) return { yes: false };
    var A = vp.width * vp.height, boxes = 0, boxArea = 0, rules = 0;
    g.paths.forEach(function (q) {
      var w = q.x1 - q.x0, h = q.y1 - q.y0;
      if (Math.min(w, h) < 2.5 && Math.max(w, h) > 40) { rules++; return; }
      if (q.fill && !isWhite(q.fill) && w * h > 300) { boxes++; boxArea += w * h; }
    });
    var frags = buildFrags(tp.items), chars = 0; frags.forEach(function (f) { chars += fragText(f).length; });
    var perLine = frags.length ? chars / frags.length : 0;
    // a sidebar or two short-line columns side by side (CVs, brochures): flowing text would stack them
    var side = false; try { side = frags.length >= 8 && perLine < 40 && !!findGutter(frags, 0, vp.width); } catch (e) { side = false; }
    var yes = tp.items.length > 0 && tp.items.length < 900 && ((perLine < 35 && (boxes >= 3 || boxArea > A * 0.08)) || side);
    return { yes: yes, side: side, boxes: boxes, rules: rules, area: Math.round(boxArea / A * 100), perLine: Math.round(perLine), frags: frags.length };
  }

  /* ── DOCX writer ─────────────────────────────────────────── */
  var measureCtx = null;
  function tw(pt) { return Math.round(pt * 20); }
  function emu(pt) { return Math.max(1, Math.round(pt * 12700)); }
  async function buildDocx(o) {
    var media = [], rels = [], body = '', text = [], words = 0, paras = 0, tables = 0, images = 0;
    var first = o.pages[0] || { w: 612, h: 792 };
    var m = o.margins || { l: 72, r: 72, t: 72, b: 72 };
    var clampM = function (v) { return Math.max(28, Math.min(108, v - 4)); };
    var ML = clampM(m.l), MR = clampM(m.r), MT = clampM(m.t), MB = clampM(m.b);
    /* Running header/footer: a short line repeated at the top or bottom of most
       pages becomes a real Word header/footer (page numbers become a PAGE field),
       so it no longer spills onto an extra page. */
    var usedBullets = false;
    var runHF = { head: null, foot: null };
    (function () {
      var flow = o.exact ? [] : o.pages.filter(function (pg) { return !pg.exact && pg.blocks && pg.blocks.length; });
      if (flow.length < 2) return;
      function txt(B) { return B.lines.map(function (L) { return L.text || ''; }).join(' ').replace(/\s+/g, ' ').trim(); }
      function key(B) { return txt(B).replace(/\d+/g, '#').toLowerCase(); }
      function edge(pg, top) {
        var bl = pg.blocks.filter(function (B) { return B.lines && B.lines.length && !B.table && !B.img && !B.ocr; });
        if (!bl.length) return null;
        var B = bl.reduce(function (a, b) { return top ? (b.lines[0].y < a.lines[0].y ? b : a) : (b.lines[b.lines.length - 1].y > a.lines[a.lines.length - 1].y ? b : a); });
        var h = pg.h || first.h, y = top ? B.lines[0].y : B.lines[B.lines.length - 1].y;
        if ((top ? y > h * 0.1 : y < h * 0.9) || B.lines.length > 2 || txt(B).length > 120) return null;
        return B;
      }
      ['head', 'foot'].forEach(function (k) {
        var top = k === 'head', hits = {}, found = [];
        flow.forEach(function (pg) { var B = edge(pg, top); if (B) { var kk = key(B); (hits[kk] = hits[kk] || []).push({ pg: pg, B: B }); } });
        Object.keys(hits).forEach(function (kk) { if (hits[kk].length >= Math.max(2, Math.ceil(flow.length * 0.6))) found = hits[kk]; });
        if (!found.length) return;
        found.forEach(function (f) { f.pg.blocks = f.pg.blocks.filter(function (b) { return b !== f.B; }); });
        var f0 = found[0], L0 = f0.B.lines[0], pgw = f0.pg.w || first.w;
        var xs = [], xe = [];
        f0.B.lines.forEach(function (L) { (L.frags || []).forEach(function (fr) { xs.push(fr.x0); xe.push(fr.x1 != null ? fr.x1 : fr.x0); }); });
        var cx = xs.length ? (Math.min.apply(null, xs) + Math.max.apply(null, xe)) / 2 : pgw / 2;
        var pageNo = o.pages.indexOf(f0.pg) + 1;
        runHF[k] = { text: txt(f0.B), size: L0.size || o.body, jc: cx > pgw * 0.62 ? 'right' : cx < pgw * 0.38 ? 'left' : 'center', pageNo: pageNo,
          y: top ? f0.B.lines[0].y - (L0.size || 10) : (f0.pg.h || first.h) - f0.B.lines[f0.B.lines.length - 1].y };
      });
      if (runHF.head || runHF.foot) {
        var minTop = 1e9, maxBot = 0;
        flow.forEach(function (pg) { pg.blocks.forEach(function (B) {
          var t = B.table ? B.rowY[0][0] : B.lines ? B.lines[0].y - B.lines[0].size * 0.95 : B.top;
          var b = B.table ? B.rowY[B.rowY.length - 1][1] : B.lines ? B.lines[B.lines.length - 1].y + B.lines[B.lines.length - 1].size * 0.3 : (B.y || 0);
          if (isFinite(t)) minTop = Math.min(minTop, t); if (isFinite(b)) maxBot = Math.max(maxBot, (pg.h || first.h) - b);
        }); });
        if (runHF.head && minTop < 1e9) MT = clampM(Math.max(minTop, runHF.head.y + runHF.head.size * 2));
        if (runHF.foot && maxBot > 0) MB = clampM(Math.max(maxBot, runHF.foot.y + runHF.foot.size * 2));
      }
    })();
    function hfXml(tag, hf) {
      var sz = Math.max(12, Math.round(hf.size * 2)), rp = '<w:rPr><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
      var r = function (t) { return t ? '<w:r>' + rp + '<w:t xml:space="preserve">' + escXml(t) + '</w:t></w:r>' : ''; };
      var m = hf.text.match(/\d+/g), body;
      if (m && m.indexOf(String(hf.pageNo)) >= 0) {
        var at = hf.text.search(new RegExp('(^|\\D)' + hf.pageNo + '(\\D|$)')); if (at > 0 || hf.text.charAt(0) !== String(hf.pageNo).charAt(0)) at = hf.text.indexOf(String(hf.pageNo), at < 0 ? 0 : at);
        body = r(hf.text.slice(0, at)) + '<w:r>' + rp + '<w:fldChar w:fldCharType="begin"/></w:r><w:r>' + rp + '<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>' + rp + '<w:fldChar w:fldCharType="separate"/></w:r>' + r(String(hf.pageNo)) + '<w:r>' + rp + '<w:fldChar w:fldCharType="end"/></w:r>' + r(hf.text.slice(at + String(hf.pageNo).length));
      } else body = r(hf.text);
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:' + tag + ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="' + hf.jc + '"/></w:pPr>' + body + '</w:p></w:' + tag + '>';
    }
    var contentW = first.w - ML - MR;
    var bodyHalf = Math.max(12, Math.min(48, Math.round(o.body * 2)));
    var rtlDoc = RTL_LANG.test(o.lang);
    function countWords(s) { var t = s.trim(); if (t) words += t.split(/\s+/u).length; }
    function rPr(it, extra, head, rtl) {
      var x = '';
      if (extra && extra.indexOf('rStyle') >= 0) { x += extra; extra = ''; }
      if (it.family && it.family !== o.bodyFont) x += '<w:rFonts w:ascii="' + it.family + '" w:hAnsi="' + it.family + '" w:cs="' + it.family + '"/>';
      if (it.bold) x += '<w:b/><w:bCs/>'; else if (head) x += '<w:b w:val="0"/><w:bCs w:val="0"/>';
      if (it.italic) x += '<w:i/><w:iCs/>';
      if (it.color) x += '<w:color w:val="' + it.color + '"/>';
      if (it.size) { var hs = Math.max(8, Math.min(144, Math.round(it.size * 2))); if (hs !== bodyHalf || head) x += '<w:sz w:val="' + hs + '"/><w:szCs w:val="' + hs + '"/>'; }
      if (extra) x += extra;
      if (it.hl) x += '<w:shd w:val="clear" w:color="auto" w:fill="' + it.hl + '"/>';
      if (rtl) x += '<w:rtl/>';
      return x ? '<w:rPr>' + x + '</w:rPr>' : '';
    }
    function run(t, pr) { return '<w:r>' + pr + '<w:t xml:space="preserve">' + escXml(t).split('\t').join('</w:t><w:tab/><w:t xml:space="preserve">') + '</w:t></w:r>'; }
    function link(url, inner) {
      var id = 'rIdL' + (rels.length + 1);
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + escXml(url) + '" TargetMode="External"/>');
      return '<w:hyperlink r:id="' + id + '">' + inner + '</w:hyperlink>';
    }
    /* runs for a list of items, merging items with the same style */
    function itemRuns(items, isHead, rtl) {
      var xml = '', plain = '', buf = '', style = null, curLink = null, linkXml = '';
      function flush() {
        if (!buf) return;
        var pr = rPr(style, curLink ? '<w:rStyle w:val="Hyperlink"/>' : '', isHead, rtl);
        var r = run(buf, pr);
        if (curLink) linkXml += r; else xml += r;
        buf = '';
      }
      function endLink() { if (curLink) { flush(); xml += link(curLink, linkXml); linkXml = ''; curLink = null; } }
      items.forEach(function (it, i) {
        var s = it.str;
        if (i > 0) { var p = items[i - 1]; if (Math.max(it.x0 - p.x1, p.x0 - it.x1) > 0.15 * Math.min(it.size, p.size) && !/\s$/.test(plain) && !/^\s/.test(s)) s = ' ' + s; }
        var key = { color: it.color || null, hl: it.hl || null, family: it.family, bold: it.bold, italic: it.italic, size: isHead ? it.size : (Math.abs(it.size - o.body) < 0.6 ? 0 : it.size) };
        var same = style && style.color === key.color && style.hl === key.hl && style.family === key.family && style.bold === key.bold && style.italic === key.italic && Math.abs((style.size || 0) - (key.size || 0)) < 0.6;
        if ((it.link || null) !== curLink) { if (curLink) endLink(); else flush(); curLink = it.link || null; style = key; }
        else if (!same) { flush(); style = key; }
        buf += s; plain += s;
      });
      if (curLink) endLink(); else flush();
      return { xml: xml, plain: plain };
    }
    function pPr(p, styleId) {
      var x = '';
      if (styleId) x += '<w:pStyle w:val="' + styleId + '"/>';
      if (p.numbered) x += '<w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>';
      if (p.rtl) x += '<w:bidi/>';
      if (p.spaceXml) x += p.spaceXml;
      if (p.numbered) x += '<w:ind w:left="567" w:hanging="567"/>';
      else if (p.bullet) x += (p.symBullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '') + '<w:ind w:left="' + (360 + tw(p.indent || 0)) + '" w:hanging="360"/>';
      else if (p.indent) x += '<w:ind w:left="' + Math.min(tw(p.indent), tw(contentW * 0.6)) + '"/>';
      if (p.align) x += '<w:jc w:val="' + (p.align === 'right' ? 'right' : p.align) + '"/>';
      else if (p.rtl) x += '<w:jc w:val="right"/>';
      return x ? '<w:pPr>' + x + '</w:pPr>' : '';
    }
    function paraXml(p) {
      var styleId = p.head ? 'Heading' + (p.level || 2) : '';
      if (p.plain) { countWords(p.plain); text.push(p.plain); paras++; return '<w:p>' + run(p.plain, rPr({ size: o.body * 0.9 })) + '</w:p>'; }
      if (p.ocr) {
        p.numbered = /^\(?\d{1,3}[.)]?\t/.test(p.texts[0] || '');
        var rp = p.rtl ? '<w:rPr><w:rtl/><w:lang w:bidi="' + (/ara/.test(o.lang) ? 'ar-SA' : /fas/.test(o.lang) ? 'fa-IR' : /heb/.test(o.lang) ? 'he-IL' : 'ur-PK') + '"/></w:rPr>' : '';
        var xml = '', plain = '';
        p.texts.forEach(function (t, i) {
          if (i > 0) {
            if (p.joins[i - 1] === 'break') { xml += '<w:r>' + rp + '<w:br/></w:r>'; plain += '\n'; }
            else if (/[A-Za-z]-$/.test(plain) && /^[a-z]/.test(t)) { plain = plain.slice(0, -1); xml = xml.replace(/-<\/w:t><\/w:r>$/, '</w:t></w:r>'); }
            else if (/[0-9]-$/.test(plain) && /^[0-9]/.test(t)) { /* phone or number cut at the hyphen */ }
            else { t = ' ' + t; }
          }
          xml += run(t, rp); plain += t;
        });
        countWords(plain); text.push(plain); paras++;
        return '<w:p>' + pPr(p, styleId) + (p.anchors || '') + xml + '</w:p>';
      }
      var xmlP = '', plainP = '';
      p.lines.forEach(function (L, i) {
        var items = [];
        L.frags.forEach(function (f, fi) {
          if (fi > 0 && f.items.length) { var sp = { str: ' ', x0: f.x0, x1: f.x0, size: f.size, family: f.items[0].family, bold: f.items[0].bold, italic: f.items[0].italic, link: null }; items.push(sp); }
          f.items.forEach(function (it) { items.push(it); });
        });
        if (i > 0) {
          var j = p.joins[i - 1];
          if (j === 'break') { xmlP += '<w:r><w:br/></w:r>'; plainP += '\n'; }
          else if (/[A-Za-z]-$/.test(plainP) && /^[a-z]/.test(L.text)) {
            // re-join a hyphenated word
            xmlP = xmlP.replace(/-<\/w:t><\/w:r>(<\/w:hyperlink>)?$/, '</w:t></w:r>$1'); plainP = plainP.slice(0, -1);
          } else if (/[0-9]-$/.test(plainP) && /^[0-9]/.test(L.text)) { /* number cut at the hyphen */ }
          else if (!/\s$/.test(plainP)) { xmlP += run(' ', ''); plainP += ' '; }
        }
        var rr = itemRuns(items, !!p.head, p.rtl);
        xmlP += rr.xml; plainP += rr.plain;
      });
      if (p.bullet && !p.head && /^\s*[•●▪■◦‣∙·○◆►✓✔]\s*/.test(plainP)) {
        var stripped = xmlP.replace(/(<w:t[^>]*>)\s*[•●▪■◦‣∙·○◆►✓✔][\s\u00a0]*/, '$1');
        if (stripped !== xmlP) { xmlP = stripped.replace(/<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:t[^>]*><\/w:t><\/w:r>/, ''); plainP = plainP.replace(/^\s*[•●▪■◦‣∙·○◆►✓✔][\s\u00a0]*/, ''); p.symBullet = true; usedBullets = true; }
      }
      plainP = plainP.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
      if (!plainP) return '';
      countWords(plainP); text.push((p.bullet ? '' : '') + plainP); paras++;
      return '<w:p>' + pPr(p, styleId) + (p.anchors || '') + xmlP + '</w:p>';
    }
    function tableXml(t) {
      var total = t.widths.reduce(function (a, b) { return a + b; }, 0), scale = Math.min(1, contentW / total);
      var grid = t.widths.map(function (w) { return '<w:gridCol w:w="' + tw(w * scale) + '"/>'; }).join('');
      var rowsXml = '', tlines = [];
      t.rows.forEach(function (cells, ri) {
        var rx = '', tl = [];
        cells.forEach(function (fr, ci) {
          var items = [];
          fr.sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; }).forEach(function (f, fi) {
            if (fi > 0) items.push({ str: ' ', x0: f.x0, x1: f.x0, size: f.size, family: f.items[0].family, bold: false, italic: false });
            f.items.forEach(function (it) { items.push(it); });
          });
          var rr = items.length ? itemRuns(items, false) : { xml: '', plain: '' };
          tl.push(rr.plain.trim()); countWords(rr.plain);
          var shd = t.fills && t.fills[ri] && t.fills[ri][ci] ? '<w:shd w:val="clear" w:color="auto" w:fill="' + t.fills[ri][ci] + '"/>' : '';
          rx += '<w:tc><w:tcPr><w:tcW w:w="' + tw(t.widths[ci] * scale) + '" w:type="dxa"/>' + shd + '<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>' + rr.xml + '</w:p></w:tc>';
        });
        rowsXml += '<w:tr>' + (t.pitch && t.pitch < t.size * 3.2 ? '<w:trPr><w:trHeight w:val="' + tw(t.pitch) + '" w:hRule="atLeast"/></w:trPr>' : '') + rx + '</w:tr>'; tlines.push(tl.join('\t'));
      });
      tables++; text.push(tlines.join('\n'));
      var bd = t.border === undefined ? { color: '999999', sz: 4 } : t.border;
      var b = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (e) { return bd ? '<w:' + e + ' w:val="single" w:sz="' + bd.sz + '" w:space="0" w:color="' + bd.color + '"/>' : '<w:' + e + ' w:val="nil"/>'; }).join('');
      return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + b + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + rowsXml + '</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
    }
    /* image floating at its PDF position: across the page from the page edge, up/down from the paragraph it sits next to */
    async function anchorXml(im, relTop) {
      var idx = media.length + 1, id = 'rIdImg' + idx, name = 'image' + idx + '.' + im.ext;
      media.push({ name: name, blob: im.blob });
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + name + '"/>');
      var s = Math.min(1, (first.w - 4) / im.wPt), cx = emu(im.wPt * s), cy = emu(im.hPt * s), did = 100 + idx;
      images++; text.push('[Image]');
      return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="57150" distR="57150" simplePos="0" relativeHeight="' + (2 + idx) + '" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' + emu(Math.max(0, Math.min(im.x0, first.w - im.wPt * s))) + '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>' + Math.round((im.top - relTop) * 12700) + '</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="' + did + '" name="Picture ' + idx + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
    }
    async function imageXml(im) {
      var idx = media.length + 1, id = 'rIdImg' + idx, name = 'image' + idx + '.' + im.ext;
      media.push({ name: name, blob: im.blob });
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + name + '"/>');
      var w = im.wPt, h = im.hPt, maxW = contentW, maxH = first.h - MT - MB - 20;
      var s = Math.min(1, maxW / w, maxH / h); w *= s; h *= s;
      var cx = emu(w), cy = emu(h), did = 100 + idx;
      images++; text.push('[Image]');
      var jc = Math.abs((im.x0 + im.x1) / 2 - first.w / 2) < first.w * 0.1 ? 'center' : (im.x0 > first.w * 0.5 ? 'right' : 'left');
      return '<w:p><w:pPr><w:spacing w:after="60"/><w:jc w:val="' + jc + '"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="' + did + '" name="Picture ' + idx + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }
    /* Exact layout: page picture (lines, colours, images, signatures, no text) behind editable text placed where it was */
    async function exactPage(pg) {
      var xml = '', lines = [];
      if (pg.bg) {
        var idx = media.length + 1, id = 'rIdImg' + idx, name = 'page' + idx + '.jpeg';
        media.push({ name: name, blob: pg.bg });
        rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + name + '"/>');
        var cx = emu(pg.w), cy = emu(pg.h), did = 100 + idx;
        xml += '<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="' + did + '" name="Page ' + idx + '"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
      }
      // stretch or squeeze the replacement font so each line keeps the width it had in the PDF
      function fitWidth(xml, its, wantPt) {
        if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
        var have = 0;
        its.forEach(function (it) { measureCtx.font = (it.italic ? 'italic ' : '') + (it.bold ? 'bold ' : '') + '100px "' + (it.family || 'Arial') + '", Arial'; have += measureCtx.measureText(it.str).width / 100 * it.size; });
        if (!have || !wantPt) return xml;
        var pct = Math.round(Math.max(60, Math.min(140, wantPt / have * 100)));
        if (Math.abs(pct - 100) < 3) return xml;
        var tag = '<w:w w:val="' + pct + '"/>';
        xml = xml.replace(/<w:r><w:t/g, '<w:r><w:rPr>' + tag + '</w:rPr><w:t');
        return xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, function (m0, inner) {
          if (inner.indexOf('<w:w ') >= 0) return m0;
          var at = inner.search(/<w:(sz|szCs|shd|rtl)\b/);
          return '<w:rPr>' + (at < 0 ? inner + tag : inner.slice(0, at) + tag + inner.slice(at)) + '</w:rPr>';
        });
      }
      function frame(x0, top, wPt, size, inner, rtl) {
        if (x0 + wPt > pg.w - 2) wPt = Math.max(10, pg.w - 2 - x0);   // a frame past the page edge gets pushed left
        var lh = Math.max(6, size * 1.2), y = top;
        return '<w:p><w:pPr><w:framePr w:w="' + tw(wPt) + '" w:hRule="auto" w:wrap="around" w:hAnchor="page" w:vAnchor="page" w:x="' + tw(x0) + '" w:y="' + tw(Math.max(0, y)) + '"/>' + (rtl ? '<w:bidi/>' : '') + '<w:spacing w:before="0" w:after="0" w:line="' + Math.round(lh * 20) + '" w:lineRule="exact"/>' + (rtl ? '<w:jc w:val="right"/>' : '') + '</w:pPr>' + inner + '</w:p>';
      }
      if (pg.ocr) {
        (pg.ocrLines || []).forEach(function (l) {
          var pr = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="' + Math.round(l.size * 2) + '"/><w:szCs w:val="' + Math.round(l.size * 2) + '"/>' + (l.rtl ? '<w:rtl/>' : '') + '</w:rPr>';
          var pad = (l.x1 - l.x0) * 0.15 + 6;
          xml += frame(l.rtl ? l.x0 - pad : l.x0, l.y - l.size * 1.0, l.x1 - l.x0 + pad, l.size, run(l.text, pr), l.rtl);
          lines.push(l.text);
        });
      } else {
        buildFrags(pg.items, true).forEach(function (f) {
          var raw = f.items.map(function (q) { return q.str; }).join('');
          var rtl = (raw.match(RTL_CHARS) ? (raw.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g) || []).length : 0) > (raw.match(/[A-Za-z]/g) || []).length;
          var its = f.items.slice().sort(function (a, b) { return rtl ? b.x1 - a.x1 : a.x0 - b.x0; });
          its.forEach(function (q) { q.hl = null; });
          var rr = itemRuns(its, true, rtl);
          if (!rr.plain.trim()) return;
          rr.xml = fitWidth(rr.xml, its, f.x1 - f.x0);
          var pad = (f.x1 - f.x0) * 0.15 + 6;
          xml += frame(rtl ? f.x0 - pad : f.x0, f.y - f.size * 0.95, f.x1 - f.x0 + pad, f.size, rr.xml, rtl);
          lines.push(rr.plain);
        });
      }
      lines.forEach(function (t) { countWords(t); paras++; });
      text.push(lines.join('\n'));
      (pg.images || []).forEach(function () { });
      return xml;
    }
    for (var pi = 0; pi < o.pages.length; pi++) {
      var pg = o.pages[pi];
      if (pi > 0) { if (o.pageBreaks || o.exact || pg.exact || (o.pages[pi - 1] && o.pages[pi - 1].exact)) body += '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>'; text.push(''); }
      if (o.exact || pg.exact) { body += await exactPage(pg); continue; }
      var prevBottom = MT, pending = [];
      for (var bi = 0; bi < pg.blocks.length; bi++) {
        var B = pg.blocks[bi];
        if (B.img) { pending.push(B); continue; }
        var top = B.table ? B.rowY[0][0] : B.lines ? B.lines[0].y - B.lines[0].size * 0.95 : B.top;
        var bot = B.table ? B.rowY[B.rowY.length - 1][1] : B.lines ? B.lines[B.lines.length - 1].y + B.lines[B.lines.length - 1].size * 0.3 : B.y;
        var gap = top - prevBottom, before = gap > 1 && top >= prevBottom - 2 ? Math.min(gap, 600) : 0;
        var anchors = '';
        for (var ai = 0; ai < pending.length; ai++) anchors += await anchorXml(pending[ai], top - before);
        pending = [];
        if (B.table) {
          if (before > 1 || anchors) body += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="' + Math.max(20, tw(before)) + '" w:lineRule="exact"/></w:pPr>' + anchors + '</w:p>';
          body += tableXml(B);
        } else {
          var pitch = B.lines && B.lines.length > 1 ? (B.lines[B.lines.length - 1].y - B.lines[0].y) / (B.lines.length - 1) : 0;
          B.spaceXml = '<w:spacing w:before="' + tw(before) + '" w:after="0"' + (pitch > 4 && pitch < 40 && !B.joins.some(function (j) { return j === 'break'; }) ? ' w:line="' + tw(pitch) + '" w:lineRule="atLeast"' : '') + '/>';
          B.anchors = anchors;
          body += paraXml(B);
        }
        if (top >= prevBottom - 2 || bot > prevBottom) prevBottom = Math.max(prevBottom, bot);
      }
      if (pending.length) { var an = ''; for (var aj = 0; aj < pending.length; aj++) an += await anchorXml(pending[aj], prevBottom); body += '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>' + an + '</w:p>'; }
    }
    if (!body) body = '<w:p/>';
    var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    var land = first.w > first.h;
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS + '><w:body>' + body +
      '<w:sectPr>' + (runHF.head ? '<w:headerReference w:type="default" r:id="rIdH1"/>' : '') + (runHF.foot ? '<w:footerReference w:type="default" r:id="rIdF1"/>' : '') + '<w:pgSz w:w="' + tw(first.w) + '" w:h="' + tw(first.h) + '"' + (land ? ' w:orient="landscape"' : '') + '/><w:pgMar w:top="' + tw(MT) + '" w:right="' + tw(MR) + '" w:bottom="' + tw(MB) + '" w:left="' + tw(ML) + '" w:header="' + (runHF.head ? tw(Math.max(14, Math.min(MT - 6, runHF.head.y))) : 360) + '" w:footer="' + (runHF.foot ? tw(Math.max(14, Math.min(MB - 6, runHF.foot.y - runHF.foot.size))) : 360) + '" w:gutter="0"/>' + (rtlDoc ? '<w:bidi/>' : '') + '</w:sectPr></w:body></w:document>';
    var font = o.bodyFont;
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + font + '" w:eastAsia="' + font + '" w:hAnsi="' + font + '" w:cs="' + (rtlDoc ? 'Arial' : font) + '"/><w:sz w:val="' + bodyHalf + '"/><w:szCs w:val="' + bodyHalf + '"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="' + (/urd/.test(o.lang) ? 'ur-PK' : 'ar-SA') + '"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      [1, 2, 3].map(function (l) { var sz = l === 1 ? Math.max(bodyHalf + 12, 32) : l === 2 ? Math.max(bodyHalf + 6, 26) : bodyHalf + 2; return '<w:style w:type="paragraph" w:styleId="Heading' + l + '"><w:name w:val="heading ' + l + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + (l === 1 ? 240 : 180) + '" w:after="80"/><w:outlineLvl w:val="' + (l - 1) + '"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>'; }).join('') +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '</w:styles>';
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + (usedBullets ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : '') + (runHF.head ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') + (runHF.foot ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') + '</Types>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + escXml(st.base) + '</dc:title><dc:creator>PDFdukan PDF to Word</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created></cp:coreProperties>';
    var zip = new JSZip();
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    zip.file('docProps/core.xml', core);
    zip.file('word/document.xml', doc);
    zip.file('word/styles.xml', styles);
    if (usedBullets) {
      zip.file('word/numbering.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\u2022"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>');
      rels.push('<Relationship Id="rIdN1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>');
    }
    if (runHF.head) { zip.file('word/header1.xml', hfXml('hdr', runHF.head)); rels.push('<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'); }
    if (runHF.foot) { zip.file('word/footer1.xml', hfXml('ftr', runHF.foot)); rels.push('<Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'); }
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels.join('') + '</Relationships>');
    media.forEach(function (mm) { zip.file('word/media/' + mm.name, mm.blob); });
    var blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { blob: blob, text: text.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), words: words, paras: paras, tables: tables, images: images };
  }

  /* ── Result ──────────────────────────────────────────────── */
  function showResult(b, info) {
    var s = st.out.stats;
    $('statPages').textContent = s.pages;
    $('statWords').textContent = s.words.toLocaleString();
    $('statParas').textContent = s.paras;
    $('statTables').textContent = s.tables;
    $('statImages').textContent = s.images;
    $('statOcr').textContent = s.ocr ? s.ocr + (s.conf != null ? ' · ' + s.conf + '%' : '') : '0';
    var txt = b.text;
    var notes = [];
    if (s.ocr) notes.push(s.ocr + (s.ocr === 1 ? ' page was' : ' pages were') + ' read with OCR' + (s.conf != null ? ' (confidence estimate ' + s.conf + '%)' : '') + '. Check names, numbers and dates against the PDF.');
    if (info.ocrSkipped.length) notes.push('OCR stops at ' + MAX_OCR_PAGES + ' scanned pages per run. Pages ' + rangeText(info.ocrSkipped) + ' were not read; convert them in a second run with a page range.');
    if (info.ocrMode === 'off' && info.empty.length) notes.push('Pages ' + rangeText(info.empty) + ' have no text layer. Turn on OCR to read them.');
    else if (info.empty.length) notes.push('No text was found on page ' + rangeText(info.empty) + '.');
    if (info.garbled.length && info.ocrMode === 'off') notes.push('The text on page ' + rangeText(info.garbled) + ' looks broken (font without a text map). Choose "OCR every page" to read it from the image instead.');
    if (info.urdu && info.urdu.length) notes.push('Page ' + rangeText(info.urdu) + ' uses an Urdu Nastaleeq font whose text layer stores letters out of order, so it was read with Urdu OCR instead.');
    if (info.formy) notes.push('This PDF looks like a form or invoice with many boxes. If the Word layout looks mixed up, choose "Exact layout" and convert again.');
    if (info.capped) notes.push('Only the first ' + MAX_PAGES + ' pages were converted. Type a page range to convert the rest.');
    $('p2wNote').textContent = notes.join(' ');
    $('p2wNote').hidden = !notes.length;
    var found = !!b.text.replace(/\[Image\]/g, '').trim() || s.images;
    ['p2wDocx', 'p2wCopy', 'p2wTxt'].forEach(function (id) { $(id).disabled = !found; });
    var rs = $('resultSection'); rs.classList.add('show');
    say(found ? 'Your Word file is ready.' : 'No text was found in these pages.', found ? 'success' : 'info');
  }
  function rangeText(a) {
    var out = [], s = a[0], p = a[0];
    for (var i = 1; i <= a.length; i++) { if (a[i] === p + 1) { p = a[i]; continue; } out.push(s === p ? s : s + '-' + p); s = p = a[i]; }
    return out.join(', ');
  }
  function resetResult() {
    $('resultSection').classList.remove('show');
    ['statPages', 'statWords', 'statParas', 'statTables', 'statImages', 'statOcr'].forEach(function (id) { $(id).textContent = '—'; });
    $('p2wNote').hidden = true;
    ['p2wDocx', 'p2wCopy', 'p2wTxt'].forEach(function (id) { $(id).disabled = true; });
  }
  function save(blob, name, what) {
    var go = function (n) {
      if (!n) return;
      var u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = n; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      if (window.CMLogs) try { window.CMLogs.log({ tool: 'PDF to Word', action: what, input: st.file ? st.file.name : '', output: n, size: blob.size }); } catch (e) { }
    };
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(name).then(go); else go(name);
  }
  function clearAll(keepDrop) {
    if (st.busy) return;
    if (st.pdf) { try { st.pdf.destroy(); } catch (e) { } }
    st.file = st.bytes = st.pdf = st.out = null; st.password = '';
    $('p2wFile').hidden = true; $('p2wPwRow').hidden = true; $('p2wHint').hidden = true; $('p2wPw').value = ''; $('p2wPages').value = '';
    $('dropZone').classList.remove('p2w-has-file');
    $('p2wRunBtn').disabled = true; $('p2wClearBtn').disabled = true;
    if (!keepDrop) $('fileInput').value = '';
    resetResult();
  }

  function init() {
    var dz = $('dropZone'), fi = $('fileInput');
    if (!dz || !fi) return;
    dz.addEventListener('click', function (e) { if (e.target !== fi && !st.busy) fi.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('drag-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('drag-over'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) pickFile(f); });
    fi.addEventListener('change', function () { if (fi.files[0]) pickFile(fi.files[0]); fi.value = ''; });
    $('p2wRemove').addEventListener('click', function () { clearAll(); });
    $('p2wAgain').addEventListener('click', function () { clearAll(); });
    $('p2wClearBtn').addEventListener('click', function () { clearAll(); });
    $('p2wPwBtn').addEventListener('click', async function () { var v = $('p2wPw').value; if (!v) { say('Type the PDF password first.', 'info'); return; } try { await openPdf(v); } catch (e) { say('This PDF could not be opened.', 'error'); } });
    $('p2wPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('p2wPwBtn').click(); } });
    $('p2wRunBtn').addEventListener('click', run);
    $('p2wCancel').addEventListener('click', async function () {
      if (!st.busy) return; st.cancelled = true;
      if (st.worker) { try { await st.worker.terminate(); } catch (e) { } st.worker = null; st.workerLang = null; }
      st.busy = false; $('progressCard').style.display = 'none'; $('p2wRunBtn').disabled = !st.pdf; $('p2wClearBtn').disabled = false;
      if (window.PDLoader) window.PDLoader.hide();
      say('Conversion cancelled.', 'info');
    });
    try { var savedLang = localStorage.getItem('p2wLang'); if (savedLang && $('p2wLang').querySelector('option[value="' + savedLang + '"]')) $('p2wLang').value = savedLang; } catch (e) { }
    $('p2wLang').addEventListener('change', function () { try { localStorage.setItem('p2wLang', this.value); } catch (e) { } });
    $('p2wOcr').addEventListener('change', function () { $('p2wLangWrap').classList.toggle('p2w-dim', this.value === 'off'); });
    $('p2wDocx').addEventListener('click', function () { if (st.out && st.out.blob) save(st.out.blob, st.base + '.docx', 'convert'); });
    $('p2wTxt').addEventListener('click', function () { if (st.out) save(new Blob([st.out.text], { type: 'text/plain;charset=utf-8' }), st.base + '.txt', 'text'); });
    $('p2wCopy').addEventListener('click', function () {
      if (!st.out) return;
      navigator.clipboard.writeText(st.out.text.replace(/\[Image\]\n*/g, '')).then(function () { say('Text copied.', 'success'); }, function () { say('Copy failed. Select the text in the preview instead.', 'error'); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PDFToWord = { open: pickFile, run: run };
})();
