/* PDFdukan — PDF to Image (JPG, PNG, WebP)
 * Runs entirely in the browser with pdf.js. Nothing is uploaded.
 *
 * Two modes:
 *  - "pages"    : renders each selected page as one image at the chosen DPI.
 *  - "embedded" : saves the pictures stored inside the PDF (photos, logos, scans)
 *                 at their own resolution, one file per picture.
 * Password-protected PDFs can be opened with their password (pdf.js decrypts them
 * locally).
 */
(function () {
  'use strict';

  var MAX_FILE = 300 * 1024 * 1024;
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  // Browser canvas limits. iPhone/iPad Safari cannot draw canvases above ~16.7 MP.
  var MAX_AREA = IOS ? 16000000 : 64000000;
  var MAX_DIM = IOS ? 8000 : 14000;
  var THUMB_W = 132;

  var st = {
    file: null, bytes: null, pdf: null, pages: 0, sizes: {}, base: 'document',
    mode: 'pages', fmt: 'jpg', dpi: 200, q: 0.9, bg: 'white', skipSmall: true,
    sel: new Set(), out: [], busy: false, url: '', thumbsDone: new Set(), observer: null, token: 0
  };
  var MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  function $(id) { return document.getElementById(id); }
  function say(msg, type) { if (window.toast) window.toast(msg, type); }
  function size(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function progress(pct, label) {
    $('p2Progress').hidden = false;
    $('p2ProgressFill').style.width = Math.max(2, Math.min(100, pct)) + '%';
    $('p2ProgressLabel').textContent = label || '';
  }
  function pad(n, total) { var d = String(total).length; return String(n).padStart(Math.max(2, d), '0'); }
  function cleanBase(name) {
    var b = name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return (b || 'document').slice(0, 80);
  }

  /* ── Open the PDF (with password support) ───────────────── */
  async function setFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { say('Please choose a PDF file.', 'error'); return; }
    if (f.size > MAX_FILE) { say('This PDF is larger than 300 MB. Split it into smaller parts first.', 'error'); return; }
    if (!window.pdfjsLib) { say('The PDF reader is still loading. Try again in a moment.', 'error'); return; }
    closeDoc();
    st.file = f; st.base = cleanBase(f.name);
    $('p2FileName').textContent = f.name;
    $('p2FileMeta').textContent = size(f.size) + ' · opening…';
    $('p2File').hidden = false; $('dropZone').hidden = true;
    $('p2Settings').hidden = true; $('p2Pages').hidden = true; $('p2Result').hidden = true; $('p2Grid').innerHTML = '';
    try {
      st.bytes = new Uint8Array(await f.arrayBuffer());
      st.pdf = await openDoc(st.bytes);
    } catch (e) {
      if (e && e.name === 'PasswordCancelled') { clear(); return; }
      console.error(e);
      $('p2FileMeta').textContent = size(f.size);
      say('This PDF could not be opened. It may be damaged or not a real PDF.', 'error');
      clear();
      return;
    }
    st.pages = st.pdf.numPages;
    $('p2FileMeta').textContent = size(f.size) + ' · ' + st.pages + ' page' + (st.pages === 1 ? '' : 's') + (st.locked ? ' · unlocked with password' : '');
    st.sel = new Set(); for (var i = 1; i <= st.pages; i++) st.sel.add(i);
    $('p2Settings').hidden = false; $('p2Pages').hidden = false; $('p2Result').hidden = true;
    $('p2Range').value = '';
    buildThumbs();
    await pageSize(1);
    updateUI();
  }

  function openDoc(bytes) {
    st.locked = false;
    return new Promise(function (resolve, reject) {
      var task = window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
      task.onPassword = function (update, reason) {
        st.locked = true;
        askPassword(reason === 2).then(function (pw) {
          if (pw === null) { task.destroy(); var err = new Error('cancel'); err.name = 'PasswordCancelled'; reject(err); }
          else update(pw);
        });
      };
      task.promise.then(function (pdf) { $('p2Pass').hidden = true; resolve(pdf); }, reject);
    });
  }

  function askPassword(wrong) {
    return new Promise(function (resolve) {
      var box = $('p2Pass'), inp = $('p2PassInput');
      box.hidden = false;
      $('p2PassMsg').textContent = wrong ? 'That password did not work. Try again.' : 'This PDF is password-protected. Enter its password to open it.';
      $('p2PassMsg').classList.toggle('p2-bad', !!wrong);
      inp.value = ''; setTimeout(function () { inp.focus(); }, 30);
      function done(v) {
        $('p2PassOk').onclick = null; $('p2PassCancel').onclick = null; inp.onkeydown = null;
        if (v === null) box.hidden = true;
        resolve(v);
      }
      $('p2PassOk').onclick = function () { done(inp.value); };
      $('p2PassCancel').onclick = function () { done(null); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } };
    });
  }

  function closeDoc() {
    st.token++;
    if (st.observer) { st.observer.disconnect(); st.observer = null; }
    if (st.pdf) { try { st.pdf.destroy(); } catch (e) { } }
    st.pdf = null; st.bytes = null; st.sizes = {}; st.out = []; st.thumbsDone = new Set();
    if (st.url) { URL.revokeObjectURL(st.url); st.url = ''; }
  }

  async function pageSize(n) {
    if (st.sizes[n]) return st.sizes[n];
    var p = await st.pdf.getPage(n);
    var v = p.getViewport({ scale: 1 });
    st.sizes[n] = { w: v.width, h: v.height };
    return st.sizes[n];
  }

  // Pixel size for a page at the chosen DPI, kept inside browser canvas limits.
  function fit(sz, dpi) {
    var s = dpi / 72, w = sz.w * s, h = sz.h * s, k = 1;
    if (Math.max(w, h) > MAX_DIM) k = MAX_DIM / Math.max(w, h);
    if (w * k * h * k > MAX_AREA) k = Math.min(k, Math.sqrt(MAX_AREA / (w * h)));
    return { scale: s * k, w: Math.floor(w * k), h: Math.floor(h * k), capped: k < 0.999, dpi: Math.round(dpi * k) };
  }

  /* ── Page previews (rendered only when visible) ─────────── */
  function buildThumbs() {
    var grid = $('p2Grid'); grid.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= st.pages; i++) {
      var d = document.createElement('div');
      d.className = 'p2-thumb sel'; d.dataset.page = i;
      d.innerHTML = '<button type="button" class="p2-pick" role="checkbox" aria-checked="true" aria-label="Page ' + i + '"><span class="p2-check" aria-hidden="true">✓</span><span class="p2-canvas"></span></button>' +
        '<div class="p2-thumb-foot"><span>Page ' + i + '</span><button type="button" class="p2-save" aria-label="Save page ' + i + ' as an image">Save</button></div>';
      frag.appendChild(d);
    }
    grid.appendChild(frag);
    var token = st.token;
    if ('IntersectionObserver' in window) {
      st.observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { st.observer.unobserve(en.target); queueThumb(+en.target.dataset.page, token); } });
      }, { rootMargin: '300px' });
      grid.querySelectorAll('.p2-thumb').forEach(function (t) { st.observer.observe(t); });
    } else {
      for (var j = 1; j <= Math.min(st.pages, 60); j++) queueThumb(j, token);
    }
  }

  var thumbQueue = Promise.resolve();
  function queueThumb(n, token) {
    thumbQueue = thumbQueue.then(function () { return drawThumb(n, token); }).catch(function () { });
  }
  async function drawThumb(n, token) {
    if (token !== st.token || st.thumbsDone.has(n) || !st.pdf) return;
    st.thumbsDone.add(n);
    var page = await st.pdf.getPage(n);
    var v1 = page.getViewport({ scale: 1 });
    st.sizes[n] = { w: v1.width, h: v1.height };
    var vp = page.getViewport({ scale: THUMB_W / v1.width });
    var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
    if (token !== st.token) return;
    var slot = document.querySelector('.p2-thumb[data-page="' + n + '"] .p2-canvas');
    if (slot) { slot.innerHTML = ''; slot.appendChild(c); }
  }

  /* ── Selection ──────────────────────────────────────────── */
  function parseRange(raw, total) {
    var parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return { err: 'Type page numbers, for example 1-3, 5.' };
    var set = new Set();
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return { err: '"' + parts[i] + '" is not a page number. Use 3 or 3-7.' };
      var a = +m[1], b = m[2] ? +m[2] : a;
      if (a > b) { var t = a; a = b; b = t; }
      if (a < 1 || b > total) return { err: 'This PDF has pages 1 to ' + total + '.' };
      for (var p = a; p <= b; p++) set.add(p);
    }
    return { set: set };
  }
  function applySel() {
    document.querySelectorAll('#p2Grid .p2-thumb').forEach(function (t) {
      var on = st.sel.has(+t.dataset.page);
      t.classList.toggle('sel', on);
      t.querySelector('.p2-pick').setAttribute('aria-checked', String(on));
    });
    updateUI();
  }

  /* ── Settings UI ────────────────────────────────────────── */
  function setMode(m) {
    st.mode = m;
    document.querySelectorAll('[data-p2mode]').forEach(function (b) {
      var on = b.dataset.p2mode === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('p2DpiGroup').hidden = m !== 'pages';
    $('p2SmallWrap').hidden = m !== 'embedded';
    document.querySelectorAll('.p2-save').forEach(function (b) { b.hidden = m !== 'pages'; });
    resetResult(); updateUI();
  }
  function setFmt(f) {
    st.fmt = f;
    document.querySelectorAll('[data-p2fmt]').forEach(function (b) {
      var on = b.dataset.p2fmt === f; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('p2QualityWrap').hidden = f === 'png';
    $('p2BgWrap').hidden = f === 'jpg';
    resetResult(); updateUI();
  }

  async function updateUI() {
    var n = st.sel.size;
    $('p2SelCount').textContent = n + ' of ' + st.pages + ' page' + (st.pages === 1 ? '' : 's') + ' selected';
    var go = $('p2Go');
    go.disabled = !st.pdf || n === 0 || st.busy;
    var label = st.mode === 'pages'
      ? 'Convert to ' + (st.fmt === 'webp' ? 'WebP' : st.fmt.toUpperCase()) + ' (' + n + ')'
      : 'Find images (' + n + (n === 1 ? ' page)' : ' pages)');
    go.textContent = (st.mode === 'pages' ? '🖼️ ' : '🔎 ') + label;
    $('p2QualityVal').textContent = Math.round(st.q * 100) + '%';
    var note = '';
    if (st.pdf && st.mode === 'pages') {
      var first = Array.from(st.sel).sort(function (a, b) { return a - b; })[0] || 1;
      var sz = await pageSize(first);
      var f = fit(sz, st.dpi);
      note = 'Page ' + first + ' will be ' + f.w + ' × ' + f.h + ' px (' + (f.capped ? f.dpi + ' DPI, the largest size this browser can draw' : st.dpi + ' DPI') + ').';
      if (st.dpi >= 400 && n > 20) note += ' High DPI on many pages can be slow; try fewer pages if it stops.';
    } else if (st.mode === 'embedded') {
      note = 'Saves each photo, logo or scan stored inside the PDF at its own size. Text and drawings are not included.';
    }
    $('p2DpiNote').textContent = note;
  }

  function resetResult() {
    st.out = [];
    $('p2Result').hidden = true;
    if (st.url) { URL.revokeObjectURL(st.url); st.url = ''; }
  }

  /* ── Encoding helpers ───────────────────────────────────── */
  function toBlob(canvas, fmt, q) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { b ? res(b) : rej(new Error('encode')); }, MIME[fmt], fmt === 'png' ? undefined : q);
    });
  }
  function extOf(blob, wanted) {
    if (blob.type === 'image/png') return 'png';
    if (blob.type === 'image/webp') return 'webp';
    if (blob.type === 'image/jpeg') return 'jpg';
    return wanted;
  }

  async function renderPage(n, fmt) {
    var page = await st.pdf.getPage(n);
    var v1 = page.getViewport({ scale: 1 });
    st.sizes[n] = { w: v1.width, h: v1.height };
    var f = fit(st.sizes[n], st.dpi);
    var vp = page.getViewport({ scale: f.scale });
    var c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    var transparent = fmt !== 'jpg' && st.bg === 'transparent';
    var ctx = c.getContext('2d', { alpha: transparent });
    await page.render({ canvasContext: ctx, viewport: vp, background: transparent ? 'rgba(0,0,0,0)' : 'rgb(255,255,255)' }).promise;
    var blob = await toBlob(c, fmt, st.q);
    var out = { blob: blob, page: n, w: c.width, h: c.height, capped: f.capped, dpi: f.dpi, ext: extOf(blob, fmt) };
    c.width = c.height = 0;
    page.cleanup();
    return out;
  }

  /* ── Mode 1: pages as images ─────────────────────────────── */
  async function runPages(list) {
    var res = [];
    for (var i = 0; i < list.length; i++) {
      progress(3 + Math.round(i / list.length * 92), 'Converting page ' + list[i] + ' (' + (i + 1) + ' of ' + list.length + ')…');
      var r = await renderPage(list[i], st.fmt);
      r.name = st.base + '-page-' + pad(list[i], st.pages) + '.' + r.ext;
      res.push(r);
    }
    return res;
  }

  /* ── Mode 2: pictures stored inside the PDF ─────────────── */
  function getObj(page, id) {
    var store = /^g_/.test(id) ? page.commonObjs : page.objs;
    return new Promise(function (res) {
      try { store.get(id, res); } catch (e) { res(null); }
      setTimeout(function () { res(null); }, 15000);
    });
  }
  function imgToCanvas(img, fmt) {
    var w = img.width, h = img.height;
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var keepAlpha = fmt !== 'jpg';
    var x = c.getContext('2d', { alpha: keepAlpha });
    if (!keepAlpha) { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    if (img.bitmap) { x.drawImage(img.bitmap, 0, 0); return c; }
    if (!img.data) return null;
    var d = img.data, rgba = new Uint8ClampedArray(w * h * 4), j, s;
    if (img.kind === 3) rgba.set(d.subarray ? d.subarray(0, w * h * 4) : d.slice(0, w * h * 4));
    else if (img.kind === 2) { for (j = 0, s = 0; j < w * h; j++, s += 3) { rgba[j * 4] = d[s]; rgba[j * 4 + 1] = d[s + 1]; rgba[j * 4 + 2] = d[s + 2]; rgba[j * 4 + 3] = 255; } }
    else if (img.kind === 1) {
      var row = (w + 7) >> 3;
      for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
        var bit = (d[y * row + (xx >> 3)] >> (7 - (xx & 7))) & 1, v = bit ? 255 : 0, o = (y * w + xx) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
      }
    } else return null;
    var id = new ImageData(rgba, w, h);
    if (keepAlpha) x.putImageData(id, 0, 0);
    else { var t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(id, 0, 0); x.drawImage(t, 0, 0); t.width = t.height = 0; }
    return c;
  }
  async function runEmbedded(list) {
    var O = window.pdfjsLib.OPS, seen = new Set(), res = [], skipped = 0, failed = 0;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      progress(3 + Math.round(i / list.length * 92), 'Looking for images on page ' + n + ' (' + (i + 1) + ' of ' + list.length + ')…');
      var page = await st.pdf.getPage(n);
      var ops = await page.getOperatorList();
      var k = 0;
      for (var j = 0; j < ops.fnArray.length; j++) {
        var fn = ops.fnArray[j], img = null, key = null;
        if (fn === O.paintImageXObject || fn === O.paintImageXObjectRepeat) {
          key = ops.argsArray[j][0];
          if (seen.has(key)) continue;
          img = await getObj(page, key);
        } else if (fn === O.paintInlineImageXObject) {
          img = ops.argsArray[j][0];
        } else continue;
        if (key) seen.add(key);
        if (!img || !img.width || !img.height) { failed++; continue; }
        if (st.skipSmall && img.width * img.height < 64 * 64) { skipped++; continue; }
        var c = imgToCanvas(img, st.fmt);
        if (!c) { failed++; continue; }
        try {
          var blob = await toBlob(c, st.fmt, st.q);
          k++;
          var ext = extOf(blob, st.fmt);
          res.push({ blob: blob, page: n, w: c.width, h: c.height, ext: ext, name: st.base + '-page-' + pad(n, st.pages) + '-image-' + k + '.' + ext });
        } catch (e) { failed++; }
        c.width = c.height = 0;
      }
      page.cleanup();
    }
    return { list: res, skipped: skipped, failed: failed };
  }

  /* ── Run ─────────────────────────────────────────────────── */
  async function run() {
    if (!st.pdf || st.busy || !st.sel.size) return;
    st.busy = true; resetResult(); updateUI();
    var list = Array.from(st.sel).sort(function (a, b) { return a - b; });
    var warn = [];
    try {
      if (st.mode === 'pages') {
        st.out = await runPages(list);
        var capped = st.out.filter(function (o) { return o.capped; });
        if (capped.length) warn.push(capped.length + ' large page' + (capped.length === 1 ? ' was' : 's were') + ' saved at ' + capped[0].dpi + ' DPI, the largest size this browser can draw.');
      } else {
        var r = await runEmbedded(list);
        st.out = r.list;
        if (r.skipped) warn.push(r.skipped + ' small image' + (r.skipped === 1 ? '' : 's') + ' (icons, bullets, lines) skipped. Untick "Skip small images" to include them.');
        if (r.failed) warn.push(r.failed + ' image' + (r.failed === 1 ? '' : 's') + ' could not be read.');
      }
      var wrongType = st.out.filter(function (o) { return o.ext !== st.fmt; });
      if (wrongType.length) warn.push('This browser cannot save ' + st.fmt.toUpperCase() + ', so the images were saved as ' + wrongType[0].ext.toUpperCase() + '.');
      progress(100, 'Done');
      showResult(warn);
    } catch (e) {
      console.error(e);
      say('Something went wrong while converting. Try fewer pages or a lower DPI.', 'error');
    } finally {
      st.busy = false; updateUI();
      setTimeout(function () { $('p2Progress').hidden = true; }, 600);
    }
  }

  function showResult(warn) {
    var box = $('p2Result');
    box.hidden = false;
    if (!st.out.length) {
      $('p2Count').textContent = '0';
      $('p2Total').textContent = '—';
      $('p2Dims').textContent = '—';
      $('p2Warn').hidden = false;
      $('p2Warn').textContent = st.mode === 'embedded'
        ? 'No pictures were found on the selected pages. The page may be text and drawings only, or a scan stored as tiny pieces. Use "Whole pages" instead.'
        : 'Nothing was converted.';
      $('p2Download').hidden = true;
      return;
    }
    var total = st.out.reduce(function (a, o) { return a + o.blob.size; }, 0);
    $('p2Count').textContent = st.out.length;
    $('p2Total').textContent = size(total);
    var f = st.out[0];
    $('p2Dims').textContent = f.w + ' × ' + f.h + ' px';
    $('p2Warn').hidden = !warn.length;
    $('p2Warn').textContent = warn.join(' ');
    $('p2Download').hidden = false;
    $('p2DownloadLabel').textContent = st.out.length === 1
      ? 'Download ' + (f.ext === 'webp' ? 'WebP' : f.ext.toUpperCase())
      : 'Download ZIP (' + st.out.length + ')';
    setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  }

  /* ── Download ───────────────────────────────────────────── */
  function save(blob, name) {
    var finish = function (chosen) {
      if (!chosen) return;
      var ext = name.split('.').pop();
      if (!new RegExp('\\.' + ext + '$', 'i').test(chosen)) chosen += '.' + ext;
      if (st.url) URL.revokeObjectURL(st.url);
      st.url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = st.url; a.download = chosen;
      document.body.appendChild(a); a.click(); a.remove();
      if (window.CMLogs && window.CMLogs.log) window.CMLogs.log({ tool: 'PDF to Image', action: 'convert', output: chosen, size: blob.size });
    };
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(name).then(finish); else finish(name);
  }

  async function download() {
    if (!st.out.length) return;
    if (st.out.length === 1) { save(st.out[0].blob, st.out[0].name); return; }
    if (!window.JSZip) { say('The ZIP maker is still loading. Try again in a moment.', 'error'); return; }
    var btn = $('p2Download'); btn.disabled = true;
    try {
      var zip = new window.JSZip();
      st.out.forEach(function (o) { zip.file(o.name, o.blob, { compression: 'STORE' }); });
      var blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, function (m) { progress(m.percent, 'Making ZIP… ' + Math.round(m.percent) + '%'); });
      $('p2Progress').hidden = true;
      save(blob, st.base + (st.mode === 'pages' ? '-pages' : '-images') + '.zip');
    } catch (e) {
      console.error(e);
      say('The ZIP could not be made. Try fewer pages.', 'error');
    } finally { btn.disabled = false; }
  }

  async function savePage(n) {
    if (!st.pdf || st.busy) return;
    st.busy = true; updateUI();
    try {
      progress(30, 'Converting page ' + n + '…');
      var r = await renderPage(n, st.fmt);
      progress(100, 'Done');
      save(r.blob, st.base + '-page-' + pad(n, st.pages) + '.' + r.ext);
    } catch (e) { console.error(e); say('Page ' + n + ' could not be converted. Try a lower DPI.', 'error'); }
    finally { st.busy = false; updateUI(); setTimeout(function () { $('p2Progress').hidden = true; }, 500); }
  }

  function clear() {
    closeDoc();
    st.file = null; st.pages = 0; st.sel = new Set();
    $('p2File').hidden = true; $('dropZone').hidden = false; $('p2Pass').hidden = true;
    $('p2Settings').hidden = true; $('p2Pages').hidden = true; $('p2Result').hidden = true; $('p2Progress').hidden = true;
    $('p2Grid').innerHTML = '';
    $('fileInput').value = '';
  }

  /* ── Wire up ────────────────────────────────────────────── */
  function init() {
    if (!$('p2Go')) return;
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('dropZone'), input = $('fileInput');
    dz.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag-over'); var f = e.dataTransfer.files[0]; if (f) setFile(f); });
    input.addEventListener('change', function () { var f = input.files[0]; input.value = ''; if (f) setFile(f); });
    $('p2Change').addEventListener('click', function () { input.click(); });
    $('p2Remove').addEventListener('click', clear);

    document.querySelectorAll('[data-p2mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.p2mode); }); });
    document.querySelectorAll('[data-p2fmt]').forEach(function (b) { b.addEventListener('click', function () { setFmt(b.dataset.p2fmt); }); });
    $('p2Dpi').addEventListener('change', function () { st.dpi = +this.value; resetResult(); updateUI(); });
    $('p2Quality').addEventListener('input', function () { st.q = +this.value / 100; resetResult(); updateUI(); });
    document.querySelectorAll('input[name="p2bg"]').forEach(function (r) { r.addEventListener('change', function () { if (r.checked) { st.bg = r.value; resetResult(); } }); });
    $('p2Small').addEventListener('change', function () { st.skipSmall = this.checked; resetResult(); });

    $('p2Grid').addEventListener('click', function (e) {
      var t = e.target.closest('.p2-thumb'); if (!t) return;
      var n = +t.dataset.page;
      if (e.target.closest('.p2-save')) { savePage(n); return; }
      if (e.target.closest('.p2-pick')) { if (st.sel.has(n)) st.sel.delete(n); else st.sel.add(n); resetResult(); applySel(); }
    });
    $('p2All').addEventListener('click', function () { st.sel = new Set(); for (var i = 1; i <= st.pages; i++) st.sel.add(i); resetResult(); applySel(); });
    $('p2None').addEventListener('click', function () { st.sel = new Set(); resetResult(); applySel(); });
    var useRange = function () {
      var r = parseRange($('p2Range').value, st.pages);
      if (r.err) { say(r.err, 'error'); return; }
      st.sel = r.set; resetResult(); applySel();
    };
    $('p2RangeGo').addEventListener('click', useRange);
    $('p2Range').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); useRange(); } });

    $('p2Go').addEventListener('click', run);
    $('p2Download').addEventListener('click', download);
    setMode('pages'); setFmt('jpg');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PdfToImageTool = { setFile: setFile, _st: st, _fit: fit, _parse: parseRange };
})();
