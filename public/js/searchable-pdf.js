/* PDFdukan – Searchable PDF converter (OCR)
 * Runs in the browser. Tesseract.js (Tesseract OCR compiled to WebAssembly) reads each
 * scanned page; its PDF renderer writes an invisible, Unicode text layer, which is laid
 * over the original page with pdf-lib. The page image itself is not re-compressed.
 * Inputs: PDF (scanned or mixed), JPG, PNG, WebP, BMP, GIF. Restricted PDFs are decrypted
 * with qpdf in the browser; password PDFs need their password.
 */
(function () {
  'use strict';
  var TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  var JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var MAX_PAGES = 200, MAX_MB = 200, MAX_MP = 40e6, TEXT_MIN = 20;
  var IMG = /^image\/(jpeg|png|webp|bmp|gif)$/i, IMG_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i;
  var STORE = 'pd-searchable-v1';
  var $ = function (id) { return document.getElementById(id); };
  var st = { files: [], busy: false, cancel: false, out: [], text: '', seq: 0 };

  function say(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 3500); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function base(n) { return String(n || 'document').replace(/\.[^.]+$/, '') || 'document'; }
  function mb(n) { return (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + ' MB'; }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = res; s.onerror = function () { rej(new Error('net')); }; document.head.appendChild(s);
    });
  }
  function prefs() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs() {
    try { localStorage.setItem(STORE, JSON.stringify({ lang: $('spLang').value, lang2: $('spLang2').value, q: $('spQuality').value, skip: $('spSkip').checked, join: $('spJoin').checked })); } catch (e) {}
  }

  /* ---------- qpdf (restricted or password PDFs) ---------- */
  var qw = null, qseq = 0, qwait = {};
  function qpdf(bytes, password) {
    if (!qw) {
      qw = new Worker('../js/qpdf-worker.js?v=20261110');
      qw.onmessage = function (e) { var d = e.data, cb = qwait[d.id]; if (cb) { delete qwait[d.id]; cb(d); } };
    }
    return new Promise(function (res) { var id = ++qseq; qwait[id] = res; var b = bytes.slice().buffer; qw.postMessage({ id: id, bytes: b, password: password || '' }, [b]); });
  }

  /* ---------- adding files ---------- */
  async function openPdf(f) {
    try { await PDFLib.PDFDocument.load(f.bytes, { updateMetadata: false }); }
    catch (e) {
      if (!/encrypt/i.test(String(e && e.message))) throw e;
      var d = await qpdf(f.bytes, f.password || '');
      if (!d.ok) { f.needPw = true; f.status = 'pw'; f.note = f.password ? 'Wrong password, try again' : 'Password needed'; return; }
      f.bytes = new Uint8Array(d.bytes); f.unlocked = true;
    }
    f.needPw = false;
    var doc = await pdfjsLib.getDocument({ data: f.bytes.slice(), isEvalSupported: false }).promise;
    f.pages = doc.numPages;
    try {
      var p = await doc.getPage(1), vp = p.getViewport({ scale: 1 }), s = 52 / vp.height, v2 = p.getViewport({ scale: s * 2 });
      var c = document.createElement('canvas'); c.width = v2.width; c.height = v2.height;
      await p.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise; f.thumb = c.toDataURL('image/jpeg', 0.7);
    } catch (e) {}
    doc.destroy();
    f.status = 'ready'; f.note = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + mb(f.size) + (f.unlocked ? ' · unlocked' : '');
  }
  async function addFiles(list) {
    if (st.busy) return;
    var arr = Array.prototype.slice.call(list || []), bad = 0, big = 0;
    for (var i = 0; i < arr.length; i++) {
      var file = arr[i], isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name), isImg = IMG.test(file.type) || IMG_EXT.test(file.name);
      if (!isPdf && !isImg) { bad++; continue; }
      if (!file.size || file.size > MAX_MB * 1048576) { big++; continue; }
      var f = { id: ++st.seq, name: file.name, size: file.size, kind: isPdf ? 'pdf' : 'img', file: file, status: 'load', note: 'Reading…', pages: 1 };
      st.files.push(f); render();
      try {
        if (isPdf) { f.bytes = new Uint8Array(await file.arrayBuffer()); await openPdf(f); }
        else {
          var bm = await createImageBitmap(file, { imageOrientation: 'from-image' });
          f.w = bm.width; f.h = bm.height; bm.close();
          if (f.w * f.h > MAX_MP) throw new Error('mp');
          f.thumb = URL.createObjectURL(file); f.status = 'ready'; f.note = f.w + ' × ' + f.h + ' px · ' + mb(f.size);
        }
      } catch (e) {
        f.status = 'fail';
        f.note = e && e.message === 'mp' ? 'Image is over 40 megapixels, crop or resize it first' : 'Could not read this file';
      }
      render();
    }
    if (bad) say(bad + ' file' + (bad > 1 ? 's were' : ' was') + ' skipped: use PDF, JPG, PNG, WebP, BMP or GIF', 'error');
    if (big) say(big + ' file' + (big > 1 ? 's are' : ' is') + ' empty or over ' + MAX_MB + ' MB', 'error');
  }

  /* ---------- file list ---------- */
  function totalPages() { return st.files.reduce(function (n, f) { return n + (f.status === 'fail' ? 0 : (f.pages || 1)); }, 0); }
  function render() {
    var has = st.files.length > 0;
    $('spUpload').hidden = has; $('spEditor').hidden = !has;
    if (!has) { $('spResult').hidden = true; return; }
    var tp = totalPages();
    $('spCount').textContent = '(' + st.files.length + ' file' + (st.files.length > 1 ? 's' : '') + ', ' + tp + ' page' + (tp === 1 ? '' : 's') + ')';
    $('spJoinRow').hidden = st.files.length < 2;
    $('spFiles').innerHTML = st.files.map(function (f, i) {
      var th = f.thumb ? '<img class="sp-thumb" alt="" src="' + f.thumb + '">' : '<span class="sp-thumb">' + (f.kind === 'pdf' ? 'PDF' : 'IMG') + '</span>';
      var pw = f.needPw ? '<div class="sp-pw"><input type="password" data-pw="' + f.id + '" placeholder="PDF password" aria-label="Password for ' + esc(f.name) + '"><button type="button" class="btn btn-secondary" data-a="pw" data-id="' + f.id + '">Unlock</button></div>' : '';
      return '<div class="sp-file ' + f.status + '"><span>' + th + '</span><div class="sp-fmeta"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><span>' + esc(f.note || '') + '</span>' + pw + '</div>' +
        '<button type="button" class="sp-mv" data-a="up" data-id="' + f.id + '" aria-label="Move up"' + (i === 0 || st.busy ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="sp-mv" data-a="down" data-id="' + f.id + '" aria-label="Move down"' + (i === st.files.length - 1 || st.busy ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="sp-x" data-a="rm" data-id="' + f.id + '" aria-label="Remove ' + esc(f.name) + '"' + (st.busy ? ' disabled' : '') + '>✕</button></div>';
    }).join('');
    $('spApply').disabled = st.busy || !st.files.some(function (f) { return f.status === 'ready' || f.status === 'done'; });
    $('spInfo').textContent = tp > MAX_PAGES ? 'This job has ' + tp + ' pages. The limit is ' + MAX_PAGES + ' pages per job: remove a file or split the PDF first.' : '';
  }
  function fileById(id) { for (var i = 0; i < st.files.length; i++) if (st.files[i].id === +id) return i; return -1; }

  /* ---------- OCR ---------- */
  var worker = null, workerLang = '';
  async function getWorker(lang, onLoad) {
    if (typeof Tesseract === 'undefined') await loadScript(TESS);
    if (worker && workerLang === lang) return worker;
    if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; }
    worker = await Tesseract.createWorker(lang.split('+'), 1, {
      logger: function (m) { if (m && /loading/.test(m.status || '') && onLoad) onLoad(m.progress || 0); }
    });
    workerLang = lang;
    return worker;
  }
  async function ocrCanvas(canvas, dpi) {
    await worker.setParameters({ user_defined_dpi: String(Math.round(dpi)) });
    var r = await worker.recognize(canvas, { pdfTitle: 'OCR text layer', pdfTextOnly: true }, { text: true, pdf: true });
    var d = r.data || {};
    return { pdf: new Uint8Array(d.pdf || []), text: (d.text || '').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t:.,'`]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim(), conf: d.confidence || 0 };
  }
  function mul(m, n) { // apply m first, then n (PDF matrix order)
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  }
  function inv(m) {
    var d = m[0] * m[3] - m[1] * m[2];
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
  }
  function wrapPage(page) {
    var L = PDFLib, ctx = page.doc.context;
    var a = ctx.register(page.createContentStream(L.pushGraphicsState())), b = ctx.register(page.createContentStream(L.popGraphicsState()));
    page.node.wrapContentStreams(a, b);
  }
  async function overlay(doc, page, ocrPdf, M) {
    var L = PDFLib, ep = (await doc.embedPdf(ocrPdf, [0]))[0];
    var name = page.node.newXObject('OCRText', ep.ref);
    page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]), L.drawObject(name), L.popGraphicsState());
  }
  function pageCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  async function doPdf(f, target, tick, sum, inPlace) {
    var L = PDFLib, pages;
    var pj = await pdfjsLib.getDocument({ data: f.bytes.slice(), isEvalSupported: false }).promise;
    var dpi = +$('spQuality').value, skip = $('spSkip').checked, texts = [];
    if (inPlace) pages = target.getPages();
    else {
      var src = await L.PDFDocument.load(f.bytes, { updateMetadata: false });
      pages = await target.copyPages(src, src.getPageIndices()); pages.forEach(function (p) { target.addPage(p); });
    }
    for (var i = 0; i < pages.length; i++) {
      if (st.cancel) throw new Error('cancel');
      var pg = await pj.getPage(i + 1);
      if (skip) {
        var tc = await pg.getTextContent(), s = tc.items.map(function (it) { return it.str || ''; }).join(' ');
        if (s.replace(/\s+/g, '').length >= TEXT_MIN) { texts.push(s.replace(/\s+/g, ' ').trim()); sum.skipped++; tick(); continue; }
      }
      var v1 = pg.getViewport({ scale: 1 }), sc = dpi / 72;
      if (v1.width * v1.height * sc * sc > MAX_MP) sc = Math.sqrt(MAX_MP / (v1.width * v1.height));
      var vp = pg.getViewport({ scale: sc }), c = pageCanvas(vp.width, vp.height), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
      var o = await ocrCanvas(c, sc * 72);
      if (o.pdf.length && o.text.replace(/\s+/g, '')) {
        var page = pages[i];
        wrapPage(page);
        var tdoc = await L.PDFDocument.load(o.pdf), tsz = tdoc.getPage(0).getSize();
        var P = [c.width / tsz.width, 0, 0, -c.height / tsz.height, 0, c.height];
        await overlay(target, page, o.pdf, mul(P, inv(vp.transform)));
        sum.ocr++; sum.conf += o.conf;
      } else sum.empty++;
      texts.push(o.text);
      c.width = c.height = 0; pg.cleanup();
      tick();
    }
    pj.destroy();
    return texts;
  }
  async function doImg(f, target, tick, sum) {
    var L = PDFLib, dpi = +$('spQuality').value;
    var bm = await createImageBitmap(f.file, { imageOrientation: 'from-image' }), W = bm.width, H = bm.height;
    var c = pageCanvas(W, H), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(bm, 0, 0); bm.close();
    // page fits inside A4 (595 x 842 pt) in the image's own orientation
    var A = W > H ? [842, 595] : [595, 842], k = Math.min(A[0] / W, A[1] / H), pw = W * k, ph = H * k;
    var png = /png|gif|bmp/i.test(f.file.type) || /\.(png|gif|bmp)$/i.test(f.name);
    var blob = await new Promise(function (r) { c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.92); });
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var img = png ? await target.embedPng(bytes) : await target.embedJpg(bytes);
    var page = target.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    // OCR copy: scale to the chosen DPI for an A4-sized page, never above the original
    var s = Math.min(1, (dpi / 72) / (1 / k) ), oc = c;
    if (s < 0.999) { oc = pageCanvas(W * s, H * s); oc.getContext('2d').drawImage(c, 0, 0, oc.width, oc.height); }
    var o = await ocrCanvas(oc, oc.width / (pw / 72));
    if (oc !== c) oc.width = oc.height = 0; c.width = c.height = 0;
    if (o.pdf.length && o.text.replace(/\s+/g, '')) {
      var tdoc = await L.PDFDocument.load(o.pdf), ts = tdoc.getPage(0).getSize();
      await overlay(target, page, o.pdf, [pw / ts.width, 0, 0, ph / ts.height, 0, 0]);
      sum.ocr++; sum.conf += o.conf;
    } else sum.empty++;
    tick();
    return [o.text];
  }

  /* ---------- run ---------- */
  function prog(p, msg) { $('spProg').hidden = false; $('spFill').style.width = Math.round(p * 100) + '%'; $('spPLbl').textContent = msg; }
  async function run() {
    if (st.busy) return;
    var files = st.files.filter(function (f) { return f.status === 'ready' || f.status === 'done'; });
    if (!files.length) return;
    var tp = files.reduce(function (n, f) { return n + (f.pages || 1); }, 0);
    if (tp > MAX_PAGES) { say('Please keep each job to ' + MAX_PAGES + ' pages or fewer', 'error'); return; }
    var lang = $('spLang').value + ($('spLang2').value && $('spLang2').value !== $('spLang').value ? '+' + $('spLang2').value : '');
    var join = files.length > 1 && $('spJoin').checked;
    savePrefs();
    st.busy = true; st.cancel = false; st.out = []; $('spResult').hidden = true; render();
    var done = 0, sum = { ocr: 0, skipped: 0, empty: 0, conf: 0 }, allText = [];
    var label = $('spLang').selectedOptions[0].textContent + ($('spLang2').value ? ' + ' + $('spLang2').selectedOptions[0].textContent : '');
    function tick() { done++; prog(0.08 + 0.88 * done / tp, 'Page ' + Math.min(done + 1, tp) + ' of ' + tp + ' · reading ' + label + ' text…'); }
    try {
      prog(0.02, 'Loading the OCR engine and ' + label + ' language data…');
      await getWorker(lang, function (p) { prog(0.02 + 0.06 * p, 'Loading ' + label + ' language data… ' + Math.round(p * 100) + '%'); });
      prog(0.08, 'Page 1 of ' + tp + ' · reading ' + label + ' text…');
      var L = PDFLib, joined = join ? await L.PDFDocument.create() : null;
      for (var i = 0; i < files.length; i++) {
        var f = files[i]; f.status = 'run'; f.note = 'Recognizing text…'; render();
        var target = joined || (f.kind === 'pdf' ? null : await L.PDFDocument.create());
        var texts;
        if (f.kind === 'pdf') {
          if (!target) { target = await L.PDFDocument.load(f.bytes, { updateMetadata: false }); }
          texts = await doPdf(f, target, tick, sum, !joined);
        } else texts = await doImg(f, target, tick, sum);
        texts.forEach(function (t) { allText.push(t); });
        if (!joined) {
          target.setProducer('PDFdukan Searchable PDF (Tesseract OCR)');
          st.out.push({ name: base(f.name) + '-searchable.pdf', bytes: await target.save({ useObjectStreams: true }) });
        }
        f.status = 'done'; f.note = (f.pages || 1) + ' page' + ((f.pages || 1) === 1 ? '' : 's') + ' processed'; render();
      }
      if (joined) {
        joined.setTitle(base(files[0].name)); joined.setProducer('PDFdukan Searchable PDF (Tesseract OCR)');
        prog(0.97, 'Saving the PDF…');
        st.out.push({ name: base(files[0].name) + '-searchable.pdf', bytes: await joined.save({ useObjectStreams: true }) });
      }
      st.text = allText.map(function (t, n) { return (allText.length > 1 ? '--- Page ' + (n + 1) + ' ---\n' : '') + (t || ''); }).join('\n\n');
      showResult(sum, lang);
      prog(1, 'Done');
      if (window.trackToolUse) window.trackToolUse('searchable-pdf');
    } catch (e) {
      if (e && e.message === 'cancel') say('Stopped. Nothing was saved.', 'info');
      else { console.error(e); say(e && e.message === 'net' ? 'The OCR engine could not load. Check your connection and try again.' : 'Something went wrong while reading this file. Try High quality off, or a smaller file.', 'error'); }
      files.forEach(function (f) { if (f.status === 'run') { f.status = 'ready'; f.note = 'Not finished'; } });
      $('spProg').hidden = true;
    } finally { st.busy = false; render(); }
  }
  function showResult(sum, lang) {
    var n = st.out.length, parts = [];
    parts.push(sum.ocr + ' page' + (sum.ocr === 1 ? '' : 's') + ' recognized');
    if (sum.skipped) parts.push(sum.skipped + ' already had text and ' + (sum.skipped === 1 ? 'was' : 'were') + ' kept as is');
    if (sum.empty) parts.push(sum.empty + ' had no readable text');
    var conf = sum.ocr ? Math.round(sum.conf / sum.ocr) : 0;
    $('spRTitle').textContent = n > 1 ? n + ' searchable PDFs are ready' : 'Your searchable PDF is ready';
    $('spRInfo').textContent = parts.join(' · ') + '.' + (sum.ocr ? ' Average OCR confidence: ' + conf + '%.' : '') + ' Size: ' + mb(st.out.reduce(function (a, o) { return a + o.bytes.length; }, 0)) + '.';
    $('spDl').textContent = n > 1 ? 'Download all (ZIP)' : 'Download PDF';
    var ta = $('spText'); ta.value = st.text || '(No text was recognized)';
    ta.dir = /^(urd|ara|fas|heb)/.test(lang) ? 'rtl' : 'ltr';
    $('spResult').hidden = false;
    $('spResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function saveBlob(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }
  async function download() {
    if (!st.out.length) return;
    if (st.out.length === 1) return saveBlob(new Blob([st.out[0].bytes], { type: 'application/pdf' }), st.out[0].name);
    if (typeof JSZip === 'undefined') { try { await loadScript(JSZIP); } catch (e) { st.out.forEach(function (o) { saveBlob(new Blob([o.bytes], { type: 'application/pdf' }), o.name); }); return; } }
    var z = new JSZip(), used = {};
    st.out.forEach(function (o) { var nm = o.name, k = 2; while (used[nm]) nm = o.name.replace(/\.pdf$/, '-' + (k++) + '.pdf'); used[nm] = 1; z.file(nm, o.bytes); });
    saveBlob(await z.generateAsync({ type: 'blob' }), 'searchable-pdfs.zip');
  }

  /* ---------- wiring ---------- */
  function init() {
    if (!$('spDrop')) return;
    var p = prefs();
    if (p.lang && $('spLang').querySelector('option[value="' + p.lang + '"]')) $('spLang').value = p.lang;
    if (p.lang2 !== undefined && $('spLang2').querySelector('option[value="' + p.lang2 + '"]')) $('spLang2').value = p.lang2;
    if (p.q) $('spQuality').value = p.q;
    if (p.skip === false) $('spSkip').checked = false;
    if (p.join === false) $('spJoin').checked = false;
    var dz = $('spDrop'), inp = $('spFileInput');
    dz.addEventListener('click', function (e) { if (e.target.closest('.pdz-terms, .cloud-pick, .pdz-foot')) return; inp.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    ['dragover', 'dragenter'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('dragover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function () { dz.classList.remove('dragover'); }); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
    inp.addEventListener('change', function () { addFiles(inp.files); inp.value = ''; });
    $('spMoreInput').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    $('spMore').addEventListener('click', function () { $('spMoreInput').click(); });
    $('spReset').addEventListener('click', function () { if (st.busy) return; st.files = []; st.out = []; $('spProg').hidden = true; render(); });
    $('spApply').addEventListener('click', run);
    $('spCancel').addEventListener('click', function () { st.cancel = true; });
    ['spLang', 'spLang2', 'spQuality', 'spSkip', 'spJoin'].forEach(function (id) { $(id).addEventListener('change', savePrefs); });
    $('spFiles').addEventListener('click', async function (e) {
      var b = e.target.closest('button[data-a]'); if (!b || st.busy) return;
      var i = fileById(b.dataset.id); if (i < 0) return; var f = st.files[i];
      if (b.dataset.a === 'rm') st.files.splice(i, 1);
      else if (b.dataset.a === 'up' && i > 0) st.files.splice(i - 1, 0, st.files.splice(i, 1)[0]);
      else if (b.dataset.a === 'down' && i < st.files.length - 1) st.files.splice(i + 1, 0, st.files.splice(i, 1)[0]);
      else if (b.dataset.a === 'pw') {
        var pw = document.querySelector('input[data-pw="' + f.id + '"]'); f.password = pw ? pw.value : '';
        f.status = 'load'; f.note = 'Unlocking…'; render();
        try { await openPdf(f); } catch (err) { f.status = 'fail'; f.note = 'Could not open this PDF'; }
      }
      render();
    });
    $('spFiles').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('input[data-pw]')) { var b = e.target.parentNode.querySelector('button'); if (b) b.click(); } });
    $('spDl').addEventListener('click', download);
    $('spTxt').addEventListener('click', function () { saveBlob(new Blob(['﻿' + st.text], { type: 'text/plain;charset=utf-8' }), (st.out[0] ? st.out[0].name.replace(/\.pdf$/, '') : 'searchable') + '.txt'); });
    $('spCopy').addEventListener('click', function () {
      var t = st.text || ''; if (!t) return;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { say('Text copied', 'success'); }, function () { $('spText').select(); document.execCommand('copy'); say('Text copied', 'success'); });
    });
    window.addEventListener('beforeunload', function (e) { if (st.busy) { e.preventDefault(); e.returnValue = ''; } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SearchablePDF = { state: st };
})();
