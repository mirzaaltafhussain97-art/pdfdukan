/* PDFdukan — Crop PDF
 * Runs entirely in the browser (pdf.js to preview and measure, pdf-lib to save).
 * Nothing is uploaded.
 *
 * "Crop PDF pages" mode changes each page's visible box (CropBox + MediaBox).
 * Text, links, forms and images are kept as they are, so nothing is re-drawn
 * and there is no quality loss. Content outside the box is hidden, not deleted.
 *   - Auto: finds the white margins on each page and cuts them off.
 *   - Draw: one box (as cuts from each edge) applied to the chosen pages.
 * "Crop an area to image" hands the same file to the region-to-image editor
 * (PDFCrop in tools.js).
 */
(function () {
  'use strict';

  var MAX_FILE = 200 * 1024 * 1024;
  var MIN_SIDE = 36;            // smallest page side after cropping (0.5 in)
  var PADS = { none: 0, small: 9, medium: 18 };   // points (9 pt ≈ 3 mm, 18 pt ≈ 6 mm)

  var st = {
    file: null, bytes: null, pdf: null, pages: 0, base: 'document', password: '', locked: false, editLocked: false,
    mode: 'pages', method: 'auto', pad: 'small', same: true, apply: 'all',
    cur: 1, view: null, scale: 1, canvas: null, cuts: { t: 0, r: 0, b: 0, l: 0 },
    auto: {}, sizes: {}, out: null, url: '', busy: false, imageLoaded: false, token: 0, drag: null
  };

  function $(id) { return document.getElementById(id); }
  function say(msg, type) { if (window.toast) window.toast(msg, type); }
  function size(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function inch(pt) { return (pt / 72).toFixed(2).replace(/\.?0+$/, ''); }
  function mm(pt) { return Math.round(pt / 72 * 25.4); }
  function dims(w, h) { return inch(w) + ' × ' + inch(h) + ' in (' + mm(w) + ' × ' + mm(h) + ' mm)'; }
  function cleanBase(name) {
    var b = name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return (b || 'document').slice(0, 80);
  }
  function progress(pct, label) {
    $('crProgress').hidden = false;
    $('crProgressFill').style.width = Math.max(2, Math.min(100, pct)) + '%';
    $('crProgressLabel').textContent = label || '';
  }

  /* ── Open ───────────────────────────────────────────────── */
  async function setFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { say('Please choose a PDF file.', 'error'); return; }
    if (!f.size) { say('This PDF file is empty.', 'error'); return; }
    if (f.size > MAX_FILE) { say('This PDF is larger than 200 MB. Split it into smaller parts first.', 'error'); return; }
    if (!window.pdfjsLib || !window.PDFLib) { say('The PDF tools are still loading. Try again in a moment.', 'error'); return; }
    closeDoc();
    st.file = f; st.base = cleanBase(f.name);
    $('crFileName').textContent = f.name;
    $('crFileMeta').textContent = size(f.size) + ' · opening…';
    $('crFile').hidden = false; $('crDrop').hidden = true;
    ['crModes', 'crPagesCard', 'crResult'].forEach(function (id) { $(id).hidden = true; });
    showImageMode(false);
    try {
      st.bytes = new Uint8Array(await f.arrayBuffer());
      st.pdf = await openDoc(st.bytes);
    } catch (e) {
      if (e && e.name === 'PasswordCancelled') { clear(); return; }
      console.error(e);
      say('This PDF could not be opened. It may be damaged or not a real PDF.', 'error');
      clear(); return;
    }
    st.pages = st.pdf.numPages;
    // pdf-lib cannot write encrypted files: check once so the PDF mode can say so up front.
    st.editLocked = false;
    try { await window.PDFLib.PDFDocument.load(st.bytes, { updateMetadata: false }); }
    catch (e) { if (/encrypt/i.test(String(e && (e.name + ' ' + e.message)))) st.editLocked = true; }
    $('crFileMeta').textContent = size(f.size) + ' · ' + st.pages + ' page' + (st.pages === 1 ? '' : 's') + (st.locked ? ' · opened with password' : '');
    $('crModes').hidden = false;
    st.cur = 1; st.cuts = { t: 0, r: 0, b: 0, l: 0 };
    setMode(st.editLocked ? 'image' : 'pages', true);
  }

  function openDoc(bytes) {
    st.locked = false; st.password = '';
    return new Promise(function (resolve, reject) {
      var task = window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
      task.onPassword = function (update, reason) {
        st.locked = true;
        askPassword(reason === 2).then(function (pw) {
          if (pw === null) { task.destroy(); var err = new Error('cancel'); err.name = 'PasswordCancelled'; reject(err); }
          else { st.password = pw; update(pw); }
        });
      };
      task.promise.then(function (pdf) { $('crPass').hidden = true; resolve(pdf); }, reject);
    });
  }
  function askPassword(wrong) {
    return new Promise(function (resolve) {
      var box = $('crPass'), inp = $('crPassInput');
      box.hidden = false;
      $('crPassMsg').textContent = wrong ? 'That password did not work. Try again.' : 'This PDF is password-protected. Enter its password to open it.';
      $('crPassMsg').classList.toggle('cr-bad', !!wrong);
      inp.value = ''; setTimeout(function () { inp.focus(); }, 30);
      function done(v) {
        $('crPassOk').onclick = null; $('crPassCancel').onclick = null; inp.onkeydown = null;
        if (v === null) box.hidden = true;
        resolve(v);
      }
      $('crPassOk').onclick = function () { done(inp.value); };
      $('crPassCancel').onclick = function () { done(null); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } };
    });
  }
  function closeDoc() {
    st.token++;
    if (st.pdf) { try { st.pdf.destroy(); } catch (e) { } }
    st.pdf = null; st.bytes = null; st.auto = {}; st.sizes = {}; st.out = null; st.imageLoaded = false;
    if (st.url) { URL.revokeObjectURL(st.url); st.url = ''; }
  }

  /* ── Modes ──────────────────────────────────────────────── */
  function setMode(m, silent) {
    if (m === 'pages' && st.editLocked) {
      if (!silent) say('This PDF is locked against changes, so it can’t be saved as a cropped PDF. Unlock it first, or crop an area to an image.', 'error');
      m = 'image';
    }
    st.mode = m;
    document.querySelectorAll('[data-crmode]').forEach(function (b) {
      var on = b.dataset.crmode === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('crLockNote').hidden = !st.editLocked;
    $('crPagesCard').hidden = m !== 'pages';
    $('crResult').hidden = true;
    showImageMode(m === 'image');
    if (m === 'pages') { setMethod(st.method); renderPreview(); }
    else if (!st.imageLoaded && window.PDFCrop && st.file) {
      st.imageLoaded = true;
      window.PDFCrop.loadPDF([st.file], st.password || undefined);
    }
  }
  function showImageMode(on) {
    var w = $('crImageMode'); if (w) w.hidden = !on;
  }
  function setMethod(m) {
    st.method = m;
    document.querySelectorAll('[data-crmethod]').forEach(function (b) {
      var on = b.dataset.crmethod === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('crAutoOpts').hidden = m !== 'auto';
    $('crDrawOpts').hidden = m !== 'draw';
    $('crStage').classList.toggle('cr-drawing', m === 'draw');
    if (m === 'draw' && !(st.cuts.t || st.cuts.r || st.cuts.b || st.cuts.l) && st.view) {
      // start with a box 0.5 in inside the page so the handles are easy to grab
      st.cuts = { t: 36, r: 36, b: 36, l: 36 };
      syncInputs();
    }
    resetResult(); drawOverlay(); updateInfo();
  }

  /* ── Preview ────────────────────────────────────────────── */
  async function renderPreview() {
    if (!st.pdf) return;
    var token = st.token, n = st.cur;
    var page = await st.pdf.getPage(n);
    var v1 = page.getViewport({ scale: 1 });
    st.sizes[n] = { w: v1.width, h: v1.height };
    var stage = $('crStage');
    var maxW = Math.min(760, (stage.parentElement.clientWidth || 600) - 4);
    var maxH = Math.max(320, Math.min(window.innerHeight * 0.7, 900));
    var cssScale = Math.min(maxW / v1.width, maxH / v1.height);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var vp = page.getViewport({ scale: cssScale * dpr });
    var c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
    if (token !== st.token || n !== st.cur) return;
    st.view = { w: v1.width, h: v1.height, css: cssScale, dpr: dpr };
    st.canvas = c;
    var pc = $('crCanvas');
    pc.width = c.width; pc.height = c.height;
    pc.style.width = Math.round(v1.width * cssScale) + 'px';
    pc.style.height = Math.round(v1.height * cssScale) + 'px';
    $('crPageLabel').textContent = 'Page ' + n + ' of ' + st.pages;
    $('crPrev').disabled = n <= 1; $('crNext').disabled = n >= st.pages;
    $('crPageNav').hidden = st.pages < 2;
    if (st.method === 'auto') await detect(n);
    drawOverlay(); updateInfo();
  }

  // Cuts to show/apply for page n, in points from each displayed edge.
  function cutsFor(n) {
    if (st.method === 'draw') return st.cuts;
    var a = st.auto[n];
    if (!a || a.blank) return null;
    var pad = PADS[st.pad];
    var key = Math.round(a.W) + 'x' + Math.round(a.H);
    var base = st.same && st.sameCuts && st.sameCuts[key] ? st.sameCuts[key] : a;
    return { t: Math.max(0, base.t - pad), r: Math.max(0, base.r - pad), b: Math.max(0, base.b - pad), l: Math.max(0, base.l - pad) };
  }

  function drawOverlay() {
    var pc = $('crCanvas'); if (!st.canvas || !st.view) return;
    var x = pc.getContext('2d');
    x.clearRect(0, 0, pc.width, pc.height);
    x.drawImage(st.canvas, 0, 0);
    var k = st.view.css * st.view.dpr;
    var c = cutsFor(st.cur);
    if (!c) {
      if (st.method === 'auto' && st.auto[st.cur] && st.auto[st.cur].blank) {
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, 0, pc.width, pc.height);
      }
      return;
    }
    var x0 = c.l * k, y0 = c.t * k, x1 = pc.width - c.r * k, y1 = pc.height - c.b * k;
    x.fillStyle = 'rgba(20,20,30,.45)';
    x.fillRect(0, 0, pc.width, y0); x.fillRect(0, y1, pc.width, pc.height - y1);
    x.fillRect(0, y0, x0, y1 - y0); x.fillRect(x1, y0, pc.width - x1, y1 - y0);
    x.lineWidth = 2 * st.view.dpr; x.strokeStyle = '#ff6333'; x.setLineDash(st.method === 'auto' ? [6 * st.view.dpr, 4 * st.view.dpr] : []);
    x.strokeRect(x0, y0, x1 - x0, y1 - y0); x.setLineDash([]);
    if (st.method === 'draw') {
      handles(x0, y0, x1, y1).forEach(function (h) {
        x.beginPath(); x.arc(h.x, h.y, 7 * st.view.dpr, 0, Math.PI * 2);
        x.fillStyle = '#ff6333'; x.fill(); x.lineWidth = 2 * st.view.dpr; x.strokeStyle = '#fff'; x.stroke();
      });
    }
  }
  function handles(x0, y0, x1, y1) {
    var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return [{ k: 'tl', x: x0, y: y0 }, { k: 't', x: mx, y: y0 }, { k: 'tr', x: x1, y: y0 }, { k: 'r', x: x1, y: my },
            { k: 'br', x: x1, y: y1 }, { k: 'b', x: mx, y: y1 }, { k: 'bl', x: x0, y: y1 }, { k: 'l', x: x0, y: my }];
  }

  /* ── Auto margin detection ──────────────────────────────── */
  async function detect(n) {
    if (st.auto[n]) return st.auto[n];
    var page = await st.pdf.getPage(n);
    var v1 = page.getViewport({ scale: 1 });
    var s = Math.min(3, 900 / Math.max(v1.width, v1.height));
    var vp = page.getViewport({ scale: s });
    var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    var ctx = c.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
    var w = c.width, h = c.height, d = ctx.getImageData(0, 0, w, h).data;
    // Paper colour = median of the outer band. Scans are often off-white, not pure white.
    var band = Math.max(2, Math.round(Math.min(w, h) * 0.03)), samp = [[], [], []];
    for (var sy = 0; sy < h; sy += 2) for (var sx = 0; sx < w; sx += 2) {
      if (sx >= band && sx < w - band && sy >= band && sy < h - band) continue;
      var si = (sy * w + sx) * 4; samp[0].push(d[si]); samp[1].push(d[si + 1]); samp[2].push(d[si + 2]);
    }
    var bg = samp.map(function (a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1] || 255; });
    var light = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] >= 200;
    if (!light) bg = [255, 255, 255];           // dark page: only true white counts as margin
    var tol = light && (bg[0] < 250 || bg[1] < 250 || bg[2] < 250) ? 34 : 18;
    var rows = new Uint32Array(h), cols = new Uint32Array(w);
    for (var y = 0; y < h; y++) {
      for (var xx = 0; xx < w; xx++) {
        var i = (y * w + xx) * 4;
        if (Math.abs(d[i] - bg[0]) > tol || Math.abs(d[i + 1] - bg[1]) > tol || Math.abs(d[i + 2] - bg[2]) > tol) { rows[y]++; cols[xx]++; }
      }
    }
    // Ignore single stray specks: a row/column counts only with a few ink pixels.
    var minRow = Math.max(1, Math.floor(w * 0.0015)), minCol = Math.max(1, Math.floor(h * 0.0015));
    var t = 0, b = h - 1, l = 0, r = w - 1;
    // A thin dark strip right at the edge, then clear paper, is usually a scanner
    // edge or shadow: skip it so the margin behind it can still be cut.
    function skipEdge(arr, n, min, from, step) {
      var lim = Math.round(n * 0.06), i = from, k = 0;
      while (k < lim && arr[i] >= min) { i += step; k++; }
      if (k === 0 || k >= lim) return from;
      var gap = 0, j = i;
      while (gap < Math.round(n * 0.4) && arr[j] < min) { j += step; gap++; if (j < 0 || j >= n) return from; }
      return gap >= Math.max(3, Math.round(n * 0.01)) ? i : from;
    }
    var st0 = skipEdge(rows, h, minRow, 0, 1), sb0 = skipEdge(rows, h, minRow, h - 1, -1);
    var sl0 = skipEdge(cols, w, minCol, 0, 1), sr0 = skipEdge(cols, w, minCol, w - 1, -1);
    if (st0 || sb0 !== h - 1 || sl0 || sr0 !== w - 1) {
      // recount without the edge strips
      rows = new Uint32Array(h); cols = new Uint32Array(w);
      for (var y2 = st0; y2 <= sb0; y2++) for (var x2 = sl0; x2 <= sr0; x2++) {
        var i2 = (y2 * w + x2) * 4;
        if (Math.abs(d[i2] - bg[0]) > tol || Math.abs(d[i2 + 1] - bg[1]) > tol || Math.abs(d[i2 + 2] - bg[2]) > tol) { rows[y2]++; cols[x2]++; }
      }
    }
    while (t < h && rows[t] < minRow) t++;
    while (b > t && rows[b] < minRow) b--;
    while (l < w && cols[l] < minCol) l++;
    while (r > l && cols[r] < minCol) r--;
    c.width = c.height = 0;
    var res;
    if (t >= h || l >= w) res = { blank: true };
    else res = { t: t / s, b: (h - 1 - b) / s, l: l / s, r: (w - 1 - r) / s };
    res.W = v1.width; res.H = v1.height;
    st.auto[n] = res;
    return res;
  }

  /* ── Pointer drawing (Draw crop box) ─────────────────────── */
  function evPt(e) {
    var pc = $('crCanvas'), rc = pc.getBoundingClientRect(), k = st.view.w / (rc.width || 1);
    st.view.shown = rc.width / st.view.w;                                   // css px per point as displayed
    return { x: (e.clientX - rc.left) * k, y: (e.clientY - rc.top) * k };  // points
  }
  function onDown(e) {
    if (st.method !== 'draw' || !st.view) return;
    e.preventDefault();
    var p = evPt(e), c = st.cuts, W = st.view.w, H = st.view.h;
    var box = { x0: c.l, y0: c.t, x1: W - c.r, y1: H - c.b };
    var tol = 16 / (st.view.shown || st.view.css), hit = null;
    handles(box.x0, box.y0, box.x1, box.y1).some(function (h) { if (Math.abs(h.x - p.x) < tol && Math.abs(h.y - p.y) < tol) { hit = h.k; return true; } });
    if (!hit && p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1) hit = 'move';
    if (!hit) { hit = 'new'; box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
    st.drag = { k: hit, start: p, box: box };
    $('crCanvas').setPointerCapture && $('crCanvas').setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!st.drag) return;
    e.preventDefault();
    var p = evPt(e), d = st.drag, b = { x0: d.box.x0, y0: d.box.y0, x1: d.box.x1, y1: d.box.y1 }, W = st.view.w, H = st.view.h;
    var dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (d.k === 'move') {
      dx = Math.max(-b.x0, Math.min(W - b.x1, dx)); dy = Math.max(-b.y0, Math.min(H - b.y1, dy));
      b.x0 += dx; b.x1 += dx; b.y0 += dy; b.y1 += dy;
    } else if (d.k === 'new') {
      b = { x0: Math.min(d.start.x, p.x), y0: Math.min(d.start.y, p.y), x1: Math.max(d.start.x, p.x), y1: Math.max(d.start.y, p.y) };
    } else {
      if (/l/.test(d.k)) b.x0 = Math.min(p.x, b.x1 - MIN_SIDE);
      if (/r/.test(d.k)) b.x1 = Math.max(p.x, b.x0 + MIN_SIDE);
      if (/t/.test(d.k)) b.y0 = Math.min(p.y, b.y1 - MIN_SIDE);
      if (/b/.test(d.k)) b.y1 = Math.max(p.y, b.y0 + MIN_SIDE);
    }
    b.x0 = Math.max(0, b.x0); b.y0 = Math.max(0, b.y0); b.x1 = Math.min(W, b.x1); b.y1 = Math.min(H, b.y1);
    st.cuts = { t: b.y0, l: b.x0, r: W - b.x1, b: H - b.y1 };
    syncInputs(); resetResult(); drawOverlay(); updateInfo();
  }
  function onUp() {
    if (!st.drag) return;
    var W = st.view.w, H = st.view.h, c = st.cuts;
    if (W - c.l - c.r < MIN_SIDE || H - c.t - c.b < MIN_SIDE) { st.cuts = { t: 36, r: 36, b: 36, l: 36 }; syncInputs(); drawOverlay(); updateInfo(); }
    st.drag = null;
  }
  function syncInputs() {
    ['t', 'r', 'b', 'l'].forEach(function (k) { var el = $('crCut' + k.toUpperCase()); if (el && document.activeElement !== el) el.value = (st.cuts[k] / 72).toFixed(2); });
  }
  function fromInputs() {
    var c = {};
    ['t', 'r', 'b', 'l'].forEach(function (k) { var v = parseFloat($('crCut' + k.toUpperCase()).value); c[k] = isFinite(v) && v > 0 ? v * 72 : 0; });
    st.cuts = c; resetResult(); drawOverlay(); updateInfo();
  }

  /* ── Info line ──────────────────────────────────────────── */
  async function updateInfo() {
    var info = $('crInfo'); if (!st.pdf || !st.view) { info.textContent = ''; return; }
    var c = cutsFor(st.cur);
    if (st.method === 'auto' && st.auto[st.cur] && st.auto[st.cur].blank) { info.textContent = 'Page ' + st.cur + ' looks blank, so it will be left as it is.'; }
    else if (!c) info.textContent = '';
    else {
      var w = st.view.w - c.l - c.r, h = st.view.h - c.t - c.b;
      info.textContent = 'Page ' + st.cur + ': ' + dims(st.view.w, st.view.h) + ' → ' + dims(w, h) + '.' +
        (st.method === 'auto' && st.same && st.pages > 1 && !st.sameCuts ? ' Pages of the same size get one shared box, so the final size can be a little larger.' : '');
    }
    var list = targetPages();
    $('crGo').disabled = !list || !list.length || st.busy;
    $('crGo').textContent = '✂️ Crop PDF' + (list && list.length && list.length !== st.pages ? ' (' + list.length + (list.length === 1 ? ' page)' : ' pages)') : '');
  }
  function targetPages() {
    if (!st.pages) return [];
    if (st.apply === 'current') return [st.cur];
    if (st.apply === 'range') {
      var r = parseRange($('crRange').value, st.pages);
      return r.err ? null : Array.from(r.set).sort(function (a, b) { return a - b; });
    }
    var all = []; for (var i = 1; i <= st.pages; i++) all.push(i); return all;
  }
  function parseRange(raw, total) {
    var parts = String(raw || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return { err: 'Type page numbers, for example 1-3, 5.' };
    var set = new Set();
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return { err: '"' + parts[i] + '" is not a page number. Use 3 or 3-7.' };
      var a = +m[1], b = m[2] ? +m[2] : a; if (a > b) { var t = a; a = b; b = t; }
      if (a < 1 || b > total) return { err: 'This PDF has pages 1 to ' + total + '.' };
      for (var p = a; p <= b; p++) set.add(p);
    }
    return { set: set };
  }

  function resetResult() { st.out = null; st.sameCuts = null; $('crResult').hidden = true; }

  /* ── Crop and save ──────────────────────────────────────── */
  async function run() {
    if (!st.pdf || st.busy) return;
    var list = targetPages();
    if (!list) { say(parseRange($('crRange').value, st.pages).err, 'error'); return; }
    if (!list.length) return;
    st.busy = true; $('crGo').disabled = true; resetResult();
    try {
      var P = window.PDFLib;
      var blank = 0, done = 0, skipped = 0, nomargin = 0;
      if (st.method === 'auto') {
        for (var i = 0; i < list.length; i++) {
          progress(2 + Math.round(i / list.length * 60), 'Finding margins on page ' + list[i] + ' (' + (i + 1) + ' of ' + list.length + ')…');
          await detect(list[i]);
        }
        st.sameCuts = null;
        if (st.same) {
          // Pages of the same size share one box (the smallest margins among them),
          // so no page loses content and same-size pages stay the same size.
          var sc = {};
          list.forEach(function (n) {
            var a = st.auto[n]; if (!a || a.blank) return;
            var k = Math.round(a.W) + 'x' + Math.round(a.H), o = sc[k];
            sc[k] = o ? { t: Math.min(o.t, a.t), r: Math.min(o.r, a.r), b: Math.min(o.b, a.b), l: Math.min(o.l, a.l) } : { t: a.t, r: a.r, b: a.b, l: a.l };
          });
          st.sameCuts = sc;
        }
      }
      progress(65, 'Saving the cropped PDF…');
      var doc = await P.PDFDocument.load(st.bytes, { updateMetadata: false });
      var pages = doc.getPages();
      var first = null;
      for (var j = 0; j < list.length; j++) {
        var n = list[j];
        var c = cutsFor(n);
        if (st.method === 'auto' && st.auto[n] && st.auto[n].blank) { blank++; continue; }
        if (!c) { skipped++; continue; }
        if (c.t < 0.5 && c.r < 0.5 && c.b < 0.5 && c.l < 0.5) { nomargin++; continue; }
        var pg = await st.pdf.getPage(n);
        var vp = pg.getViewport({ scale: 1 });
        var x0 = c.l, y0 = c.t, x1 = vp.width - c.r, y1 = vp.height - c.b;
        if (x1 - x0 < MIN_SIDE || y1 - y0 < MIN_SIDE) { skipped++; continue; }
        var a = vp.convertToPdfPoint(x0, y0), b2 = vp.convertToPdfPoint(x1, y1);
        var rx = Math.min(a[0], b2[0]), ry = Math.min(a[1], b2[1]), rw = Math.abs(b2[0] - a[0]), rh = Math.abs(b2[1] - a[1]);
        var page = pages[n - 1];
        page.setMediaBox(rx, ry, rw, rh);
        page.setCropBox(rx, ry, rw, rh);
        ['TrimBox', 'BleedBox', 'ArtBox'].forEach(function (k) { if (page.node.get(P.PDFName.of(k))) page.node.set(P.PDFName.of(k), doc.context.obj([rx, ry, rx + rw, ry + rh])); });
        if (!first) first = { n: n, w: x1 - x0, h: y1 - y0, W: vp.width, H: vp.height };
        done++;
      }
      if (!done) {
        say(blank && !nomargin ? 'The selected pages look blank, so nothing was cropped.'
          : st.method === 'auto' ? 'No white margins were found on the selected pages, so nothing was cropped. Try Draw crop box.'
          : 'Nothing to crop: the box covers the whole page. Drag the edges in first.', 'error');
        $('crProgress').hidden = true;
        return;
      }
      var out = await doc.save({ addDefaultPage: false });
      st.out = out;
      progress(100, 'Done');
      $('crResult').hidden = false;
      $('crCount').textContent = done + (done === 1 ? ' page' : ' pages');
      $('crNewSize').textContent = inch(first.w) + ' × ' + inch(first.h) + ' in';
      $('crFileSize').textContent = size(out.length);
      var notes = ['Page ' + first.n + ' went from ' + dims(first.W, first.H) + ' to ' + dims(first.w, first.h) + '.'];
      if (blank) notes.push(blank + ' blank page' + (blank === 1 ? ' was' : 's were') + ' left as ' + (blank === 1 ? 'it is' : 'they are') + '.');
      if (nomargin) notes.push(nomargin + ' page' + (nomargin === 1 ? ' had' : 's had') + ' no white margin and ' + (nomargin === 1 ? 'was' : 'were') + ' left as ' + (nomargin === 1 ? 'it is.' : 'they are.'));
      if (skipped) notes.push(skipped + ' page' + (skipped === 1 ? ' was' : 's were') + ' not cropped because the box was too small for ' + (skipped === 1 ? 'it' : 'them') + '.');
      $('crNote').textContent = notes.join(' ');
      setTimeout(function () { $('crResult').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
    } catch (e) {
      console.error(e);
      var locked = /encrypt|password/i.test(String(e && (e.name + ' ' + e.message)));
      say(locked ? 'This PDF is locked against changes. Unlock it first, then crop it.' : 'This PDF could not be cropped: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    } finally {
      st.busy = false; updateInfo();
      setTimeout(function () { $('crProgress').hidden = true; }, 600);
    }
  }

  function download() {
    if (!st.out) return;
    var blob = new Blob([st.out], { type: 'application/pdf' });
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(blob);
    var save = function (name) {
      if (!name) return;
      var a = document.createElement('a'); a.href = st.url; a.download = /\.pdf$/i.test(name) ? name : name + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      if (window.CMLogs && window.CMLogs.log) window.CMLogs.log({ tool: 'Crop PDF', action: 'crop', output: a.download, size: blob.size });
    };
    var def = st.base + '-cropped.pdf';
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(def).then(save); else save(def);
  }

  function clear() {
    closeDoc();
    st.file = null; st.pages = 0; st.view = null; st.canvas = null;
    $('crFile').hidden = true; $('crDrop').hidden = false; $('crPass').hidden = true;
    ['crModes', 'crPagesCard', 'crResult', 'crProgress'].forEach(function (id) { $(id).hidden = true; });
    showImageMode(false);
    $('crFileInput').value = '';
  }

  /* ── Wire up ────────────────────────────────────────────── */
  function init() {
    if (!$('crGo')) return;
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('crDrop'), input = $('crFileInput');
    dz.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag-over'); var f = e.dataTransfer.files[0]; if (f) setFile(f); });
    input.addEventListener('change', function () { var f = input.files[0]; input.value = ''; if (f) setFile(f); });
    $('crChange').addEventListener('click', function () { input.click(); });
    $('crRemove').addEventListener('click', clear);

    document.querySelectorAll('[data-crmode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.crmode); }); });
    document.querySelectorAll('[data-crmethod]').forEach(function (b) { b.addEventListener('click', function () { setMethod(b.dataset.crmethod); }); });
    document.querySelectorAll('[data-crpad]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.pad = b.dataset.crpad;
        document.querySelectorAll('[data-crpad]').forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
        resetResult(); drawOverlay(); updateInfo();
      });
    });
    $('crSame').addEventListener('change', function () { st.same = this.checked; st.sameCuts = null; resetResult(); drawOverlay(); updateInfo(); });
    document.querySelectorAll('input[name="crApply"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { st.apply = r.value; $('crRange').disabled = r.value !== 'range'; if (r.value === 'range') $('crRange').focus(); resetResult(); updateInfo(); } });
    });
    $('crRange').addEventListener('input', function () { resetResult(); updateInfo(); });
    ['T', 'R', 'B', 'L'].forEach(function (k) { $('crCut' + k).addEventListener('input', fromInputs); });
    $('crReset').addEventListener('click', function () { st.cuts = { t: 36, r: 36, b: 36, l: 36 }; syncInputs(); resetResult(); drawOverlay(); updateInfo(); });
    $('crPrev').addEventListener('click', function () { if (st.cur > 1) { st.cur--; renderPreview(); } });
    $('crNext').addEventListener('click', function () { if (st.cur < st.pages) { st.cur++; renderPreview(); } });

    var cv = $('crCanvas');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (st.mode === 'pages' && st.pdf) renderPreview(); }, 250); });

    $('crGo').addEventListener('click', run);
    $('crDownload').addEventListener('click', download);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CropPdfTool = { setFile: setFile, _st: st, _detect: detect, _parse: parseRange };
})();
