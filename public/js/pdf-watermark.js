/* Add Watermark to PDF — PDFdukan
 * Text or image watermark, 3x3 position or tiled, rotation, opacity, over/behind content,
 * page selection, several PDFs at once. Runs in the browser with pdf-lib and pdf.js.
 * The live preview uses the same layout maths as the saved PDF.
 */
(function () {
  'use strict';
  var MAXFILE = 200 * 1024 * 1024, MAXFILES = 20;
  var $ = function (id) { return document.getElementById(id); };
  var PL = function () { return window.PDFLib; };
  var Core = function () { return window.PDEditCore; };
  var STORE = 'pd-watermark-v1';

  var st = {
    files: [],          // {id,name,size,bytes,pages,doc(pdfjs),state,out,msg}
    cur: 0, page: 1,    // preview file index and page number
    imgData: null, imgW: 0, imgH: 0, imgName: '',
    busy: false
  };
  var seq = 0;
  var DEF = { type: 'text', text: 'CONFIDENTIAL', font: 'sans', bold: true, italic: false, size: 60, color: '#d32f2f',
    imgScale: 40, pos: 'mc', tile: false, gap: 60, rot: 45, opacity: 30, layer: 'over', pages: 'all', range: '' };
  var S = load();

  function load() { var o = {}; try { o = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) {} var s = {}; Object.keys(DEF).forEach(function (k) { s[k] = o[k] !== undefined ? o[k] : DEF[k]; }); return s; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function say(m, t) { if (window.toast) toast(m, t || 'info'); }

  /* ---------- page selection ---------- */
  function pickPages(n) {
    var out = [];
    if (S.pages === 'odd') { for (var i = 1; i <= n; i += 2) out.push(i); return out; }
    if (S.pages === 'even') { for (var j = 2; j <= n; j += 2) out.push(j); return out; }
    if (S.pages === 'first') return n ? [1] : [];
    if (S.pages === 'range') {
      var set = {};
      String(S.range || '').split(/[,;\s]+/).forEach(function (part) {
        if (!part) return;
        var m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
        if (m) { var a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n; for (var k = Math.max(1, a); k <= Math.min(n, b); k++) set[k] = 1; }
        else if (/^\d+$/.test(part) && +part >= 1 && +part <= n) set[+part] = 1;
      });
      return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    }
    for (var p = 1; p <= n; p++) out.push(p);
    return out;
  }

  /* ---------- layout (shared by preview and output) ----------
     All maths is in "visual" page points: origin bottom-left of the page as it is shown,
     angle counter-clockwise. Returns the centres where marks go. */
  function centers(vw, vh, bw, bh, rotDeg) {
    var t = rotDeg * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    var ex = (bw * c + bh * s) / 2, ey = (bw * s + bh * c) / 2;   // half extents of the rotated box
    if (S.tile) {
      var gx = ex * 2 + S.gap, gy = ey * 2 + S.gap, pts = [], row = 0;
      for (var y = gy / 2; y < vh + gy; y += gy, row++) {
        for (var x = (row % 2 ? gx : gx / 2); x < vw + gx; x += gx) pts.push([x - (row % 2 ? gx / 2 : 0), y]);
      }
      return pts;
    }
    var m = Math.min(36, vw * 0.06), col = S.pos[1], rw = S.pos[0];
    var cx = col === 'l' ? m + ex : col === 'r' ? vw - m - ex : vw / 2;
    var cy = rw === 't' ? vh - m - ey : rw === 'b' ? m + ey : vh / 2;
    return [[cx, cy]];
  }

  /* map a visual point to the page's own (unrotated) user space */
  function toUser(box, R, vx, vy) {
    var x0 = box.x, y0 = box.y, W = box.width, H = box.height;
    if (R === 90) return [x0 + W - vy, y0 + vx];
    if (R === 180) return [x0 + W - vx, y0 + H - vy];
    if (R === 270) return [x0 + vy, y0 + H - vx];
    return [x0 + vx, y0 + vy];
  }

  /* ---------- what the mark is ---------- */
  function needsImageText(t) { for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); if (c > 0x24F && !(c >= 0x2000 && c <= 0x206F) && !(c >= 0x20A0 && c <= 0x20CF) && c !== 0xA9 && c !== 0xAE) return true; } return false; }
  function isRtl(t) { return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(t); }
  function cssFamily() {
    var C = Core(); if (!C) return 'Arial, sans-serif';
    return isRtl(S.text) ? C.cssStack(S.font === 'serif' ? 'naskh' : 'nastaliq') : C.cssStack(S.font);
  }
  function ensureCssFont() {
    var C = Core(); if (!C) return Promise.resolve();
    var fam = isRtl(S.text) ? 'nastaliq' : S.font;
    return C.cssFace(fam, S.bold, S.italic).catch(function () {});
  }
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }

  /* text drawn as a sharp transparent picture (any script, shaped by the browser) */
  function textPng(text, pt) {
    var scale = 4, fs = pt * scale, fam = cssFamily();
    var c = document.createElement('canvas'), g = c.getContext('2d');
    var font = (S.italic ? 'italic ' : '') + (S.bold ? 'bold ' : '') + fs + 'px ' + fam;
    g.font = font; var w = Math.ceil(g.measureText(text).width + fs * 0.3), h = Math.ceil(fs * (isRtl(text) ? 2.0 : 1.4));
    c.width = Math.max(2, w); c.height = Math.max(2, h); g = c.getContext('2d');
    g.font = font; g.fillStyle = S.color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = isRtl(text) ? 'rtl' : 'ltr';
    g.fillText(text, c.width / 2, c.height / 2);
    return { url: c.toDataURL('image/png'), w: c.width / scale, h: c.height / scale, tw: (w - fs * 0.3) / scale };
  }

  /* ---------- image watermark input ---------- */
  function readImage(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          // PNG and JPG go in as they are; other formats (WebP, SVG, GIF, BMP) become PNG
          var keep = /^image\/(png|jpeg)$/.test(file.type);
          if (keep) return res({ url: fr.result, w: im.naturalWidth, h: im.naturalHeight });
          var w = im.naturalWidth || 800, h = im.naturalHeight || 800, k = Math.min(1, 2400 / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          res({ url: c.toDataURL('image/png'), w: c.width, h: c.height });
        };
        im.onerror = function () { rej(new Error('img')); };
        im.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  /* ---------- preview ---------- */
  var drawTok = 0;
  async function preview() {
    var f = st.files[st.cur]; if (!f || !f.doc) return;
    var tok = ++drawTok;
    var marked = pickPages(f.pages);
    if (marked.length && marked.indexOf(st.page) < 0 && st.autoJump) st.page = marked[0];
    st.autoJump = false;
    var pageNo = Math.min(Math.max(1, st.page), f.pages); st.page = pageNo;
    var page = await f.doc.getPage(pageNo); if (tok !== drawTok) return;
    var base = page.getViewport({ scale: 1 });
    var box = $('wmStage'), maxW = Math.min(box.clientWidth || 520, 560), k = maxW / base.width;
    if (base.height * k > 620) k = 620 / base.height;
    var vp = page.getViewport({ scale: k * (window.devicePixelRatio || 1) });
    var cv = $('wmCanvas'); cv.width = vp.width; cv.height = vp.height;
    cv.style.width = Math.round(base.width * k) + 'px'; cv.style.height = Math.round(base.height * k) + 'px';
    var g = cv.getContext('2d');
    await page.render({ canvasContext: g, viewport: vp }).promise; if (tok !== drawTok) return;
    var on = pickPages(f.pages).indexOf(pageNo) >= 0;
    $('wmPageInfo').textContent = 'Page ' + pageNo + ' of ' + f.pages + (on ? '' : ' · no watermark on this page');
    $('wmPrev').disabled = pageNo <= 1; $('wmNext').disabled = pageNo >= f.pages;
    if (!on) return;
    await ensureCssFont(); if (tok !== drawTok) return;
    var sc = vp.width / base.width, vw = base.width, vh = base.height;
    var mark = await markForPreview(); if (!mark || tok !== drawTok) return;
    var pts = centers(vw, vh, mark.lw || mark.w, mark.lh || mark.h, S.rot);
    g.save(); g.globalAlpha = S.opacity / 100;
    if (S.layer === 'under') g.globalCompositeOperation = 'multiply';
    pts.forEach(function (p) {
      g.save(); g.translate(p[0] * sc, (vh - p[1]) * sc); g.rotate(-S.rot * Math.PI / 180);
      g.drawImage(mark.img, -mark.w * sc / 2, -mark.h * sc / 2, mark.w * sc, mark.h * sc);
      g.restore();
    });
    g.restore();
  }
  var pvCache = { key: '', mark: null };
  async function markForPreview() {
    var key = S.type === 'text' ? ['t', S.text, S.font, S.bold, S.italic, S.size, S.color].join('|') : ['i', st.imgName, S.imgScale, st.imgW].join('|');
    if (pvCache.key === key && pvCache.mark) return scaleMark(pvCache.mark);
    var m;
    if (S.type === 'text') {
      if (!S.text.trim()) return null;
      var p = textPng(S.text, S.size), img = needsImageText(S.text);
      // layout box = what the saved PDF uses (font width x 0.72 em for normal text, the picture for other scripts)
      m = { url: p.url, w: p.w, h: p.h, lw: img ? p.w : p.tw, lh: img ? p.h : S.size * 0.72, text: true };
    } else {
      if (!st.imgData) return null;
      m = { url: st.imgData, w: st.imgW, h: st.imgH, text: false };
    }
    m.img = await new Promise(function (r) { var im = new Image(); im.onload = function () { r(im); }; im.src = m.url; });
    pvCache = { key: key, mark: m };
    return scaleMark(m);
  }
  function scaleMark(m) {
    if (m.text) return m;
    var f = st.files[st.cur]; var pw = f && f.pw1 ? f.pw1 : 600;
    var w = pw * S.imgScale / 100, h = w * m.h / m.w;
    return { img: m.img, w: w, h: h, lw: w, lh: h };
  }
  var pvTimer = null;
  function schedule() { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 90); }

  /* ---------- build one watermarked PDF ---------- */
  async function build(f) {
    var L = PL(), doc;
    try { doc = await L.PDFDocument.load(f.bytes, { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && e.message))) { var er = new Error('locked'); throw er; }
      throw e;
    }
    var pages = doc.getPages(), list = pickPages(pages.length);
    if (!list.length) throw new Error('nopages');
    var op = S.opacity / 100, mark = null, font = null, png = null, col = null;

    if (S.type === 'text') {
      var txt = S.text.trim(); if (!txt) throw new Error('notext');
      if (needsImageText(txt)) {
        await ensureCssFont();
        var p = textPng(txt, S.size);
        png = await doc.embedPng(p.url); mark = { w: p.w, h: p.h };
      } else {
        try { font = await Core().embedFor(doc, txt, { choice: S.font, bold: S.bold, italic: S.italic }); }
        catch (e) { font = await doc.embedFont(S.font === 'serif' ? (S.bold ? L.StandardFonts.TimesRomanBold : L.StandardFonts.TimesRoman) : S.font === 'mono' ? (S.bold ? L.StandardFonts.CourierBold : L.StandardFonts.Courier) : (S.bold ? L.StandardFonts.HelveticaBold : L.StandardFonts.Helvetica)); }
        var c = hexRgb(S.color); col = L.rgb(c[0], c[1], c[2]);
        mark = { w: font.widthOfTextAtSize(txt, S.size), h: S.size * 0.72 };
      }
    } else {
      if (!st.imgData) throw new Error('noimage');
      var bytes = Uint8Array.from(atob(st.imgData.split(',')[1]), function (ch) { return ch.charCodeAt(0); });
      png = /^data:image\/jpeg/.test(st.imgData) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    }

    list.forEach(function (n) {
      var page = pages[n - 1];
      var R = ((page.getRotation().angle % 360) + 360) % 360;
      var box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
      var vw = (R === 90 || R === 270) ? box.height : box.width, vh = (R === 90 || R === 270) ? box.width : box.height;
      var mw, mh;
      if (S.type === 'image') { mw = vw * S.imgScale / 100; mh = mw * png.height / png.width; }
      else { mw = mark.w; mh = mark.h; }
      var pts = centers(vw, vh, mw, mh, S.rot);
      var ang = S.rot + R, t = ang * Math.PI / 180, ct = Math.cos(t), stn = Math.sin(t);
      pts.forEach(function (pt) {
        var u = toUser(box, R, pt[0], pt[1]);
        if (font) {
          // centre of the text = baseline start + (w/2, h/2) rotated
          var ox = u[0] - (mw / 2 * ct - mh / 2 * stn), oy = u[1] - (mw / 2 * stn + mh / 2 * ct);
          page.drawText(S.text.trim(), { x: ox, y: oy, size: S.size, font: font, color: col, opacity: op, rotate: L.degrees(ang) });
        } else {
          var ix = u[0] - (mw / 2 * ct - mh / 2 * stn), iy = u[1] - (mw / 2 * stn + mh / 2 * ct);
          page.drawImage(png, { x: ix, y: iy, width: mw, height: mh, opacity: op, rotate: L.degrees(ang) });
        }
      });
      if (S.layer === 'under') moveBehind(page);
    });
    return doc.save();
  }
  /* put the stream pdf-lib added for the watermark in front of the page's own content */
  function moveBehind(page) {
    var L = PL(), ref = page.contentStreamRef, arr = page.node.Contents();
    if (!ref || !(arr instanceof L.PDFArray)) return;
    var items = arr.asArray().filter(function (r) { return r !== ref; });
    page.node.set(L.PDFName.of('Contents'), page.doc.context.obj([ref].concat(items)));
  }

  /* ---------- run ---------- */
  async function applyAll() {
    if (st.busy || !st.files.length) return;
    if (S.type === 'text' && !S.text.trim()) { say('Type the watermark text first.', 'error'); $('wmText').focus(); return; }
    if (S.type === 'image' && !st.imgData) { say('Choose a logo or image first.', 'error'); return; }
    st.busy = true; drawFiles();
    if (window.PDLoader) PDLoader.show('Adding watermark…', st.files.length + ' file' + (st.files.length > 1 ? 's' : ''));
    var ok = 0;
    for (var i = 0; i < st.files.length; i++) {
      var f = st.files[i];
      if (window.PDLoader) PDLoader.update('Adding watermark…', 'File ' + (i + 1) + ' of ' + st.files.length);
      try {
        var out = await build(f); f.out = out; f.state = 'done';
        f.msg = pickPages(f.pages).length + ' of ' + f.pages + ' pages marked · ' + size(out.length); ok++;
      } catch (e) {
        f.out = null; f.state = 'fail';
        f.msg = e.message === 'locked' ? 'This PDF is locked against changes.' : e.message === 'nopages' ? 'No pages match your page selection.' : 'Could not add the watermark to this file.';
        if (e.message !== 'locked' && e.message !== 'nopages') console.error(e);
      }
    }
    if (window.PDLoader) PDLoader.hide();
    st.busy = false; drawFiles();
    if (st.files.some(function (f) { return f.state === 'fail' && /locked/.test(f.msg); })) $('wmInfo').innerHTML = 'A locked PDF can’t take a watermark. Remove its restrictions with <a href="unlock-pdf-without-password.html">Unlock PDF</a>, then add it again.';
    if (ok) { say('Watermark added to ' + ok + ' file' + (ok > 1 ? 's' : '') + '.', 'success'); if (window.trackToolUse) trackToolUse('watermark'); }
    if (ok === 1 && st.files.length === 1) download(st.files[0]);
  }
  function outName(f) { return f.name.replace(/\.pdf$/i, '') + '-watermarked.pdf'; }
  function download(f) {
    if (!f.out) return;
    var b = new Blob([f.out], { type: 'application/pdf' }), u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u; a.download = outName(f); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  async function downloadZip() {
    var done = st.files.filter(function (f) { return f.out; }); if (!done.length) return;
    if (done.length === 1 || !window.JSZip) { done.forEach(download); return; }
    var z = new JSZip(), used = {};
    done.forEach(function (f) { var n = outName(f), k = 2; while (used[n]) n = outName(f).replace(/\.pdf$/, '-' + (k++) + '.pdf'); used[n] = 1; z.file(n, f.out); });
    var blob = await z.generateAsync({ type: 'blob' }), u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = 'watermarked-pdfs.zip'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  /* ---------- files ---------- */
  async function addFiles(list) {
    var arr = Array.prototype.slice.call(list || []), skipped = [];
    for (var i = 0; i < arr.length; i++) {
      var file = arr[i];
      if (st.files.length >= MAXFILES) { skipped.push(file.name + ' (max ' + MAXFILES + ')'); continue; }
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { skipped.push(file.name + ' (not a PDF)'); continue; }
      if (file.size > MAXFILE) { skipped.push(file.name + ' (over 200 MB)'); continue; }
      var f = { id: ++seq, name: file.name, size: file.size, state: 'ready', msg: '' };
      try {
        f.bytes = new Uint8Array(await file.arrayBuffer());
        f.doc = await pdfjsLib.getDocument({ data: f.bytes.slice(0), isEvalSupported: false }).promise;
        f.pages = f.doc.numPages;
        var p1 = await f.doc.getPage(1); f.pw1 = p1.getViewport({ scale: 1 }).width;
        f.msg = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + size(f.size);
        st.files.push(f);
      } catch (e) {
        skipped.push(file.name + (e && e.name === 'PasswordException' ? ' (needs a password, unlock it first)' : ' (could not be opened)'));
      }
    }
    $('wmInfo').innerHTML = skipped.length ? 'Skipped: ' + esc(skipped.join(', ')) + (skipped.some(function (s) { return /password/.test(s); }) ? ' · <a href="unlock-pdf-without-password.html">Unlock PDF</a>' : '') : '';
    if (st.files.length) { $('wmUpload').hidden = true; $('wmEditor').hidden = false; st.cur = Math.min(st.cur, st.files.length - 1); }
    drawFiles(); schedule();
  }
  function drawFiles() {
    var h = st.files.map(function (f, i) {
      var cls = 'wm-file' + (i === st.cur ? ' on' : '') + (f.state === 'done' ? ' done' : f.state === 'fail' ? ' fail' : '');
      return '<div class="' + cls + '" data-i="' + i + '"><button class="wm-fsel" type="button" data-a="sel" title="Preview this file"><b>' + esc(f.name) + '</b><span>' + esc(f.msg) + '</span></button>' +
        (f.out ? '<button class="btn btn-primary wm-dl" type="button" data-a="dl">Download</button>' : '') +
        '<button class="wm-x" type="button" data-a="rm" aria-label="Remove ' + esc(f.name) + '">✕</button></div>';
    }).join('');
    $('wmFiles').innerHTML = h;
    var done = st.files.filter(function (f) { return f.out; }).length;
    $('wmZip').hidden = done < 2;
    $('wmApply').disabled = st.busy || !st.files.length;
    $('wmApply').textContent = st.files.length > 1 ? 'Add watermark to ' + st.files.length + ' PDFs' : 'Add watermark';
    if (!st.files.length) { $('wmUpload').hidden = false; $('wmEditor').hidden = true; }
  }

  /* ---------- controls ---------- */
  function syncUI() {
    $('wmTypeText').classList.toggle('on', S.type === 'text'); $('wmTypeImage').classList.toggle('on', S.type === 'image');
    $('wmTypeText').setAttribute('aria-pressed', S.type === 'text'); $('wmTypeImage').setAttribute('aria-pressed', S.type === 'image');
    $('wmTextBox').hidden = S.type !== 'text'; $('wmImageBox').hidden = S.type !== 'image';
    $('wmText').value = S.text; $('wmFont').value = S.font; $('wmSize').value = S.size; $('wmSizeV').textContent = S.size + ' pt';
    $('wmColor').value = S.color; $('wmBold').classList.toggle('on', S.bold); $('wmItalic').classList.toggle('on', S.italic);
    $('wmBold').setAttribute('aria-pressed', S.bold); $('wmItalic').setAttribute('aria-pressed', S.italic);
    $('wmImgScale').value = S.imgScale; $('wmImgScaleV').textContent = S.imgScale + '%';
    $('wmOpacity').value = S.opacity; $('wmOpacityV').textContent = S.opacity + '%';
    $('wmRot').value = S.rot; $('wmRotV').textContent = S.rot + '°';
    $('wmGap').value = S.gap; $('wmGapV').textContent = S.gap + ' pt'; $('wmGapRow').hidden = !S.tile;
    $('wmTile').checked = S.tile;
    Array.prototype.forEach.call(document.querySelectorAll('.wm-pos button'), function (b) { var on = !S.tile && b.getAttribute('data-p') === S.pos; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.disabled = S.tile; });
    Array.prototype.forEach.call(document.querySelectorAll('.wm-rotq button'), function (b) { b.classList.toggle('on', +b.getAttribute('data-r') === +S.rot); });
    $('wmLayerOver').checked = S.layer === 'over'; $('wmLayerUnder').checked = S.layer === 'under';
    $('wmPages').value = S.pages; $('wmRange').hidden = S.pages !== 'range'; $('wmRange').value = S.range;
    $('wmImgName').textContent = st.imgName ? st.imgName : 'No image chosen';
  }
  function set(k, v) { S[k] = v; if (k === 'pages' || k === 'range') st.autoJump = true; save(); syncUI(); schedule(); st.files.forEach(function (f) { if (f.out) { f.out = null; f.state = 'ready'; f.msg = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + size(f.size); } }); drawFiles(); }

  function init() {
    if (!$('wmDrop')) return;
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var C = Core();
    if (C && C.CHOICES) $('wmFont').innerHTML = C.CHOICES.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
    var dz = $('wmDrop'), inp = $('wmFileInput');
    dz.onclick = function () { inp.click(); };
    dz.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = function (e) { addFiles(e.target.files); inp.value = ''; };
    $('wmMoreInput').onchange = function (e) { addFiles(e.target.files); e.target.value = ''; };
    $('wmMore').onclick = function () { $('wmMoreInput').click(); };
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
    $('wmEditor').addEventListener('dragover', function (e) { e.preventDefault(); });
    $('wmEditor').addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    $('wmTypeText').onclick = function () { set('type', 'text'); };
    $('wmTypeImage').onclick = function () { set('type', 'image'); };
    $('wmText').oninput = function () { S.text = this.value; save(); schedule(); };
    $('wmText').onchange = function () { set('text', this.value); };
    $('wmFont').onchange = function () { set('font', this.value); };
    $('wmBold').onclick = function () { set('bold', !S.bold); };
    $('wmItalic').onclick = function () { set('italic', !S.italic); };
    $('wmSize').oninput = function () { S.size = +this.value; $('wmSizeV').textContent = S.size + ' pt'; schedule(); };
    $('wmSize').onchange = function () { set('size', +this.value); };
    $('wmColor').oninput = function () { S.color = this.value; schedule(); };
    $('wmColor').onchange = function () { set('color', this.value); };
    $('wmImgScale').oninput = function () { S.imgScale = +this.value; $('wmImgScaleV').textContent = S.imgScale + '%'; schedule(); };
    $('wmImgScale').onchange = function () { set('imgScale', +this.value); };
    $('wmOpacity').oninput = function () { S.opacity = +this.value; $('wmOpacityV').textContent = S.opacity + '%'; schedule(); };
    $('wmOpacity').onchange = function () { set('opacity', +this.value); };
    $('wmRot').oninput = function () { S.rot = +this.value; $('wmRotV').textContent = S.rot + '°'; schedule(); };
    $('wmRot').onchange = function () { set('rot', +this.value); };
    $('wmGap').oninput = function () { S.gap = +this.value; $('wmGapV').textContent = S.gap + ' pt'; schedule(); };
    $('wmGap').onchange = function () { set('gap', +this.value); };
    $('wmTile').onchange = function () { set('tile', this.checked); };
    Array.prototype.forEach.call(document.querySelectorAll('.wm-pos button'), function (b) { b.onclick = function () { set('pos', b.getAttribute('data-p')); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.wm-rotq button'), function (b) { b.onclick = function () { set('rot', +b.getAttribute('data-r')); }; });
    $('wmLayerOver').onchange = function () { set('layer', 'over'); };
    $('wmLayerUnder').onchange = function () { set('layer', 'under'); };
    $('wmPages').onchange = function () { set('pages', this.value); if (this.value === 'range') $('wmRange').focus(); };
    $('wmRange').oninput = function () { S.range = this.value; save(); schedule(); };
    $('wmRange').onchange = function () { set('range', this.value); };
    $('wmImgPick').onclick = function () { $('wmImgInput').click(); };
    $('wmImgInput').onchange = async function (e) {
      var file = e.target.files[0]; e.target.value = ''; if (!file) return;
      if (!/^image\//.test(file.type)) { say('Choose a PNG, JPG, WebP, SVG or GIF image.', 'error'); return; }
      try { var r = await readImage(file); st.imgData = r.url; st.imgW = r.w; st.imgH = r.h; st.imgName = file.name; pvCache.key = ''; set('type', 'image'); }
      catch (er) { say('That image could not be read.', 'error'); }
    };
    $('wmPrev').onclick = function () { st.page--; schedule(); };
    $('wmNext').onclick = function () { st.page++; schedule(); };
    $('wmApply').onclick = applyAll;
    $('wmZip').onclick = downloadZip;
    $('wmReset').onclick = function () { st.files = []; st.cur = 0; st.page = 1; $('wmInfo').textContent = ''; drawFiles(); };
    $('wmFiles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var i = +b.closest('.wm-file').getAttribute('data-i'), f = st.files[i]; if (!f) return;
      var a = b.getAttribute('data-a');
      if (a === 'sel') { st.cur = i; st.page = 1; st.autoJump = true; drawFiles(); schedule(); }
      if (a === 'dl') download(f);
      if (a === 'rm') { if (f.doc) f.doc.destroy(); st.files.splice(i, 1); st.cur = Math.max(0, Math.min(st.cur, st.files.length - 1)); st.page = 1; drawFiles(); schedule(); }
    });
    window.addEventListener('resize', schedule);
    syncUI();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.WMTool = { st: st, S: S, build: build, centers: centers, toUser: toUser, pickPages: pickPages, addFiles: addFiles, set: set };
})();
