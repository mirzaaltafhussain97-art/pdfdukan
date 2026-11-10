/* Unlock PDF — PDFdukan
 * Removes PDF permission restrictions (no password needed) and, with the
 * correct password, the open password. Runs qpdf (WebAssembly) in a worker.
 * Files never leave the browser.
 */
(function () {
  'use strict';
  var MAX = 100 * 1024 * 1024, MAXFILES = 20;
  var $ = function (id) { return document.getElementById(id); };
  var items = [], seq = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function base(n) { return n.replace(/\.pdf$/i, '') || 'document'; }

  function qpdf(bytes, password) { return window.RestrictionCheck.qpdf(bytes, password); }

  async function pageCount(bytes) {
    try { var d = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise; var n = d.numPages; d.destroy(); return n; }
    catch (e) { return 0; }
  }

  async function tryOpen(bytes, pw) {
    try { var d = await pdfjsLib.getDocument({ data: bytes.slice(0), password: pw, isEvalSupported: false }).promise; d.destroy(); return 'ok'; }
    catch (e) { return e && e.name === 'PasswordException' ? 'bad' : 'error'; }
  }

  /* ---------- per-file flow ---------- */
  async function process(it, password) {
    it.state = 'work'; it.msg = password ? 'Checking password…' : 'Unlocking…'; draw();
    if (!it.info) {
      try { it.info = await window.RestrictionCheck.analyze({ name: it.name, size: it.size }, it.bytes); }
      catch (e) { it.state = 'fail'; it.msg = 'This file is damaged or is not a PDF.'; draw(); return; }
    }
    var info = it.info;
    if (!info.encrypted) { it.state = 'clear'; it.msg = 'No password or restrictions found. Nothing to remove.'; draw(); return; }
    if (info.cipher && info.cipher.filter !== 'Standard') { it.state = 'fail'; it.msg = 'Locked with a digital certificate, not a password. Only the certificate holder can open it.'; draw(); return; }
    if (info.open === 'needs' && !password) { it.state = 'pw'; it.msg = 'This PDF needs its open password to unlock.'; draw(); return; }

    if (password) {
      var chk = await tryOpen(it.bytes, password);
      if (chk === 'bad') { it.state = 'pw'; it.msg = 'That password is not correct. Try again.'; draw(); return; }
    }
    var r;
    if (!password && info.decrypted) r = { ok: true, bytes: info.decrypted.buffer, warn: info.decryptWarn };
    else if (password) { var q = await window.RestrictionCheck.unlockDetails(info, it.bytes, password); r = q.ok ? { ok: true, bytes: info.decrypted.buffer, warn: q.warn } : q; }
    else r = await qpdf(it.bytes, '');
    if (!r.ok) {
      if (r.badPassword) { it.state = 'pw'; it.msg = password ? 'That password is not correct. Try again.' : 'This PDF needs its open password to unlock.'; }
      else { it.state = 'fail'; it.msg = 'Could not unlock this PDF. ' + (r.msg ? '(' + r.msg.replace(/^.*?:\s*/, '').slice(0, 120) + ')' : ''); }
      draw(); return;
    }
    var out = new Uint8Array(r.bytes);
    it.signedOut = !!info.signed;
    var pages = await pageCount(out);
    if (!pages) { it.state = 'fail'; it.msg = 'The unlocked copy did not open correctly, so it was not offered.'; draw(); return; }
    it.out = out; it.outPages = pages;
    it.removed = (info.perms || []).filter(function (p) { return p.state !== 'yes'; }).map(function (p) { return p.label; });
    if (info.open === 'needs') it.removed.unshift('Open password');
    it.state = 'done';
    it.msg = pages + ' page' + (pages === 1 ? '' : 's') + ' · ' + size(out.length) + (r.warn ? ' · repaired minor file errors' : '');
    draw();
    if (window.trackToolUse) trackToolUse('unlock-pdf');
  }

  function download(it) {
    if (!it.out) return;
    var blob = new Blob([it.out], { type: 'application/pdf' });
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = base(it.name) + '-unlocked.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  async function downloadAll() {
    var done = items.filter(function (i) { return i.out; });
    if (!done.length) return;
    if (done.length === 1) return download(done[0]);
    if (!window.JSZip) { done.forEach(download); return; }
    var z = new JSZip(), used = {};
    done.forEach(function (i) {
      var n = base(i.name) + '-unlocked.pdf', k = 2;
      while (used[n]) n = base(i.name) + '-unlocked-' + (k++) + '.pdf';
      used[n] = 1; z.file(n, i.out);
    });
    var blob = await z.generateAsync({ type: 'blob' });
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = 'unlocked-pdfs.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  /* ---------- rendering ---------- */
  var BADGE = { work: ['…', 'Working'], done: ['✓', 'Unlocked'], clear: ['✓', 'Already open'], pw: ['🔑', 'Password needed'], fail: ['!', 'Not unlocked'], wait: ['…', 'Waiting'] };

  function card(it) {
    var b = BADGE[it.state] || BADGE.wait;
    var h = '<div class="ul-item ul-s-' + it.state + '" data-id="' + it.id + '">';
    h += '<div class="ul-row"><span class="ul-ic" aria-hidden="true">' + b[0] + '</span><div class="ul-main"><div class="ul-name">' + esc(it.name) + '</div><div class="ul-msg">' + esc(it.msg || size(it.size)) + '</div></div>';
    h += '<span class="ul-badge">' + b[1] + '</span>';
    if (it.state === 'done') h += '<button class="btn btn-primary ul-dl" type="button" data-a="dl">Download</button>';
    h += '<button class="ul-x" type="button" data-a="rm" aria-label="Remove ' + esc(it.name) + '">✕</button></div>';
    if (it.state === 'done' && it.removed && it.removed.length) {
      h += '<div class="ul-chips"><span>Removed:</span>' + it.removed.map(function (r) { return '<em>' + esc(r) + '</em>'; }).join('') + '</div>';
    }
    if (it.state === 'done' && it.signedOut) {
      h += '<p class="ul-warn">This PDF was digitally signed. The unlocked copy keeps the signature appearance, but the signature will no longer validate.</p>';
    }
    if (it.state === 'pw') {
      h += '<form class="ul-pw" data-a="pw"><input type="password" autocomplete="off" aria-label="Open password for ' + esc(it.name) + '" placeholder="Enter the PDF password"><button class="btn btn-primary" type="submit">Unlock</button></form>';
    }
    return h + '</div>';
  }

  function draw() {
    var list = $('ulList');
    var focus = document.activeElement && document.activeElement.closest && document.activeElement.closest('.ul-item');
    var fid = focus ? focus.getAttribute('data-id') : null, val = null;
    if (fid && document.activeElement.tagName === 'INPUT') val = document.activeElement.value;
    list.innerHTML = items.map(card).join('');
    if (fid && val !== null) { var inp = list.querySelector('[data-id="' + fid + '"] input'); if (inp) { inp.value = val; inp.focus(); } }
    var n = items.length, ok = items.filter(function (i) { return i.out; }).length;
    var busy = items.some(function (i) { return i.state === 'work' || i.state === 'wait'; });
    $('ulCount').textContent = n + ' file' + (n === 1 ? '' : 's') + (ok ? ' · ' + ok + ' unlocked' : '');
    $('ulAll').hidden = ok < 2;
    $('ulWork').hidden = !n; $('ulUpload').hidden = !!n;
    if (window.PDLoader) { if (busy && !draw._shown) { PDLoader.show('Unlocking PDF…', 'Runs in your browser'); draw._shown = true; } else if (!busy && draw._shown) { PDLoader.hide(); draw._shown = false; } }
  }

  /* ---------- input ---------- */
  var queue = Promise.resolve();
  function addFiles(fl) {
    var info = $('ulInfo'); info.textContent = '';
    var arr = Array.prototype.slice.call(fl || []);
    var skipped = [];
    arr.forEach(function (f) {
      if (items.length >= MAXFILES) { skipped.push(f.name + ' (max ' + MAXFILES + ' files)'); return; }
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { skipped.push(f.name + ' (not a PDF)'); return; }
      if (!f.size) { skipped.push(f.name + ' (empty)'); return; }
      if (f.size > MAX) { skipped.push(f.name + ' (over 100 MB)'); return; }
      var it = { id: ++seq, name: f.name, size: f.size, file: f, state: 'wait', msg: 'Waiting…' };
      items.push(it);
      queue = queue.then(async function () {
        if (items.indexOf(it) < 0) return;
        it.bytes = new Uint8Array(await f.arrayBuffer());
        await process(it);
      });
    });
    if (skipped.length) info.textContent = 'Skipped: ' + skipped.join(', ');
    draw();
  }

  function init() {
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('ulDrop'), inp = $('ulFileInput'), more = $('ulMoreInput');
    if (!dz) return;
    dz.onclick = function () { inp.click(); };
    dz.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = function (e) { addFiles(e.target.files); inp.value = ''; };
    more.onchange = function (e) { addFiles(e.target.files); more.value = ''; };
    $('ulMore').onclick = function () { more.click(); };
    $('ulAll').onclick = downloadAll;
    $('ulReset').onclick = function () { items = []; $('ulInfo').textContent = ''; draw(); };
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
    var work = $('ulWork');
    work.addEventListener('dragover', function (e) { e.preventDefault(); });
    work.addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
    var list = $('ulList');
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b || b.tagName === 'FORM') return;
      var id = +b.closest('.ul-item').getAttribute('data-id');
      var it = items.filter(function (i) { return i.id === id; })[0]; if (!it) return;
      if (b.getAttribute('data-a') === 'dl') download(it);
      if (b.getAttribute('data-a') === 'rm') { items.splice(items.indexOf(it), 1); draw(); }
    });
    list.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target; var id = +f.closest('.ul-item').getAttribute('data-id');
      var it = items.filter(function (i) { return i.id === id; })[0]; if (!it) return;
      var pw = f.querySelector('input').value;
      if (!pw) { it.msg = 'Type the password first.'; draw(); return; }
      queue = queue.then(function () { return process(it, pw); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.UnlockTool = { _items: function () { return items; }, addFiles: addFiles };
})();
