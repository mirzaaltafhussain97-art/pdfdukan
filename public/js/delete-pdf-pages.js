/* PDFdukan – Delete pages from PDF
 * Runs in the browser. pdf.js draws thumbnails; pdf-lib removes the chosen pages from the
 * loaded document itself (not a copy), so bookmarks, links, metadata and form fields on the
 * kept pages stay in the file. Restricted PDFs are decrypted with qpdf in the browser.
 */
(function () {
  'use strict';
  var MAX_MB = 200;
  var $ = function (id) { return document.getElementById(id); };
  var st = { bytes: null, name: '', pages: 0, del: new Set(), blank: new Set(), last: null, pj: null, out: null, busy: false, password: '' };

  function say(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 3500); }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

  /* ---------- qpdf ---------- */
  var qw = null, qseq = 0, qwait = {};
  function qpdf(bytes, password) {
    if (!qw) { qw = new Worker('../js/qpdf-worker.js?v=20261110'); qw.onmessage = function (e) { var d = e.data, cb = qwait[d.id]; if (cb) { delete qwait[d.id]; cb(d); } }; }
    return new Promise(function (res) { var id = ++qseq; qwait[id] = res; var b = bytes.slice().buffer; qw.postMessage({ id: id, bytes: b, password: password || '' }, [b]); });
  }

  /* ---------- ranges ---------- */
  function parse(s, n) {
    var out = new Set(), ok = true;
    String(s || '').split(/[,;\s]+/).filter(Boolean).forEach(function (p) {
      var m = /^(\d+)(?:-(\d*))?$/.exec(p);
      if (!m) { ok = false; return; }
      var a = +m[1], b = m[2] === undefined ? a : (m[2] === '' ? n : +m[2]);
      if (a < 1 || b < a || a > n) { ok = false; return; }
      for (var i = a; i <= Math.min(b, n); i++) out.add(i);
    });
    return { set: out, ok: ok };
  }
  function fmt(set) {
    var a = Array.from(set).sort(function (x, y) { return x - y; }), out = [], i = 0;
    while (i < a.length) { var j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? a[i] + '-' + a[j] : String(a[i])); i = j + 1; }
    return out.join(', ');
  }

  /* ---------- load ---------- */
  async function load(file) {
    if (st.busy) return;
    if (!file || !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { say('Please choose a PDF file', 'error'); return; }
    if (!file.size || file.size > MAX_MB * 1048576) { say('Please choose a PDF up to ' + MAX_MB + ' MB', 'error'); return; }
    st.busy = true; $('dpInfo').textContent = 'Opening ' + file.name + '…';
    try {
      st.name = file.name; st.size = file.size; st.bytes = new Uint8Array(await file.arrayBuffer()); st.unlocked = false; st.password = '';
      await openBytes();
    } catch (e) { console.error(e); $('dpInfo').textContent = ''; say('This PDF could not be opened', 'error'); }
    st.busy = false;
  }
  async function openBytes() {
    var L = PDFLib;
    try { await L.PDFDocument.load(st.bytes, { updateMetadata: false }); }
    catch (e) {
      if (!/encrypt/i.test(String(e && e.message))) throw e;
      var d = await qpdf(st.bytes, st.password);
      if (!d.ok) { askPassword(); return; }
      st.bytes = new Uint8Array(d.bytes); st.unlocked = true;
    }
    if (st.pj) st.pj.destroy();
    st.pj = await pdfjsLib.getDocument({ data: st.bytes.slice(), isEvalSupported: false }).promise;
    st.pages = st.pj.numPages; st.del = new Set(); st.blank = new Set(); st.last = null; st.out = null;
    $('dpInfo').textContent = '';
    $('dpUpload').hidden = true; $('dpEditor').hidden = false; $('dpResult').hidden = true;
    $('dpName').textContent = st.name;
    $('dpMeta').textContent = st.pages + ' page' + (st.pages === 1 ? '' : 's') + ' · ' + mb(st.size) + (st.unlocked ? ' · restrictions removed in your browser' : '');
    $('dpRange').value = '';
    buildGrid(); sync();
  }
  function askPassword() {
    $('dpInfo').innerHTML = '';
    var box = document.createElement('span'); box.className = 'dp-pwbox';
    box.innerHTML = 'This PDF needs a password to open: <input type="password" id="dpPw" class="dp-in" style="display:inline-block;width:160px;min-height:34px" aria-label="PDF password"> <button type="button" class="btn btn-secondary" id="dpPwGo" style="min-height:34px;padding:4px 12px">Unlock</button>';
    $('dpInfo').appendChild(box);
    var go = async function () {
      st.password = $('dpPw').value; $('dpInfo').textContent = 'Unlocking…';
      try { await openBytes(); } catch (e) { say('This PDF could not be opened', 'error'); }
    };
    $('dpPwGo').onclick = go; $('dpPw').onkeydown = function (e) { if (e.key === 'Enter') go(); }; $('dpPw').focus();
  }

  /* ---------- thumbnails ---------- */
  var io = null;
  function buildGrid() {
    var g = $('dpGrid'); g.innerHTML = '';
    if (io) io.disconnect();
    io = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); thumb(en.target); } }); }, { root: g, rootMargin: '300px' });
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= st.pages; i++) {
      var d = document.createElement('div'); d.className = 'dp-pg'; d.dataset.n = i; d.tabIndex = 0; d.setAttribute('role', 'checkbox'); d.setAttribute('aria-checked', 'false');
      d.setAttribute('aria-label', 'Page ' + i);
      d.innerHTML = '<canvas width="90" height="127"></canvas><span>' + i + '</span>';
      frag.appendChild(d);
    }
    g.appendChild(frag);
    Array.prototype.forEach.call(g.children, function (c) { io.observe(c); });
  }
  async function render(n, w) {
    var p = await st.pj.getPage(n), v1 = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: w / v1.width });
    var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: g, viewport: vp }).promise; p.cleanup();
    return c;
  }
  async function thumb(el) {
    try { var c = await render(+el.dataset.n, 180), old = el.querySelector('canvas'); c.setAttribute('aria-hidden', 'true'); el.replaceChild(c, old); } catch (e) {}
  }

  /* ---------- blank page finder ---------- */
  async function findBlank() {
    if (st.busy) return; st.busy = true; var found = 0;
    for (var n = 1; n <= st.pages; n++) {
      $('dpCount').textContent = 'Checking page ' + n + ' of ' + st.pages + '…';
      try {
        var p = await st.pj.getPage(n), tc = await p.getTextContent();
        var txt = tc.items.map(function (i) { return i.str || ''; }).join('').replace(/\s+/g, '');
        if (txt.length > 2) continue;
        var c = await render(n, 160), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, ink = 0, tot = d.length / 4;
        for (var i = 0; i < d.length; i += 4) { if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 200) ink++; }
        if (ink / tot < 0.003) { st.blank.add(n); st.del.add(n); found++; }
      } catch (e) {}
    }
    st.busy = false; sync();
    say(found ? found + ' blank page' + (found > 1 ? 's' : '') + ' marked. Check them before you delete.' : 'No blank pages found', found ? 'success' : 'info');
  }

  /* ---------- selection ---------- */
  function sync(fromInput) {
    Array.prototype.forEach.call($('dpGrid').children, function (el) {
      var n = +el.dataset.n, on = st.del.has(n);
      el.classList.toggle('del', on); el.classList.toggle('blank', st.blank.has(n)); el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (!fromInput) { $('dpRange').value = fmt(st.del); $('dpRange').classList.remove('bad'); }
    var k = st.del.size, left = st.pages - k;
    $('dpCount').textContent = k ? 'Deleting ' + k + ' of ' + st.pages + ' pages · ' + left + ' left' : 'No pages selected yet';
    $('dpGo').disabled = !k || !left || st.busy;
    if (k && !left) $('dpCount').textContent = 'You can’t delete every page. Keep at least one.';
    $('dpGo').textContent = k ? 'Delete ' + k + ' page' + (k > 1 ? 's' : '') : 'Delete pages';
  }
  function toggle(n, shift) {
    if (shift && st.last) {
      var a = Math.min(st.last, n), b = Math.max(st.last, n), on = !st.del.has(n) || st.del.has(st.last);
      for (var i = a; i <= b; i++) { if (on) st.del.add(i); else st.del.delete(i); }
    } else { if (st.del.has(n)) st.del.delete(n); else st.del.add(n); }
    st.last = n; $('dpResult').hidden = true; sync();
  }

  /* ---------- clean-up: drop bookmarks to deleted pages, then remove unused objects ---------- */
  function tag(r) { return r.objectNumber + ' ' + r.generationNumber; }
  function destPage(item) {
    var L = PDFLib, d = item.lookup(L.PDFName.of('Dest'));
    if (!d) { var a = item.lookup(L.PDFName.of('A')); if (a instanceof L.PDFDict) d = a.lookup(L.PDFName.of('D')); }
    if (d instanceof L.PDFArray && d.size()) { var r = d.get(0); return r instanceof L.PDFRef ? r : null; }
    return null;
  }
  function pruneOutline(doc, dead) {
    var L = PDFLib, N = function (k) { return L.PDFName.of(k); }, removed = 0;
    function walk(parent) {
      var cur = parent.get(N('First'));
      while (cur instanceof L.PDFRef) {
        var item = doc.context.lookup(cur), next = item.get(N('Next'));
        if (item.get(N('First'))) walk(item);
        var pg = destPage(item);
        if (pg && dead.has(tag(pg)) && !item.get(N('First'))) {
          var prev = item.get(N('Prev'));
          if (prev) doc.context.lookup(prev).set(N('Next'), next || L.PDFNull); else if (next) parent.set(N('First'), next); else parent.delete(N('First'));
          if (next) doc.context.lookup(next).set(N('Prev'), prev || L.PDFNull); else if (prev) parent.set(N('Last'), prev); else parent.delete(N('Last'));
          if (prev && !next) doc.context.lookup(prev).delete(N('Next'));
          if (next && !prev) doc.context.lookup(next).delete(N('Prev'));
          var c = parent.lookup(N('Count')); if (c && c.asNumber) { var v = c.asNumber(); parent.set(N('Count'), L.PDFNumber.of(v > 0 ? v - 1 : v < 0 ? v + 1 : 0)); }
          removed++;
        }
        cur = next;
      }
    }
    var ol = doc.catalog.lookup(N('Outlines')); if (ol instanceof L.PDFDict) walk(ol);
    return removed;
  }
  function collect(doc, dead) {
    var L = PDFLib, ctx = doc.context, seen = new Set(), stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
    while (stack.length) {
      var o = stack.pop(); if (!o) continue;
      if (o instanceof L.PDFRef) { var t = tag(o); if (seen.has(t) || dead.has(t)) continue; seen.add(t); stack.push(ctx.lookup(o)); }
      else if (o instanceof L.PDFDict) o.entries().forEach(function (e) { stack.push(e[1]); });
      else if (o instanceof L.PDFArray) o.asArray().forEach(function (v) { stack.push(v); });
      else if (o && o.dict instanceof L.PDFDict) stack.push(o.dict);
    }
    var gone = 0;
    ctx.enumerateIndirectObjects().forEach(function (e) { if (!seen.has(tag(e[0]))) { ctx.delete(e[0]); gone++; } });
    return gone;
  }

  /* ---------- delete ---------- */
  async function run() {
    if (st.busy || !st.del.size || st.del.size >= st.pages) return;
    st.busy = true; $('dpGo').disabled = true; $('dpInfo').textContent = 'Deleting pages…';
    try {
      var L = PDFLib, doc = await L.PDFDocument.load(st.bytes, { updateMetadata: false });
      var list = Array.from(st.del).sort(function (a, b) { return b - a; }), dead = new Set();
      list.forEach(function (n) { dead.add(tag(doc.getPage(n - 1).ref)); });
      list.forEach(function (n) { doc.removePage(n - 1); });
      var lostMarks = pruneOutline(doc, dead);
      collect(doc, dead); // deleted pages' content is not left inside the file
      var out = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
      var chk = await L.PDFDocument.load(out, { updateMetadata: false });
      if (chk.getPageCount() !== st.pages - list.length) throw new Error('verify');
      st.out = out;
      $('dpRTitle').textContent = list.length + ' page' + (list.length > 1 ? 's' : '') + ' deleted';
      $('dpRInfo').textContent = 'Removed pages ' + fmt(st.del) + '. The new PDF has ' + chk.getPageCount() + ' page' + (chk.getPageCount() > 1 ? 's' : '') + ' (' + mb(out.length) + '; original ' + mb(st.size) + '). Kept pages are unchanged, and the deleted pages are not left inside the file.' + (lostMarks ? ' ' + lostMarks + ' bookmark' + (lostMarks > 1 ? 's that pointed' : ' that pointed') + ' to deleted pages ' + (lostMarks > 1 ? 'were' : 'was') + ' removed.' : '');
      $('dpResult').hidden = false; $('dpResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (window.trackToolUse) window.trackToolUse('delete-pdf-pages');
    } catch (e) { console.error(e); say('The pages could not be deleted from this PDF', 'error'); }
    $('dpInfo').textContent = ''; st.busy = false; sync();
  }
  function download() {
    if (!st.out) return;
    var u = URL.createObjectURL(new Blob([st.out], { type: 'application/pdf' })), a = document.createElement('a');
    a.href = u; a.download = st.name.replace(/\.pdf$/i, '') + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }

  /* ---------- wiring ---------- */
  function init() {
    if (!$('dpDrop')) return;
    var dz = $('dpDrop'), inp = $('dpFileInput');
    dz.addEventListener('click', function (e) { if (e.target.closest('.pdz-terms, .cloud-pick, .pdz-foot')) return; inp.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    ['dragover', 'dragenter'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('dragover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function () { dz.classList.remove('dragover'); }); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); load(e.dataTransfer.files[0]); });
    inp.addEventListener('change', function () { load(inp.files[0]); inp.value = ''; });
    $('dpGrid').addEventListener('click', function (e) { var el = e.target.closest('.dp-pg'); if (el && !st.busy) toggle(+el.dataset.n, e.shiftKey); });
    $('dpGrid').addEventListener('keydown', function (e) { var el = e.target.closest('.dp-pg'); if (el && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(+el.dataset.n, e.shiftKey); } });
    $('dpRange').addEventListener('input', function () {
      var r = parse(this.value, st.pages); this.classList.toggle('bad', !r.ok);
      if (r.ok) { st.del = r.set; $('dpResult').hidden = true; sync(true); }
    });
    $('dpRange').addEventListener('change', function () { if (!this.classList.contains('bad')) sync(); });
    document.querySelector('.dp-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b || st.busy) return; var q = b.dataset.q, i;
      if (q === 'blank') return findBlank();
      if (q === 'clear') st.del = new Set();
      else if (q === 'invert') { var s = new Set(); for (i = 1; i <= st.pages; i++) if (!st.del.has(i)) s.add(i); st.del = s; }
      else { for (i = q === 'even' ? 2 : 1; i <= st.pages; i += 2) st.del.add(i); }
      $('dpResult').hidden = true; sync();
    });
    $('dpGo').addEventListener('click', run);
    $('dpDl').addEventListener('click', download);
    $('dpBack').addEventListener('click', function () { $('dpResult').hidden = true; });
    $('dpReset').addEventListener('click', function () { if (st.busy) return; if (st.pj) st.pj.destroy(); st.pj = null; st.bytes = null; $('dpEditor').hidden = true; $('dpResult').hidden = true; $('dpUpload').hidden = false; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.DeletePages = { state: st };
})();
