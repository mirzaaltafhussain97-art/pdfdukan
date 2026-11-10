/* Add Page Numbers to PDF — PDFdukan
 * Six positions with mirrored outer corners for double-sided printing, ready formats
 * (1, Page 1, 1 of 10, i/ii, a/b, Bates-style padding) or a custom pattern, page range,
 * start number, Roman front matter, font, size, colour, opacity, margin and an optional
 * white box that hides old numbers. Rotated pages and cropped pages are handled.
 * Restricted PDFs are decrypted in the browser with qpdf; password PDFs need their password.
 * Runs in the browser with pdf-lib and pdf.js. The preview uses the same maths as the output.
 */
(function () {
  'use strict';
  var MAXFILE = 200 * 1024 * 1024, MAXFILES = 20;
  var $ = function (id) { return document.getElementById(id); };
  var PL = function () { return window.PDFLib; };
  var STORE = 'pd-pagenum-v1';
  var st = { files: [], cur: 0, page: 1, busy: false };
  var seq = 0;
  var DEF = { pos: 'bc', mirror: false, fmt: 'n', custom: 'Page {n} of {total}', pad: 0, start: 1, from: 1, to: '', front: 0,
    total: 'all', font: 'helv', bold: false, size: 11, color: '#000000', opacity: 100, margin: 10, box: false };
  var S = load();

  function load() { var o = {}; try { o = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) {} var s = {}; Object.keys(DEF).forEach(function (k) { s[k] = o[k] !== undefined ? o[k] : DEF[k]; }); return s; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function say(m, t) { if (window.toast) toast(m, t || 'info'); }
  var MM = 72 / 25.4;

  /* ---------- numbering ---------- */
  function roman(n) {
    if (n < 1 || n > 3999) return String(n);
    var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], r = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'], o = '';
    for (var i = 0; i < v.length; i++) while (n >= v[i]) { o += r[i]; n -= v[i]; }
    return o;
  }
  function alpha(n) { var s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return s || 'a'; }
  function pad(n) { var s = String(n); var p = +S.pad || 0; while (s.length < p) s = '0' + s; return s; }
  /* which pages get a number, and what each one says */
  function plan(count) {
    var from = Math.max(1, Math.min(count, parseInt(S.from, 10) || 1));
    var to = parseInt(S.to, 10); to = to ? Math.max(from, Math.min(count, to)) : count;
    var front = Math.max(0, Math.min(to - from + 1, parseInt(S.front, 10) || 0));
    var body = to - from + 1 - front, start = parseInt(S.start, 10); if (isNaN(start)) start = 1;
    var total = S.total === 'numbered' ? start + body - 1 : count;
    var map = {};
    for (var p = from; p <= to; p++) {
      var k = p - from;
      if (k < front) { map[p] = roman(k + 1).toLowerCase(); continue; }
      var n = start + (k - front);
      map[p] = format(n, total);
    }
    return { map: map, from: from, to: to, front: front, total: total };
  }
  function format(n, t) {
    var N = pad(n), T = String(t);
    switch (S.fmt) {
      case 'page-n': return 'Page ' + N;
      case 'n-of-t': return N + ' of ' + T;
      case 'page-n-of-t': return 'Page ' + N + ' of ' + T;
      case 'n/t': return N + ' / ' + T;
      case 'dash': return '- ' + N + ' -';
      case 'roman': return roman(n).toLowerCase();
      case 'ROMAN': return roman(n);
      case 'alpha': return alpha(n);
      case 'custom': return (S.custom || '{n}').replace(/\{n\}/gi, N).replace(/\{total\}/gi, T).slice(0, 120);
      default: return N;
    }
  }

  /* ---------- fonts (same metrics for preview and output) ---------- */
  var FONTS = { helv: ['Helvetica', 'HelveticaBold', 'Helvetica, Arial, sans-serif'], times: ['TimesRoman', 'TimesRomanBold', '"Times New Roman", Times, serif'], courier: ['Courier', 'CourierBold', '"Courier New", Courier, monospace'] };
  var metricDoc = null, metricFonts = {};
  async function metricFont() {
    var L = PL(), key = S.font + (S.bold ? 'B' : '');
    if (metricFonts[key]) return metricFonts[key];
    if (!metricDoc) metricDoc = await L.PDFDocument.create();
    var f = FONTS[S.font] || FONTS.helv;
    metricFonts[key] = await metricDoc.embedFont(L.StandardFonts[S.bold ? f[1] : f[0]]);
    return metricFonts[key];
  }
  /* standard PDF fonts only cover Latin text */
  function safeText(t) { return t.replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, '?'); }

  /* ---------- layout in visual page points (origin bottom-left as shown) ---------- */
  function spot(vw, vh, w, capH, pageNo) {
    var m = Math.max(0, +S.margin || 0) * MM, col = S.pos[1], row = S.pos[0];
    if (S.mirror && col !== 'c' && pageNo % 2 === 0) col = col === 'l' ? 'r' : 'l';
    var x = col === 'l' ? m : col === 'r' ? vw - m - w : (vw - w) / 2;
    var y = row === 't' ? vh - m - capH : m;
    return { x: x, y: y };
  }
  function toUser(box, R, vx, vy) {
    var x0 = box.x, y0 = box.y, W = box.width, H = box.height;
    if (R === 90) return [x0 + W - vy, y0 + vx];
    if (R === 180) return [x0 + W - vx, y0 + H - vy];
    if (R === 270) return [x0 + vy, y0 + H - vx];
    return [x0 + vx, y0 + vy];
  }
  /* white box: wide enough to hide an old number of a few digits underneath */
  function boxRect(p, w, sz, capH) { var px = sz * 1.9, py = sz * 0.6; return { x: p.x - px, y: p.y - py, w: w + px * 2, h: capH + py * 2 }; }
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }

  /* ---------- preview ---------- */
  var drawTok = 0;
  async function preview() {
    var f = st.files[st.cur]; if (!f || !f.doc) return;
    var tok = ++drawTok;
    var P = plan(f.pages);
    var pageNo = Math.min(Math.max(1, st.page), f.pages); st.page = pageNo;
    var page = await f.doc.getPage(pageNo); if (tok !== drawTok) return;
    var base = page.getViewport({ scale: 1 });
    var box = $('pnStage'), maxW = Math.min((box.clientWidth || 520) - 24, 560), k = maxW / base.width;
    if (base.height * k > 620) k = 620 / base.height;
    var vp = page.getViewport({ scale: k * (window.devicePixelRatio || 1) });
    var cv = $('pnCanvas'); cv.width = vp.width; cv.height = vp.height;
    cv.style.width = Math.round(base.width * k) + 'px'; cv.style.height = Math.round(base.height * k) + 'px';
    var g = cv.getContext('2d');
    await page.render({ canvasContext: g, viewport: vp }).promise; if (tok !== drawTok) return;
    var label = P.map[pageNo];
    $('pnPageInfo').textContent = 'Page ' + pageNo + ' of ' + f.pages + (label ? ' · shows “' + label + '”' : ' · no number on this page');
    $('pnPrev').disabled = pageNo <= 1; $('pnNext').disabled = pageNo >= f.pages;
    if (!label) return;
    var font = await metricFont(); if (tok !== drawTok) return;
    var txt = safeText(label), sz = +S.size, w = font.widthOfTextAtSize(txt, sz), capH = sz * 0.72;
    var sc = vp.width / base.width, vh = base.height, p = spot(base.width, vh, w, capH, pageNo);
    g.save(); g.globalAlpha = S.opacity / 100;
    if (S.box) { var bx = boxRect(p, w, sz, capH); g.fillStyle = '#ffffff'; g.fillRect(bx.x * sc, (vh - bx.y - bx.h) * sc, bx.w * sc, bx.h * sc); }
    g.fillStyle = S.color; g.font = (S.bold ? 'bold ' : '') + (sz * sc) + 'px ' + (FONTS[S.font] || FONTS.helv)[2]; g.textBaseline = 'alphabetic';
    g.fillText(txt, p.x * sc, (vh - p.y) * sc);
    g.restore();
  }
  var pvTimer = null;
  function schedule() { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 80); }

  /* ---------- decrypt with qpdf (restricted or password PDFs) ---------- */
  var qw = null, qseq = 0, qwait = {};
  function qpdf(bytes, password) {
    if (!qw) {
      qw = new Worker('../js/qpdf-worker.js?v=20261110');
      qw.onmessage = function (e) { var d = e.data, cb = qwait[d.id]; if (cb) { delete qwait[d.id]; cb(d); } };
    }
    return new Promise(function (res) { var id = ++qseq; qwait[id] = res; var b = bytes.slice().buffer; qw.postMessage({ id: id, bytes: b, password: password || '' }, [b]); });
  }

  /* ---------- build one numbered PDF ---------- */
  async function build(f) {
    var L = PL(), doc;
    try { doc = await L.PDFDocument.load(f.bytes, { updateMetadata: false }); }
    catch (e) {
      if (!/encrypt/i.test(String(e && e.message))) throw e;
      var d = await qpdf(f.bytes, f.password);
      if (!d.ok) throw new Error('locked');
      f.bytes = new Uint8Array(d.bytes); f.unlocked = true;
      doc = await L.PDFDocument.load(f.bytes, { updateMetadata: false });
    }
    var pages = doc.getPages(), P = plan(pages.length), list = Object.keys(P.map).map(Number);
    if (!list.length) throw new Error('nopages');
    var fn = FONTS[S.font] || FONTS.helv, font = await doc.embedFont(L.StandardFonts[S.bold ? fn[1] : fn[0]]);
    var c = hexRgb(S.color), col = L.rgb(c[0], c[1], c[2]), op = S.opacity / 100, sz = +S.size, capH = sz * 0.72;
    list.forEach(function (n) {
      var page = pages[n - 1], txt = safeText(P.map[n]);
      var R = ((page.getRotation().angle % 360) + 360) % 360;
      var box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
      var vw = (R === 90 || R === 270) ? box.height : box.width, vh = (R === 90 || R === 270) ? box.width : box.height;
      var w = font.widthOfTextAtSize(txt, sz), p = spot(vw, vh, w, capH, n);
      if (S.box) {
        var bx = boxRect(p, w, sz, capH), r0 = toUser(box, R, bx.x, bx.y);
        page.drawRectangle({ x: r0[0], y: r0[1], width: bx.w, height: bx.h, color: L.rgb(1, 1, 1), opacity: op, rotate: L.degrees(R) });
      }
      var u = toUser(box, R, p.x, p.y);
      page.drawText(txt, { x: u[0], y: u[1], size: sz, font: font, color: col, opacity: op, rotate: L.degrees(R) });
    });
    return doc.save({ useObjectStreams: true });
  }

  /* ---------- run ---------- */
  async function applyAll() {
    if (st.busy || !st.files.length) return;
    if (S.fmt === 'custom' && !/\{n\}/i.test(S.custom || '')) { say('Put {n} in your custom format where the number goes.', 'error'); $('pnCustom').focus(); return; }
    st.busy = true; drawFiles();
    if (window.PDLoader) PDLoader.show('Adding page numbers…', st.files.length + ' file' + (st.files.length > 1 ? 's' : ''));
    var ok = 0;
    for (var i = 0; i < st.files.length; i++) {
      var f = st.files[i]; if (f.needPw) continue;
      if (window.PDLoader) PDLoader.update('Adding page numbers…', 'File ' + (i + 1) + ' of ' + st.files.length);
      try {
        var out = await build(f); f.out = out; f.state = 'done';
        var P = plan(f.pages);
        f.msg = Object.keys(P.map).length + ' of ' + f.pages + ' pages numbered' + (f.unlocked ? ' · restrictions removed' : '') + ' · ' + size(out.length); ok++;
      } catch (e) {
        f.out = null; f.state = 'fail';
        f.msg = e.message === 'locked' ? 'This PDF could not be unlocked.' : e.message === 'nopages' ? 'No pages in your range.' : 'Could not number this file.';
        if (e.message !== 'locked' && e.message !== 'nopages') console.error(e);
      }
    }
    if (window.PDLoader) PDLoader.hide();
    st.busy = false; drawFiles();
    if (ok) { say('Page numbers added to ' + ok + ' file' + (ok > 1 ? 's' : '') + '.', 'success'); if (window.trackToolUse) trackToolUse('page-numbers'); }
    var ready = st.files.filter(function (f) { return f.out; });
    if (ok === 1 && ready.length === 1 && st.files.length === 1) download(ready[0]);
  }
  function outName(f) { return f.name.replace(/\.pdf$/i, '') + '-numbered.pdf'; }
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
    a.href = u; a.download = 'numbered-pdfs.zip'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  /* ---------- files ---------- */
  async function openDoc(f, password) {
    f.doc = await pdfjsLib.getDocument({ data: f.bytes.slice(0), password: password || undefined, isEvalSupported: false }).promise;
    f.pages = f.doc.numPages; f.needPw = false;
    f.msg = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + size(f.size);
  }
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
        try { await openDoc(f); }
        catch (e) {
          if (e && e.name === 'PasswordException') { f.needPw = true; f.pages = 0; f.msg = 'Needs its open password'; }
          else throw e;
        }
        st.files.push(f);
      } catch (e) { skipped.push(file.name + ' (could not be opened)'); }
    }
    $('pnInfo').textContent = skipped.length ? 'Skipped: ' + skipped.join(', ') : '';
    if (st.files.length) { $('pnUpload').hidden = true; $('pnEditor').hidden = false; st.cur = Math.min(st.cur, st.files.length - 1); if (st.files[st.cur].needPw) { var j = st.files.findIndex(function (x) { return !x.needPw; }); if (j >= 0) st.cur = j; } }
    drawFiles(); schedule();
  }
  async function unlockFile(i, pw) {
    var f = st.files[i]; if (!f || !pw) return;
    try { await openDoc(f, pw); }
    catch (e) { say(e && e.name === 'PasswordException' ? 'That password is not right. Try again.' : 'This PDF could not be opened.', 'error'); return; }
    f.password = pw;
    var d = await qpdf(f.bytes, pw);
    if (d.ok) { f.bytes = new Uint8Array(d.bytes); f.unlocked = true; if (f.doc) f.doc.destroy(); await openDoc(f); }
    st.cur = i; st.page = 1; drawFiles(); schedule();
  }
  function drawFiles() {
    $('pnFiles').innerHTML = st.files.map(function (f, i) {
      var cls = 'pn-file' + (i === st.cur ? ' on' : '') + (f.state === 'done' ? ' done' : f.state === 'fail' ? ' fail' : '') + (f.needPw ? ' pw' : '');
      return '<div class="' + cls + '" data-i="' + i + '"><button class="pn-fsel" type="button" data-a="sel" title="Preview this file"><b>' + esc(f.name) + '</b><span>' + esc(f.msg) + '</span></button>' +
        (f.needPw ? '<form class="pn-pw" data-a="pw"><input type="password" placeholder="Open password" aria-label="Password for ' + esc(f.name) + '" autocomplete="off"><button class="btn btn-secondary" type="submit">Unlock</button></form>' : '') +
        (f.out ? '<button class="btn btn-primary pn-dl" type="button" data-a="dl">Download</button>' : '') +
        '<button class="pn-x" type="button" data-a="rm" aria-label="Remove ' + esc(f.name) + '">✕</button></div>';
    }).join('');
    var done = st.files.filter(function (f) { return f.out; }).length, n = st.files.filter(function (f) { return !f.needPw; }).length;
    $('pnZip').hidden = done < 2;
    $('pnApply').disabled = st.busy || !n;
    $('pnApply').textContent = n > 1 ? 'Add page numbers to ' + n + ' PDFs' : 'Add page numbers';
    if (!st.files.length) { $('pnUpload').hidden = false; $('pnEditor').hidden = true; }
  }

  /* ---------- controls ---------- */
  function syncUI() {
    Array.prototype.forEach.call(document.querySelectorAll('.pn-pos button'), function (b) { var on = b.getAttribute('data-p') === S.pos; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('pnMirror').checked = !!S.mirror; $('pnMirror').disabled = S.pos[1] === 'c';
    $('pnFmt').value = S.fmt; $('pnCustomRow').hidden = S.fmt !== 'custom'; $('pnCustom').value = S.custom;
    $('pnPad').value = String(S.pad); $('pnStart').value = S.start; $('pnFrom').value = S.from; $('pnTo').value = S.to; $('pnFront').value = S.front;
    $('pnTotal').value = S.total; $('pnFont').value = S.font; $('pnBold').classList.toggle('on', S.bold); $('pnBold').setAttribute('aria-pressed', S.bold);
    $('pnSize').value = S.size; $('pnSizeV').textContent = S.size + ' pt'; $('pnColor').value = S.color;
    $('pnMargin').value = S.margin; $('pnMarginV').textContent = S.margin + ' mm';
    $('pnOpacity').value = S.opacity; $('pnOpacityV').textContent = S.opacity + '%'; $('pnBox').checked = !!S.box;
  }
  function invalidate() { st.files.forEach(function (f) { if (f.out) { f.out = null; f.state = 'ready'; f.msg = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + size(f.size); } }); drawFiles(); }
  function set(k, v) { S[k] = v; save(); syncUI(); schedule(); invalidate(); }
  var PRESETS = {
    simple: { fmt: 'n', from: 1, front: 0, start: 1, pos: 'bc', mirror: false },
    xofy: { fmt: 'page-n-of-t', from: 1, front: 0, start: 1, pos: 'br', total: 'all' },
    cover: { fmt: 'n', from: 2, front: 0, start: 1, pos: 'bc' },
    thesis: { fmt: 'n', from: 2, front: 3, start: 1, pos: 'bc', total: 'numbered' }
  };

  function init() {
    if (!$('pnDrop')) return;
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('pnDrop'), inp = $('pnFileInput');
    dz.onclick = function () { inp.click(); };
    dz.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = function (e) { addFiles(e.target.files); inp.value = ''; };
    $('pnMoreInput').onchange = function (e) { addFiles(e.target.files); e.target.value = ''; };
    $('pnMore').onclick = function () { $('pnMoreInput').click(); };
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
    $('pnEditor').addEventListener('dragover', function (e) { e.preventDefault(); });
    $('pnEditor').addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    Array.prototype.forEach.call(document.querySelectorAll('.pn-pos button'), function (b) { b.onclick = function () { set('pos', b.getAttribute('data-p')); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.pn-preset'), function (b) {
      b.onclick = function () { var p = PRESETS[b.getAttribute('data-k')]; Object.keys(p).forEach(function (k) { S[k] = p[k]; }); save(); syncUI(); st.page = Math.max(1, +S.from); schedule(); invalidate(); };
    });
    $('pnMirror').onchange = function () { set('mirror', this.checked); };
    $('pnFmt').onchange = function () { set('fmt', this.value); if (this.value === 'custom') $('pnCustom').focus(); };
    $('pnCustom').oninput = function () { S.custom = this.value; save(); schedule(); };
    $('pnCustom').onchange = function () { set('custom', this.value); };
    $('pnPad').onchange = function () { set('pad', +this.value); };
    [['pnStart', 'start'], ['pnFrom', 'from'], ['pnFront', 'front']].forEach(function (a) {
      $(a[0]).oninput = function () { S[a[1]] = this.value === '' ? DEF[a[1]] : +this.value; save(); schedule(); };
      $(a[0]).onchange = function () { set(a[1], this.value === '' ? DEF[a[1]] : +this.value); };
    });
    $('pnTo').oninput = function () { S.to = this.value; save(); schedule(); };
    $('pnTo').onchange = function () { set('to', this.value); };
    $('pnTotal').onchange = function () { set('total', this.value); };
    $('pnFont').onchange = function () { set('font', this.value); };
    $('pnBold').onclick = function () { set('bold', !S.bold); };
    $('pnSize').oninput = function () { S.size = +this.value; $('pnSizeV').textContent = S.size + ' pt'; schedule(); };
    $('pnSize').onchange = function () { set('size', +this.value); };
    $('pnColor').oninput = function () { S.color = this.value; schedule(); };
    $('pnColor').onchange = function () { set('color', this.value); };
    $('pnMargin').oninput = function () { S.margin = +this.value; $('pnMarginV').textContent = S.margin + ' mm'; schedule(); };
    $('pnMargin').onchange = function () { set('margin', +this.value); };
    $('pnOpacity').oninput = function () { S.opacity = +this.value; $('pnOpacityV').textContent = S.opacity + '%'; schedule(); };
    $('pnOpacity').onchange = function () { set('opacity', +this.value); };
    $('pnBox').onchange = function () { set('box', this.checked); };
    $('pnPrev').onclick = function () { st.page--; schedule(); };
    $('pnNext').onclick = function () { st.page++; schedule(); };
    $('pnApply').onclick = applyAll;
    $('pnZip').onclick = downloadZip;
    $('pnReset').onclick = function () { st.files.forEach(function (f) { if (f.doc) f.doc.destroy(); }); st.files = []; st.cur = 0; st.page = 1; $('pnInfo').textContent = ''; drawFiles(); };
    $('pnFiles').addEventListener('submit', function (e) {
      e.preventDefault(); var fm = e.target.closest('.pn-pw'); if (!fm) return;
      unlockFile(+fm.closest('.pn-file').getAttribute('data-i'), fm.querySelector('input').value);
    });
    $('pnFiles').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var i = +b.closest('.pn-file').getAttribute('data-i'), f = st.files[i]; if (!f) return;
      var a = b.getAttribute('data-a');
      if (a === 'sel' && !f.needPw) { st.cur = i; st.page = 1; drawFiles(); schedule(); }
      if (a === 'dl') download(f);
      if (a === 'rm') { if (f.doc) f.doc.destroy(); st.files.splice(i, 1); st.cur = Math.max(0, Math.min(st.cur, st.files.length - 1)); st.page = 1; drawFiles(); schedule(); }
    });
    window.addEventListener('resize', schedule);
    syncUI();
  }
  window.PageNum = { plan: plan, format: format, roman: roman, state: st, S: S, build: build };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
