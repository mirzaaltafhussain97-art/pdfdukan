/* PDFdukan — Free Online OCR (image / screenshot / scanned PDF to text)
 * Runs in the browser with Tesseract.js (open-source Tesseract OCR compiled to
 * WebAssembly). Files are not uploaded; the OCR code and language data are
 * downloaded from a public CDN the first time.
 *
 * Added in Nov 2026:
 *  - several images in one run, or a scanned PDF (pages rendered with pdf.js)
 *  - paste a screenshot with Ctrl+V / Cmd+V
 *  - small images are enlarged before OCR (small text was being misread)
 *  - "Two columns (split)" layout that reads columns left to right
 *  - more languages, GIF and BMP input
 */
(function () {
  'use strict';

  var IMG_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'image/bmp': 1 };
  var MAX_FILE = 30 * 1024 * 1024;
  var MAX_PDF = 100 * 1024 * 1024;
  var MAX_PIXELS = 40 * 1000 * 1000;
  var MAX_ITEMS = 20;          // images per run
  var MAX_PDF_PAGES = 50;      // PDF pages per run
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var st = { items: [], busy: false, cancelled: false, worker: null, view: 0, results: [] };
  function $(id) { return document.getElementById(id); }
  function say(m, t) { if (window.toast) window.toast(m, t); }
  function size(b) { return b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }
  function esc(v) { var s = document.createElement('span'); s.textContent = v; return s.innerHTML; }
  function loadScript(src) {
    if (window.loadScriptOnce) return window.loadScriptOnce(src);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function progress(pct, label) {
    if (window.PDLoader && st.busy) { window.PDLoader.update(null, label || ''); return; }
    $('progressCard').style.display = 'block';
    $('progressFill').style.width = Math.max(1, Math.min(100, pct)) + '%';
    $('progressLabel').textContent = label || '';
  }

  /* ── Adding files ───────────────────────────────────────── */
  async function addFiles(list, fromPaste) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var added = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (!isPdf && !IMG_TYPES[f.type]) { say('"' + f.name + '" is not a JPG, PNG, WebP, GIF, BMP or PDF file.', 'error'); continue; }
      if (st.items.length >= MAX_ITEMS) { say('You can add up to ' + MAX_ITEMS + ' files per run.', 'info'); break; }
      if (isPdf) {
        if (st.items.some(function (x) { return x.pdf; })) { say('Add one PDF at a time. Remove the current PDF first.', 'info'); continue; }
        if (f.size > MAX_PDF) { say('This PDF is over 100 MB. Split it first with Extract PDF Pages.', 'error'); continue; }
        try { await addPdf(f); added++; } catch (e) { console.error(e); say(/password/i.test(String(e && e.name)) ? 'This PDF is password-protected. Unlock it first, then add it again.' : '"' + f.name + '" could not be opened as a PDF.', 'error'); }
        continue;
      }
      if (f.size > MAX_FILE) { say('"' + f.name + '" is over 30 MB.', 'error'); continue; }
      try {
        var bm = await createImageBitmap(f, { imageOrientation: 'from-image' });
        var w = bm.width, h = bm.height; bm.close();
        if (w * h > MAX_PIXELS) { say('"' + f.name + '" is over 40 megapixels. Crop it into smaller parts first.', 'error'); continue; }
        var name = fromPaste ? 'Pasted screenshot ' + (st.items.filter(function (x) { return x.pasted; }).length + 1) + '.png' : f.name;
        st.items.push({ file: f, name: name, w: w, h: h, url: URL.createObjectURL(f), pasted: !!fromPaste });
        added++;
      } catch (e) { say('"' + f.name + '" could not be opened.', 'error'); }
    }
    if (added) { resetResult(); renderList(); clearTimeout(st.autoT); st.autoT = setTimeout(run, 700); }   // start reading right away
  }

  async function addPdf(f) {
    if (!window.pdfjsLib) await loadScript(PDFJS_URL);
    if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    var bytes = new Uint8Array(await f.arrayBuffer());
    var doc = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    var thumb = '';
    try {
      var p1 = await doc.getPage(1), v = p1.getViewport({ scale: 1 }), s = 240 / v.width, vp = p1.getViewport({ scale: s });
      var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await p1.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
      thumb = c.toDataURL('image/jpeg', 0.7);
    } catch (e) { }
    st.items.push({ file: f, name: f.name, pdf: doc, pages: doc.numPages, url: thumb });
  }

  function renderList() {
    var box = $('ocrFiles');
    box.innerHTML = '';
    st.items.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'ocr-item';
      d.innerHTML = (it.url ? '<img src="' + it.url + '" alt="">' : '<span class="ocr-item-icon">📄</span>') +
        '<div class="ocr-item-info"><div class="ocr-item-name">' + esc(it.name) + '</div><div class="ocr-item-meta">' +
        (it.pdf ? 'PDF · ' + it.pages + ' page' + (it.pages === 1 ? '' : 's') + ' · ' + size(it.file.size) : it.w + ' × ' + it.h + ' px · ' + size(it.file.size)) + '</div></div>' +
        '<button type="button" class="ocr-item-x" data-i="' + i + '" aria-label="Remove ' + esc(it.name) + '">✕</button>';
      box.appendChild(d);
    });
    var hasPdf = st.items.some(function (x) { return x.pdf; });
    $('ocrPdfRow').hidden = !hasPdf;
    if (hasPdf) {
      var p = st.items.filter(function (x) { return x.pdf; })[0];
      $('ocrPdfPages').placeholder = 'All (1-' + Math.min(p.pages, MAX_PDF_PAGES) + ')';
    }
    var n = st.items.length;
    $('dropZone').classList.toggle('ocr-has-files', n > 0);
    $('ocrDzTitle').textContent = n ? 'Add more images' : 'Drop images or a PDF here, or click to browse';
    $('ocrRunBtn').disabled = !n || st.busy;
    $('ocrClearBtn').disabled = !n || st.busy;
    $('ocrCount').textContent = n ? n + ' file' + (n === 1 ? '' : 's') + ' ready' : '';
  }

  /* ── Image preparation ──────────────────────────────────── */
  function drawScaled(src, w, h, mode) {
    // Small images: enlarge so small letters reach a size Tesseract reads well.
    // Large images: shrink to save memory. Pixels are not otherwise changed in Original mode.
    var maxSide = Math.max(w, h), scale = 1;
    if (maxSide < 2000) scale = Math.min(2, 2600 / maxSide);
    else if (maxSide > 4200) scale = 4200 / maxSide;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    var x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(src, 0, 0, c.width, c.height);
    if (mode !== 'original') {
      var d = x.getImageData(0, 0, c.width, c.height), p = d.data, k = mode === 'document' ? 1.32 : 1.08;
      for (var i = 0; i < p.length; i += 4) {
        var g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        var v = Math.max(0, Math.min(255, Math.round((g - 128) * k + 128)));
        p[i] = p[i + 1] = p[i + 2] = v;
      }
      x.putImageData(d, 0, 0);
    }
    return c;
  }

  /* Boxes and ruled lines around words (skill chips, table cells, underlines) are read as "(", ")" or "|".
     Find dark shapes that are only an outline or a long thin line and paint them white before OCR. */
  function removeFrames(c) {
    var W = c.width, H = c.height, N = W * H;
    if (N > 14e6 || N < 400) return 0;
    var x = c.getContext('2d', { willReadFrequently: true }), img = x.getImageData(0, 0, W, H), p = img.data;
    var g = new Uint8Array(N), hist = new Uint32Array(256), i;
    for (i = 0; i < N; i++) { var v = (p[i * 4] * 77 + p[i * 4 + 1] * 150 + p[i * 4 + 2] * 29) >> 8; g[i] = v; hist[v]++; }
    // Otsu threshold
    var sum = 0, sumB = 0, wB = 0, best = 0, T = 128; for (i = 0; i < 256; i++) sum += i * hist[i];
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = N - wB; if (!wF) break; sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, b = wB * wF * (mB - mF) * (mB - mF); if (b > best) { best = b; T = i; } }
    T = Math.min(225, T + 45);   // looser, so thin light outlines stay in one piece
    var lab = new Int32Array(N), stack = new Int32Array(N), comps = [], id = 0;
    for (var s0 = 0; s0 < N; s0++) {
      if (lab[s0] || g[s0] > T) continue;
      id++; var sp = 0, n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; stack[sp++] = s0; lab[s0] = id;
      while (sp) {
        var q = stack[--sp], qx = q % W, qy = (q - qx) / W; n++;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (var dy = -1; dy <= 1; dy++) { var ny = qy + dy; if (ny < 0 || ny >= H) continue;
          for (var dx = -1; dx <= 1; dx++) { var nx = qx + dx; if (nx < 0 || nx >= W) continue; var r = ny * W + nx;
            if (!lab[r] && g[r] <= T) { lab[r] = id; stack[sp++] = r; } } }
      }
      comps[id] = [x0, y0, x1, y1, n];
    }
    var kill = new Uint8Array(id + 1), edge = new Uint32Array(id + 1), top = new Uint32Array(id + 1), bot = new Uint32Array(id + 1), lft = new Uint32Array(id + 1), rgt = new Uint32Array(id + 1), killed = 0, k;
    function band(C) { return Math.max(3, Math.round(Math.min(C[2] - C[0], C[3] - C[1]) * 0.12)); }
    // pixels near their own box edge
    for (i = 0; i < N; i++) { k = lab[i]; if (!k) continue; var C = comps[k], px = i % W, py = (i - px) / W, e = band(C), near = false;
      if (py - C[1] < e) { top[k]++; near = true; } if (C[3] - py < e) { bot[k]++; near = true; }
      if (px - C[0] < e) { lft[k]++; near = true; } if (C[2] - px < e) { rgt[k]++; near = true; }
      if (near) edge[k]++; }
    for (k = 1; k <= id; k++) {
      var B = comps[k], w = B[2] - B[0] + 1, h = B[3] - B[1] + 1, cnt = B[4];
      if (w * h > N * 0.3) continue;                                   // a photo or a whole-page frame with content
      var rule = (w >= 60 && h <= Math.max(5, w * 0.04)) || (h >= 60 && w <= Math.max(5, h * 0.04));
      var frame = w >= 40 && h >= 18 && cnt < w * h * 0.25 && edge[k] > cnt * 0.85;
      // a box whose outline touches a letter inside: keep the letter, remove only the outline
      var box = w >= 40 && h >= 18 && w >= h * 2.2 && cnt < w * h * 0.2 && edge[k] > cnt * 0.6 && top[k] >= w * 0.8 && bot[k] >= w * 0.8 && lft[k] >= h * 0.5 && rgt[k] >= h * 0.5;
      if (rule || frame) { kill[k] = 1; killed++; } else if (box) { kill[k] = 2; killed++; }
    }
    if (!killed) return 0;
    for (i = 0; i < N; i++) { k = lab[i]; if (!kill[k]) continue;
      if (kill[k] === 2) { var D = comps[k], qx2 = i % W, qy2 = (i - qx2) / W, e2 = Math.max(2, Math.round(band(D) * 0.6));
        if (!(qy2 - D[1] < e2 || D[3] - qy2 < e2 || qx2 - D[0] < e2 || D[2] - qx2 < e2)) continue; }
      var o = i * 4; p[o] = p[o + 1] = p[o + 2] = 255; }
    x.putImageData(img, 0, 0);
    return killed;
  }

  /* Turn Tesseract's blocks into clean lines: headings by height, real bullets, chips on their own lines */
  /* split one OCR line where the gap between words is wide: boxes in a row, two columns, items with bullet dots between them */
  function splitRow(ws, h) {
        // a wide gap between words splits the line (boxes in a row, two columns side by side)
        var segs = [[ws[0]]];
        for (var j = 1; j < ws.length; j++) { var gap = ws[j].bbox.x0 - ws[j - 1].bbox.x1; if (gap > h * 1.25) segs.push([]); segs[segs.length - 1].push(ws[j]); }
        if (segs.length >= 3) {   // a row of boxes: two boxes that touch still have a wider gap than a normal space
          var inner = []; segs.forEach(function (sg) { for (var q = 1; q < sg.length; q++) inner.push(sg[q].bbox.x0 - sg[q - 1].bbox.x1); });
          inner.sort(function (x, y) { return x - y; });
          var ns = inner.length ? inner[inner.length >> 1] : h * 0.3, lim = Math.max(h * 0.6, ns * 1.5);
          var re = []; segs.forEach(function (sg) { var cur = [sg[0]]; for (var q = 1; q < sg.length; q++) { if (sg[q].bbox.x0 - sg[q - 1].bbox.x1 > lim) { re.push(cur); cur = []; } cur.push(sg[q]); } re.push(cur); });
          segs = re;
        }
        // a part that is only a dot or bullet is a separator between items on one line ("Urdu · English · Punjabi")
        var sepRe = /^[*+«»•·●▪■◦\-–—|eo]{1,3}$/, seps = 0;
        segs = segs.filter(function (sg) { var only = sg.length === 1 && sepRe.test(String(sg[0].text).trim()); if (only) seps++; return !only; });
        if (!segs.length) return segs;
        if (seps) { var all = []; segs.forEach(function (sg, si) { if (si) all.push({ text: '•', bbox: sg[0].bbox }); all = all.concat(sg); }); segs = [all]; }
        return segs;
  }
  function structure(d) {
    var paras = [], hs = [];
    (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (pp) {
      var lines = [];
      (pp.lines || []).forEach(function (l) {
        var ws = (l.words || []).filter(function (w) { return String(w.text || '').trim(); });
        if (ws.length) lines.push({ ws: ws, y0: Math.min.apply(null, ws.map(function (w) { return w.bbox.y0; })), y1: Math.max.apply(null, ws.map(function (w) { return w.bbox.y1; })) });
      });
      if (lines.length) paras.push(lines);
    }); });
    // a one-line piece that sits on the same row as another one-line piece belongs to it (items in a row of boxes)
    for (var a = 0; a < paras.length; a++) {
      if (paras[a].length !== 1) continue;
      for (var b2 = a + 1; b2 < paras.length; b2++) {
        if (paras[b2].length !== 1) continue;
        var A = paras[a][0], B = paras[b2][0], ov = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ov > 0.6 * Math.min(A.y1 - A.y0, B.y1 - B.y0)) {
          A.ws = A.ws.concat(B.ws).sort(function (p1, p2) { return p1.bbox.x0 - p2.bbox.x0; }); A.y0 = Math.min(A.y0, B.y0); A.y1 = Math.max(A.y1, B.y1);
          paras.splice(b2, 1); b2--;
        }
      }
    }
    var out1 = [];
    paras.forEach(function (pl) {
      var lines = [];
      pl.forEach(function (l) {
        var ws = l.ws;
        var wh = ws.map(function (w) { return w.bbox.y1 - w.bbox.y0; }).sort(function (x, y) { return x - y; });
        var h = wh[wh.length >> 1], hTall = wh[Math.min(wh.length - 1, Math.floor(wh.length * 0.85))];
        var segs = splitRow(ws, h);
        if (!segs.length) return;
        segs.forEach(function (sg) {
          var t = sg.map(function (w) { return String(w.text).trim(); }).join(' ');
          lines.push({ t: t, h: hTall, n: sg.length, many: segs.length, x0: sg[0].bbox.x0, col: segs.length === 2 ? segs.indexOf(sg) : -1 });
        });
        hs.push(hTall);
      });
      if (lines.length) out1.push(lines);
    });
    // two columns read across: lines split into a left and right part at about the same place → read the left column first
    var colRows = [];
    out1.forEach(function (lines, pi) { lines.forEach(function (L) { if (L.col === 1) colRows.push({ pi: pi, x: L.x0 }); }); });
    if (colRows.length >= 2) {
      var xs = colRows.map(function (c) { return c.x; }).sort(function (a2, b3) { return a2 - b3; }), mx = xs[xs.length >> 1];
      var tol = Math.max(20, mx * 0.06);
      if (colRows.filter(function (c) { return Math.abs(c.x - mx) < tol; }).length >= 2) {
        var left = [], right = [], firstPi = -1, lastPi = -1;
        out1.forEach(function (lines, pi) {
          var hasCol = lines.some(function (L) { return L.col >= 0 || L.x0 >= mx - tol; });
          if (!hasCol) return;
          if (firstPi < 0) firstPi = pi; lastPi = pi;
        });
        var rebuilt = [];
        out1.forEach(function (lines, pi) {
          if (pi < firstPi || pi > lastPi) { rebuilt.push({ pi: pi, lines: lines }); return; }
          var lft = [], rgt = [];
          lines.forEach(function (L) { (L.x0 >= mx - tol ? rgt : lft).push(L); });
          if (lft.length) left.push(lft); if (rgt.length) right.push(rgt);
          if (pi === lastPi) { left.concat(right).forEach(function (ls) { rebuilt.push({ pi: pi, lines: ls }); }); }
        });
        out1 = rebuilt.map(function (r) { return r.lines; });
      }
    }
    hs.sort(function (x, y) { return x - y; });
    var body = hs.length ? hs[hs.length >> 1] : 0;
    var out = [];
    out1.forEach(function (lines) {
      var block = [];
      lines.forEach(function (L) {
        var t = fixLine(L.t, L.many > 2);
        if (!t) return;
        var bullet = /^• /.test(t), lvl = 0;
        if (!bullet && body && L.n <= 12 && t.length < 90 && !/[.,;:]$/.test(t)) { var r = L.h / body; if (r >= 1.9) lvl = 1; else if (r >= 1.3) lvl = 2; else if (r >= 1.16 && L.n <= 8) lvl = 3; }
        if (lvl) { if (block.length) { out.push({ lines: block }); block = []; } out.push({ head: lvl, lines: [t] }); return; }
        if (bullet && block.length && !/^• /.test(block[block.length - 1])) { out.push({ lines: block }); block = []; }
        block.push(t);
      });
      if (block.length) out.push({ lines: block });
    });
    return out;
  }
  function fixLine(t, chip) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (chip) {
      // leftovers of the box around each item: stray brackets, bars and quotes
      t = t.split(' ').filter(function (w) { return !/^[|()\[\]{}"'“”‘’]+$/.test(w) && !/^[IJl|]$/.test(w); }).join(' ');
      var op = (t.match(/[(\[{]/g) || []).length, cl = (t.match(/[)\]}]/g) || []).length;
      if (op > cl) t = t.replace(/^[(\[{]+\s*/, '');
      if (cl > op) t = t.replace(/\s*[)\]}]+$/, '');
      t = t.replace(/^["'“”‘’|]+\s*/, '').replace(/\s*["'“”‘’|]+$/, '').trim();
    }
    // bullet dots are often read as * + « or e
    t = t.replace(/^(?:[*+«»•·●▪■◦‣>-]|e(?=\s+[A-Z]))\s+(?=\S)/, '• ');
    t = t.replace(/\s(?:[*+«»·●▪■◦]{1,2}|•)\s(?=[A-Z(])/g, ' • ');
    return t;
  }
  function structText(sx) { return sx.map(function (b) { return b.lines.join('\n'); }).join('\n\n'); }
  function structHtml(sx) {
    return sx.map(function (b) {
      if (b.head) return '<p class="ocr-h' + b.head + '">' + esc(b.lines[0]) + '</p>';
      return '<p>' + b.lines.map(esc).join('<br>') + '</p>';
    }).join('');
  }

  // Finds clear vertical gaps that run through the text and returns column slices.
  function splitColumns(c) {
    var W = c.width, H = c.height, x = c.getContext('2d', { willReadFrequently: true });
    var d = x.getImageData(0, 0, W, H).data, ink = new Uint32Array(W), rowsWithInk = 0, rowInk = new Uint8Array(H);
    for (var y = 0; y < H; y += 2) {
      var any = 0;
      for (var xx = 0; xx < W; xx++) {
        var i = (y * W + xx) * 4;
        if (d[i] + d[i + 1] + d[i + 2] < 384) { ink[xx]++; any = 1; }
      }
      if (any) { rowsWithInk++; rowInk[y] = 1; }
    }
    if (!rowsWithInk) return [c];
    var left = 0, right = W - 1;
    while (left < W && !ink[left]) left++;
    while (right > left && !ink[right]) right--;
    var minGap = Math.max(12, Math.round((right - left) * 0.025)), gaps = [], run = 0;
    for (var cx = left; cx <= right; cx++) {
      if (ink[cx] <= Math.max(1, rowsWithInk * 0.03)) run++;
      else { if (run >= minGap) gaps.push([cx - run, cx]); run = 0; }
    }
    if (!gaps.length) return [c];
    var cuts = [left].concat(gaps.map(function (g) { return Math.round((g[0] + g[1]) / 2); })).concat([right + 1]);
    var parts = [];
    for (var j = 0; j < cuts.length - 1; j++) {
      var x0 = Math.max(0, cuts[j] - 4), x1 = Math.min(W, cuts[j + 1] + 4);
      if (x1 - x0 < 40) continue;
      var pc = document.createElement('canvas'); pc.width = x1 - x0; pc.height = H;
      pc.getContext('2d').drawImage(c, x0, 0, x1 - x0, H, 0, 0, x1 - x0, H);
      parts.push(pc);
    }
    return parts.length > 1 ? parts : [c];
  }

  function parsePages(raw, total) {
    var max = Math.min(total, MAX_PDF_PAGES);
    if (!String(raw || '').trim()) { var a = []; for (var i = 1; i <= max; i++) a.push(i); return { list: a, capped: total > MAX_PDF_PAGES }; }
    var set = new Set(), parts = String(raw).split(',');
    for (var k = 0; k < parts.length; k++) {
      var m = parts[k].trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return { err: '"' + parts[k].trim() + '" is not a page number. Use 3 or 3-7.' };
      var s = +m[1], e = m[2] ? +m[2] : s; if (s > e) { var t = s; s = e; e = t; }
      if (s < 1 || e > total) return { err: 'This PDF has pages 1 to ' + total + '.' };
      for (var p = s; p <= e; p++) set.add(p);
    }
    var list = Array.from(set).sort(function (a, b) { return a - b; });
    return { list: list.slice(0, MAX_PDF_PAGES), capped: list.length > MAX_PDF_PAGES };
  }

  /* ── Run OCR ────────────────────────────────────────────── */
  async function run() {
    if (!st.items.length || st.busy) return;
    var lang = $('ocrLang').value, layout = $('ocrLayout').value, mode = $('ocrEnhance').value;
    // build the job list (images + PDF pages)
    var jobs = [], pdfCapped = false;
    for (var i = 0; i < st.items.length; i++) {
      var it = st.items[i];
      if (it.pdf) {
        var r = parsePages($('ocrPdfPages').value, it.pages);
        if (r.err) { say(r.err, 'error'); return; }
        pdfCapped = r.capped;
        r.list.forEach(function (n) { jobs.push({ item: it, page: n, label: it.name + ' — page ' + n }); });
      } else jobs.push({ item: it, label: it.name });
    }
    st.busy = true; st.cancelled = false; st.results = [];
    if (window.PDLoader) window.PDLoader.show('Reading text…', 'Starting OCR', cancel);
    $('ocrRunBtn').disabled = true; $('ocrClearBtn').disabled = true; resetResult();
    var t0 = Date.now();
    try {
      progress(3, 'Loading OCR engine…');
      if (typeof Tesseract === 'undefined') await loadScript(TESS_URL);
      var langs = lang.split('+');
      var logger = function (m) {
        if (!m || !m.status || st.cancelled) return;
        if (m.status === 'loading language traineddata') progress(5 + Math.round((m.progress || 0) * 15), 'Loading ' + $('ocrLang').selectedOptions[0].textContent + ' language data… ' + Math.round((m.progress || 0) * 100) + '%');
      };
      st.worker = await Tesseract.createWorker(langs.length > 1 ? langs : langs[0], 1, { logger: logger });
      var psm = layout === 'cols' ? '3' : layout;
      await st.worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', user_defined_dpi: '300' });
      var confs = [];
      for (var j = 0; j < jobs.length; j++) {
        if (st.cancelled) return;
        var job = jobs[j], base = 20 + Math.round(j / jobs.length * 78);
        progress(base, 'Reading ' + job.label + ' (' + (j + 1) + ' of ' + jobs.length + ')…');
        var canvas;
        if (job.item.pdf) {
          var pg = await job.item.pdf.getPage(job.page), v1 = pg.getViewport({ scale: 1 });
          var sc = Math.min(300 / 72, 4200 / Math.max(v1.width, v1.height)), vp = pg.getViewport({ scale: sc });
          var pc = document.createElement('canvas'); pc.width = Math.floor(vp.width); pc.height = Math.floor(vp.height);
          await pg.render({ canvasContext: pc.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
          canvas = drawScaled(pc, pc.width, pc.height, mode);
          var colorSrc = drawScaled(pc, pc.width, pc.height, 'original');
          var pagePt = { w: v1.width, h: v1.height };
          pc.width = pc.height = 0; pg.cleanup();
        } else {
          var bm = await createImageBitmap(job.item.file, { imageOrientation: 'from-image' });
          canvas = drawScaled(bm, bm.width, bm.height, mode);
          var colorSrc = drawScaled(bm, bm.width, bm.height, 'original');
          var pagePt = bm.width > bm.height ? { w: 792, h: 792 * bm.height / bm.width } : { w: 612, h: 612 * bm.height / bm.width };
          bm.close();
        }
        try { if (!window.PD_NOFRAMES) removeFrames(canvas); } catch (e) { }
        var preview = await pagePreview(colorSrc);
        var parts = layout === 'cols' ? splitColumns(canvas) : [canvas], texts = [], sx = null;
        for (var q = 0; q < parts.length; q++) {
          var out = await st.worker.recognize(parts[q], { rotateAuto: true }, { text: true, blocks: parts.length === 1, imageColor: parts.length === 1 });
          if (st.cancelled) return;
          texts.push(clean(out.data.text));
          if (parts.length === 1 && !window.PD_NOSTRUCT) { try { sx = structure(out.data); } catch (e) { sx = null; } }
          (out.data.words || []).forEach(function (w) { if (String(w.text || '').trim() && isFinite(w.confidence)) confs.push(+w.confidence); });
          if (!(out.data.words || []).length && isFinite(out.data.confidence)) confs.push(+out.data.confidence);
        }
        var lay = null;
        try { if (parts.length === 1) lay = await layoutOf(out.data, colorSrc || canvas, pagePt, lang); } catch (e) { lay = null; if (window.PD_DEBUG) console.error("LAYOUT", e && e.stack); }
        if (colorSrc) colorSrc.width = colorSrc.height = 0;
        var txt = sx && sx.length ? clean(structText(sx)) : texts.filter(Boolean).join('\n\n');
        st.results.push({ label: job.label, text: txt, html: sx && sx.length ? structHtml(sx) : '', cols: parts.length, layout: lay, preview: preview });
        canvas.width = canvas.height = 0;
      }
      progress(100, 'Done in ' + Math.round((Date.now() - t0) / 1000) + ' s');
      showResult(confs, pdfCapped);
    } catch (e) {
      if (st.cancelled) return;
      console.error(e);
      say('OCR stopped: ' + (e && e.message ? e.message : 'unknown error') + '. Try a smaller image, fewer pages or another browser.', 'error');
    } finally {
      if (st.worker) { try { await st.worker.terminate(); } catch (e) { } st.worker = null; }
      st.busy = false; renderList();
      if (window.PDLoader) window.PDLoader.hide();
      setTimeout(function () { if (!st.busy) $('progressCard').style.display = 'none'; }, 1200);
    }
  }

  function pagePreview(c) {
    var d = c, mw = 1600;
    if (c.width > mw) { d = document.createElement('canvas'); d.width = mw; d.height = Math.round(c.height * mw / c.width); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); }
    return new Promise(function (res) { d.toBlob(function (b) { if (d !== c) d.width = 0; res(b ? URL.createObjectURL(b) : ''); }, 'image/jpeg', 0.85); });
  }
  function clean(v) {
    return String(v || '').normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function showResult(confs, pdfCapped) {
    var lang = $('ocrLang').value;
    st.rtl = /^(urd|ara|fas|heb)$/.test(lang);
    st.results.forEach(function (r) { if (!r.html) r.html = r.text ? '<p>' + esc(r.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>' : ''; });
    var found = st.results.some(function (r) { return r.text; });
    var avg = confs.length ? confs.reduce(function (a, b) { return a + b; }, 0) / confs.length : NaN;
    $('statConf').textContent = isFinite(avg) ? Math.round(avg) + '%' : '—';
    st.view = -1; st.zoom = 100; showPage(0);
    ['copyBtn', 'ocrExportBtn', 'ocrReBtn'].forEach(function (id) { $(id).disabled = !found && id !== 'ocrReBtn'; });
    var notes = [];
    if (pdfCapped) notes.push('Only the first ' + MAX_PDF_PAGES + ' pages were read. Type a page range to read the rest.');
    if (!found) notes.push('No text was found. Try the correct language, another page layout, or a sharper image.');
    $('ocrNote').textContent = notes.join(' ');
    $('ocrNote').hidden = !notes.length;
    var rs = $('resultSection'); rs.classList.add('show');
    say(found ? 'Text extracted. Check it against the image before you use it.' : 'No text found.', found ? 'success' : 'info');
  }
  /* one page at a time: the picture on the left, its text on the right (like a two-page viewer) */
  function saveEdits() {
    var r = st.results[st.view], ed = $('ocrEditor');
    if (!r || !ed) return;
    r.html = ed.innerHTML; r.text = clean(ed.innerText.replace(/\u00a0/g, ' '));
  }
  function showPage(i) {
    if (!st.results.length) return;
    if (st.view >= 0) saveEdits();
    i = Math.max(0, Math.min(st.results.length - 1, i)); st.view = i;
    var r = st.results[i], img = $('imgPreview'), ed = $('ocrEditor');
    if (r.preview) { img.src = r.preview; img.style.display = 'block'; } else { img.removeAttribute('src'); img.style.display = 'none'; }
    ed.innerHTML = r.html || '<p class="ocr-empty">No text found on this page.</p>';
    ed.dir = st.rtl ? 'rtl' : 'auto';
    $('ocrDocName').textContent = r.label;
    $('ocrPageNo').textContent = (i + 1) + ' / ' + st.results.length;
    $('ocrPrev').disabled = i === 0; $('ocrNext').disabled = i === st.results.length - 1;
    setZoom(st.zoom || 100);
    $('ocrViewer').scrollTop = 0; ed.scrollTop = 0;
    counts();
  }
  function setZoom(z) {
    st.zoom = Math.max(50, Math.min(300, z));
    $('imgPreview').style.width = st.zoom + '%';
    $('ocrZoomLbl').textContent = st.zoom + '%';
  }
  function allText() {
    saveEdits();
    var many = st.results.length > 1;
    return st.results.map(function (r) { return (many ? '—— ' + r.label + ' ——\n' : '') + (r.text || ''); }).join('\n\n').trim();
  }
  function counts() {
    var ed = $('ocrEditor'); if (!ed) return;
    var cur = st.results[st.view]; if (cur) { cur.text = clean(ed.innerText.replace(/\u00a0/g, ' ')); cur.html = ed.innerHTML; }
    var plain = st.results.map(function (r) { return r.text || ''; }).join('\n');
    $('statWords').textContent = plain.trim() ? plain.trim().split(/\s+/u).length : 0;
    $('statChars').textContent = plain.replace(/\n/g, '').length;
  }
  function resetResult() {
    $('resultSection').classList.remove('show');
    if ($('ocrEditor')) $('ocrEditor').innerHTML = '';
    st.view = -1;
    ['statConf', 'statWords', 'statChars'].forEach(function (id) { $(id).textContent = '—'; });
    ['copyBtn', 'ocrExportBtn'].forEach(function (id) { $(id).disabled = true; });
    if ($('ocrExportMenu')) $('ocrExportMenu').hidden = true;
  }

  /* ── Output ─────────────────────────────────────────────── */
  function baseName() {
    var it = st.items[0]; if (!it) return 'ocr-text';
    var b = it.pasted ? 'screenshot' : it.name.replace(/\.[^.]+$/, '');
    b = b.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'ocr';
    return b.slice(0, 70) + '-text';
  }
  function save(blob, name) {
    var go = function (n) {
      if (!n) return;
      var ext = name.split('.').pop(); if (!new RegExp('\\.' + ext + '$', 'i').test(n)) n += '.' + ext;
      var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = n;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      if (window.CMLogs && window.CMLogs.log) window.CMLogs.log({ tool: 'OCR', action: 'extract', output: n, size: blob.size });
    };
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(name).then(go); else go(name);
  }
  async function copyText() {
    var t = allText(); if (!t) return;
    try { await navigator.clipboard.writeText(t); }
    catch (e) { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) { } ta.remove(); }
    say('Text copied.', 'success');
  }
  function downloadTxt() {
    var t = allText(); if (!t) return;
    save(new Blob(['\ufeff', t], { type: 'text/plain;charset=utf-8' }), baseName() + '.txt');
  }
  /* Same-layout Word: the picture with the printed words erased, and the words as editable text placed where they were */
  async function layoutOf(d, src, pagePt, lang) {
    var img = src;
    if (Math.abs(d.rotateRadians || 0) > 0.001 && d.imageColor) {   // a tilted image was straightened: use the straightened copy
      var im = new Image(); im.src = d.imageColor; await im.decode();
      img = document.createElement('canvas'); img.width = im.width; img.height = im.height; img.getContext('2d').drawImage(im, 0, 0);
    }
    var W = img.width, H = img.height, sc = Math.min(1, 1700 / W);
    var c = document.createElement('canvas'); c.width = Math.round(W * sc); c.height = Math.round(H * sc);
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
    if (img !== src) img.width = 0;
    var px = x.getImageData(0, 0, c.width, c.height).data, smp = [];
    for (var sy = 5; sy < 40; sy++) for (var sx = 5; sx < 40; sx++) { var ix = (Math.floor(sy * c.height / 45) * c.width + Math.floor(sx * c.width / 45)) * 4; smp.push([px[ix], px[ix + 1], px[ix + 2], px[ix] + px[ix + 1] + px[ix + 2]]); }
    smp.sort(function (a, b) { return a[3] - b[3]; }); var pc = smp[Math.floor(smp.length * 0.8)];
    x.fillStyle = 'rgb(' + pc[0] + ',' + pc[1] + ',' + pc[2] + ')';
    var k = pagePt.w / W, lines = [], m = document.createElement('canvas').getContext('2d');
    var rtlLang = /(^|\+)(urd|ara|fas|heb)(\+|$)/.test(lang), CW = c.width, CH = c.height;
    function lum(i) { return (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8; }
    // the colour around a word (a chip, a coloured band or plain paper) and how heavy its letters are
    function look(bb) {
      var x0 = Math.max(0, Math.floor(bb.x0 * sc)), y0 = Math.max(0, Math.floor(bb.y0 * sc)), x1 = Math.min(CW - 1, Math.ceil(bb.x1 * sc)), y1 = Math.min(CH - 1, Math.ceil(bb.y1 * sc));
      var ring = [], o = 3, i, xx, yy;
      for (xx = x0 - o; xx <= x1 + o; xx += 2) { [y0 - o, y1 + o].forEach(function (yv) { if (xx >= 0 && xx < CW && yv >= 0 && yv < CH) { var q = (yv * CW + xx) * 4; ring.push([px[q], px[q + 1], px[q + 2], lum(q)]); } }); }
      for (yy = y0 - o; yy <= y1 + o; yy += 2) { [x0 - o, x1 + o].forEach(function (xv) { if (xv >= 0 && xv < CW && yy >= 0 && yy < CH) { var q = (yy * CW + xv) * 4; ring.push([px[q], px[q + 1], px[q + 2], lum(q)]); } }); }
      ring.sort(function (p1, p2) { return p2[3] - p1[3]; });
      var bgc = ring.length ? ring[Math.floor(ring.length * 0.3)] : [255, 255, 255, 255];
      var ink = 0, r = 0, g = 0, bl = 0, n = 0, area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
      for (yy = y0; yy <= y1; yy++) for (xx = x0; xx <= x1; xx++) { i = (yy * CW + xx) * 4; if (lum(i) < bgc[3] - 70) { ink++; r += px[i]; g += px[i + 1]; bl += px[i + 2]; n++; } }
      return { bg: bgc, dens: ink / area, col: n ? [r / n, g / n, bl / n] : [0, 0, 0] };
    }
    function hexOf(cv) { return cv.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join('').toUpperCase(); }
    var rows = [], dens = [];
    (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) {
      var pl = (p.lines || []).length;
      (p.lines || []).forEach(function (l) {
        var ws = (l.words || []).filter(function (w) { return String(w.text || '').trim(); });
        if (!ws.length) return;
        ws.forEach(function (w) { w._lk = look(w.bbox); dens.push(w._lk.dens); });
        rows.push({ ws: ws, one: pl === 1, y0: Math.min.apply(null, ws.map(function (w) { return w.bbox.y0; })), y1: Math.max.apply(null, ws.map(function (w) { return w.bbox.y1; })) });
      });
    }); });
    // one-line pieces on the same row belong together (a row of boxes read as two blocks)
    for (var ra = 0; ra < rows.length; ra++) { if (!rows[ra].one) continue;
      for (var rb = ra + 1; rb < rows.length; rb++) { if (!rows[rb].one) continue;
        var A = rows[ra], B = rows[rb], ov = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ov > 0.6 * Math.min(A.y1 - A.y0, B.y1 - B.y0)) { A.ws = A.ws.concat(B.ws).sort(function (p1, p2) { return p1.bbox.x0 - p2.bbox.x0; }); A.y0 = Math.min(A.y0, B.y0); A.y1 = Math.max(A.y1, B.y1); rows.splice(rb, 1); rb--; } } }
    rows.forEach(function (row) { var wh = row.ws.map(function (w) { return w.bbox.y1 - w.bbox.y0; }).sort(function (p1, p2) { return p1 - p2; }); row.h = wh[wh.length >> 1]; row.hT = wh[Math.min(wh.length - 1, Math.floor(wh.length * 0.85))]; });
    dens.sort(function (p1, p2) { return p1 - p2; });
    var dMed = dens.length ? dens[dens.length >> 1] : 0;
    rows.forEach(function (row) {
      // paint each word away with the colour that is around it, so chips and coloured bands keep their colour
      row.ws.forEach(function (w) { var bb = w.bbox, bc = w._lk.bg; x.fillStyle = 'rgb(' + bc[0] + ',' + bc[1] + ',' + bc[2] + ')'; x.fillRect((bb.x0 - 2) * sc, (bb.y0 - 2) * sc, (bb.x1 - bb.x0 + 4) * sc, (bb.y1 - bb.y0 + 4) * sc); });
      var segs = splitRow(row.ws, row.h);
      segs.forEach(function (sg) {
        var t = fixLine(sg.map(function (w) { return String(w.text).trim(); }).join(' '), segs.length > 2);
        if (!t) return;
        var bx0 = Math.min.apply(null, sg.map(function (w) { return w.bbox.x0; })), bx1 = Math.max.apply(null, sg.map(function (w) { return w.bbox.x1; }));
        var by1 = Math.max.apply(null, sg.map(function (w) { return w.bbox.y1; }));
        var real = sg.filter(function (w) { return w._lk; }); if (!real.length) return;
        var dd = real.map(function (w) { return w._lk.dens; }).sort(function (p1, p2) { return p1 - p2; }), dS = dd[dd.length >> 1];
        var bold = dMed > 0 && dS > dMed * 1.3;
        var cs = [0, 0, 0]; real.forEach(function (w) { cs[0] += w._lk.col[0]; cs[1] += w._lk.col[1]; cs[2] += w._lk.col[2]; }); cs = cs.map(function (v) { return v / real.length; });
        var mx = Math.max.apply(null, cs), mn = Math.min.apply(null, cs), color = mx - mn > 45 ? hexOf(cs.map(function (v) { return v * 0.85; })) : (mx > 150 ? hexOf(cs) : '000000');
        m.font = (bold ? 'bold ' : '') + '100px Arial';
        var hpt = (segs.length > 2 ? row.h * 1.12 : row.hT) * k, tw100 = Math.max(1, m.measureText(t).width / 100), wpt = (bx1 - bx0) * k, fit = wpt / tw100;
        // the Tesseract box of a capital or tall letter is about 0.72 of the font size
        var size = Math.max(5, Math.min(hpt / 0.6, Math.max(hpt * 1.05, fit)));
        size = Math.round(size * 2) / 2;
        lines.push({ text: t, x0: bx0 * k, x1: Math.max(bx1 * k, bx0 * k + tw100 * size * 1.04), y: by1 * k, size: size, bold: bold, color: color, rtl: rtlLang && /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(t) });
      });
    });
    var bg = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.85); }); c.width = c.height = 0;
    return { w: pagePt.w, h: pagePt.h, bg: bg, lines: lines };
  }
  async function downloadLayoutWord() {
    var e = function (v) { return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var tw = function (pt) { return Math.round(pt * 20); }, emu = function (pt) { return Math.max(1, Math.round(pt * 12700)); };
    var z = new JSZip(), rels = '', body = '';
    for (var i = 0; i < st.results.length; i++) {
      var L = st.results[i].layout, id = 'rIdBg' + i, cx = emu(L.w), cy = emu(L.h);
      z.file('word/media/page' + i + '.jpeg', L.bg);
      rels += '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page' + i + '.jpeg"/>';
      var xml = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="' + (10 + i) + '" name="Page ' + (i + 1) + '"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + (10 + i) + '" name="page' + i + '.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
      L.lines.forEach(function (l) {
        var pad = (l.x1 - l.x0) * 0.15 + 6, x0 = l.rtl ? l.x0 - pad : l.x0, wpt = Math.min(l.x1 - l.x0 + pad, L.w - 2 - Math.max(0, x0)), hs = Math.round(l.size * 2);
        xml += '<w:p><w:pPr><w:framePr w:w="' + tw(Math.max(10, wpt)) + '" w:hRule="auto" w:wrap="around" w:hAnchor="page" w:vAnchor="page" w:x="' + tw(Math.max(0, x0)) + '" w:y="' + tw(Math.max(0, l.y - l.size)) + '"/>' + (l.rtl ? '<w:bidi/>' : '') + '<w:spacing w:before="0" w:after="0" w:line="' + Math.round(l.size * 24) + '" w:lineRule="exact"/>' + (l.rtl ? '<w:jc w:val="right"/>' : '') + '</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' + (l.bold ? '<w:b/><w:bCs/>' : '') + (l.color && l.color !== '000000' ? '<w:color w:val="' + l.color + '"/>' : '') + '<w:sz w:val="' + hs + '"/><w:szCs w:val="' + hs + '"/>' + (l.rtl ? '<w:rtl/>' : '') + '</w:rPr><w:t xml:space="preserve">' + e(l.text) + '</w:t></w:r></w:p>';
      });
      var sect = '<w:sectPr><w:pgSz w:w="' + tw(L.w) + '" w:h="' + tw(L.h) + '"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
      body += xml + (i < st.results.length - 1 ? '<w:p><w:pPr>' + sect + '</w:pPr></w:p>' : '');
      if (i === st.results.length - 1) body += sect;
    }
    var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>');
    z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + '</w:body></w:document>');
    var blob = await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    save(blob, baseName() + '.docx');
  }
  async function downloadWord(mode) {
    if (mode === 'layout' && st.results.length && st.results.every(function (r) { return r.layout; })) {
      if (!window.JSZip) { say('Word export is still loading. Try again in a moment.', 'info'); return; }
      return downloadLayoutWord();
    }
    var t = allText(); if (!t) return;
    if (!window.JSZip) { say('Word export is still loading. Try again in a moment.', 'info'); return; }
    var rtl = /^(urd|ara|fas|heb)$/.test($('ocrLang').value);
    var e = function (v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var pPr = rtl ? '<w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>' : '';
    var rPr = rtl ? '<w:rPr><w:rtl/></w:rPr>' : '';
    // headings stay bigger and bold, each line of a block keeps its own line
    var body = '';
    st.results.forEach(function (r, ri) {
      if (ri) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      var box = document.createElement('div'); box.innerHTML = (r.html || '').replace(/<div>/gi, '<p>').replace(/<\/div>/gi, '</p>');
      var kids = box.children.length ? Array.prototype.slice.call(box.children) : [box];
      kids.forEach(function (el) {
        var h = /ocr-h1/.test(el.className) ? 32 : /ocr-h2/.test(el.className) ? 26 : /ocr-h3/.test(el.className) ? 24 : 0;
        var txt = (el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
        txt = txt.replace(/\u00a0/g, ' ').trim(); if (!txt) return;
        var rp = '<w:rPr>' + (h ? '<w:b/><w:sz w:val="' + h + '"/>' : '') + (rtl ? '<w:rtl/>' : '') + '</w:rPr>';
        body += '<w:p>' + pPr + '<w:r>' + rp + '<w:t xml:space="preserve">' + e(txt).replace(/\n/g, '</w:t></w:r><w:r>' + rp + '<w:br/><w:t xml:space="preserve">') + '</w:t></w:r></w:p>';
      });
    });
    var z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
    var blob = await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    save(blob, baseName() + '.docx');
  }

  async function cancel() {
    if (!st.busy) return;
    st.cancelled = true;
    if (st.worker) { try { await st.worker.terminate(); } catch (e) { } st.worker = null; }
    st.busy = false; $('progressCard').style.display = 'none'; renderList();
    if (window.PDLoader) window.PDLoader.hide();
    say('OCR cancelled.', 'info');
  }
  function clear() {
    if (st.busy) return;
    st.items.forEach(function (it) { if (it.url && !it.pdf) URL.revokeObjectURL(it.url); if (it.pdf) try { it.pdf.destroy(); } catch (e) { } });
    st.items = []; st.results = [];
    $('fileInput').value = ''; $('ocrPdfPages').value = '';
    resetResult(); renderList();
  }

  function init() {
    if (!$('ocrRunBtn')) return;
    var dz = $('dropZone'), input = $('fileInput');
    dz.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag-over'); addFiles(e.dataTransfer.files); });
    input.addEventListener('change', function () { var f = input.files; addFiles(f).then(function () { input.value = ''; }); });
    document.addEventListener('paste', function (e) {
      var t = e.target; if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      var files = []; var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { var f = items[i].getAsFile(); if (f) files.push(f); }
      if (files.length) { e.preventDefault(); addFiles(files, true); }
    });
    $('ocrFiles').addEventListener('click', function (e) {
      var b = e.target.closest('.ocr-item-x'); if (!b || st.busy) return;
      var it = st.items.splice(+b.dataset.i, 1)[0];
      if (it && it.url && !it.pdf) URL.revokeObjectURL(it.url);
      if (it && it.pdf) try { it.pdf.destroy(); } catch (x) { }
      resetResult(); renderList();
    });
    try { var sl = localStorage.getItem('ocrLang'); if (sl && $('ocrLang').querySelector('option[value="' + sl + '"]')) $('ocrLang').value = sl; } catch (e) { }
    $('ocrLang').addEventListener('change', function () { try { localStorage.setItem('ocrLang', this.value); } catch (e) { } });
    $('ocrRunBtn').addEventListener('click', run);
    $('ocrClearBtn').addEventListener('click', clear);
    $('ocrCancelBtn').addEventListener('click', cancel);
    $('copyBtn').addEventListener('click', copyText);
    $('downloadTxtBtn').addEventListener('click', function () { $('ocrExportMenu').hidden = true; downloadTxt(); });
    $('downloadWordBtn').addEventListener('click', function () { $('ocrExportMenu').hidden = true; downloadWord('layout'); });
    $('downloadWordTextBtn').addEventListener('click', function () { $('ocrExportMenu').hidden = true; downloadWord('text'); });
    $('ocrExportBtn').addEventListener('click', function (e) { e.stopPropagation(); var m = $('ocrExportMenu'); m.hidden = !m.hidden; this.setAttribute('aria-expanded', String(!m.hidden)); });
    document.addEventListener('click', function (e) { var m = $('ocrExportMenu'); if (m && !m.hidden && !e.target.closest('.ocr-export')) m.hidden = true; });
    $('ocrReBtn').addEventListener('click', function () { if (!st.busy && st.items.length) run(); });
    $('ocrPrev').addEventListener('click', function () { showPage(st.view - 1); });
    $('ocrNext').addEventListener('click', function () { showPage(st.view + 1); });
    $('ocrZoomIn').addEventListener('click', function () { setZoom((st.zoom || 100) + 25); });
    $('ocrZoomOut').addEventListener('click', function () { setZoom((st.zoom || 100) - 25); });
    $('ocrEditor').addEventListener('input', counts);
    $('ocrLang').addEventListener('change', resetResult);
    $('ocrLayout').addEventListener('change', resetResult);
    $('ocrEnhance').addEventListener('change', resetResult);
    renderList();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OcrTool = { addFiles: addFiles, _st: st, _split: splitColumns, _frames: removeFrames, _draw: drawScaled, run: run };
})();
