/* PDFdukan — Organize PDF pages (reorder, rotate, delete, duplicate, add blank pages, add more PDFs)
 * Everything runs in the browser:
 *  - pdf.js draws the page thumbnails (only the ones on screen, each drawn once)
 *  - pdf-lib copies the original pages into the new file, so text, links and quality stay as they were
 * The PDF is not uploaded. */
(function () {
  'use strict';
  var MAX_BYTES = 200 * 1024 * 1024, MAX_PAGES = 1500;
  var st = { srcs: [], pages: [], sel: {}, last: null, hist: [], fut: [], seq: 0, zoom: 1, busy: false, base: 'document', sortable: null, io: null, thumbs: {} };
  function $(id) { return document.getElementById(id); }
  function say(m, t) { if (window.toast) window.toast(m, t); }
  function size(b) { return b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }
  function esc(v) { var s = document.createElement('span'); s.textContent = v; return s.innerHTML; }
  function norm(r) { return ((r % 360) + 360) % 360; }

  /* ── history (undo / redo) ───────────────────────────── */
  function snap() { return JSON.stringify(st.pages); }
  function push() { st.hist.push(snap()); if (st.hist.length > 80) st.hist.shift(); st.fut = []; syncUndo(); }
  function undo() { if (!st.hist.length) return; st.fut.push(snap()); st.pages = JSON.parse(st.hist.pop()); st.sel = {}; render(); }
  function redo() { if (!st.fut.length) return; st.hist.push(snap()); st.pages = JSON.parse(st.fut.pop()); st.sel = {}; render(); }
  function syncUndo() { if ($('orgUndo')) $('orgUndo').disabled = !st.hist.length; if ($('orgRedo')) $('orgRedo').disabled = !st.fut.length; }

  /* ── opening files ───────────────────────────────────── */
  async function addFiles(list, at) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)); });
    if (!files.length) { say('Choose a PDF file.', 'error'); return; }
    if (!window.pdfjsLib) { say('The PDF reader is still loading. Try again in a moment.', 'info'); return; }
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var first = !st.srcs.length, added = 0, newPages = [];
    if (window.PDLoader) window.PDLoader.show('Opening PDF…', files[0].name);
    try {
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (f.size > MAX_BYTES) { say('"' + f.name + '" is over 200 MB.', 'error'); continue; }
        var bytes = new Uint8Array(await f.arrayBuffer()), doc;
        try { doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, password: '' }).promise; }
        catch (e) {
          if (/password/i.test(String(e && (e.name + ' ' + e.message)))) say('"' + f.name + '" is locked with a password. Remove the password first, then add it again.', 'error');
          else say('"' + f.name + '" could not be opened as a PDF.', 'error');
          continue;
        }
        if (st.pages.length + doc.numPages > MAX_PAGES) { say('That would make more than ' + MAX_PAGES + ' pages. Split the file first.', 'error'); doc.destroy(); continue; }
        var si = st.srcs.length, sizes = [];
        st.srcs.push({ name: f.name, bytes: bytes, doc: doc, n: doc.numPages, size: f.size });
        for (var p = 1; p <= doc.numPages; p++) {
          var pg = await doc.getPage(p), vp = pg.getViewport({ scale: 1 });   // size as the page is shown (its own rotation included)
          newPages.push({ id: ++st.seq, s: si, i: p - 1, r: 0, base: pg.rotate || 0, w: vp.width, h: vp.height });
          if (window.PDLoader && p % 25 === 0) window.PDLoader.update('Opening PDF…', 'Page ' + p + ' of ' + doc.numPages);
        }
        added++;
      }
    } finally { if (window.PDLoader) window.PDLoader.hide(); }
    if (!added) return;
    if (!first) push();
    if (at == null || at > st.pages.length) at = st.pages.length;
    Array.prototype.splice.apply(st.pages, [at, 0].concat(newPages));
    if (first) { st.base = files[0].name.replace(/\.pdf$/i, '') || 'document'; st.hist = []; st.fut = []; }
    showEditor();
    render();
    if (!first) say(newPages.length + ' page' + (newPages.length === 1 ? '' : 's') + ' added.', 'success');
  }

  function showEditor() {
    $('orgUpload').hidden = true; $('orgEditor').hidden = false;
    var s = st.srcs.map(function (x) { return x.name; });
    $('orgFileName').textContent = s.length > 1 ? s[0] + ' + ' + (s.length - 1) + ' more' : s[0];
  }

  /* ── thumbnails: drawn once, only when on screen ─────── */
  function thumbKey(pg) { return pg.s + ':' + pg.i; }
  async function drawThumb(pg, img) {
    var k = thumbKey(pg);
    if (st.thumbs[k]) { img.src = st.thumbs[k]; return; }
    if (pg.s < 0) return;
    try {
      var page = await st.srcs[pg.s].doc.getPage(pg.i + 1), v1 = page.getViewport({ scale: 1 });
      var sc = Math.min(2.5, 260 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: sc });
      var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
      st.thumbs[k] = c.toDataURL('image/jpeg', 0.8); c.width = c.height = 0;
      img.src = st.thumbs[k];
    } catch (e) { }
  }
  function observe(card) {
    if (!('IntersectionObserver' in window)) { var im = card.querySelector('img'); drawThumb(pageById(+card.dataset.id), im); return; }
    if (!st.io) st.io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        st.io.unobserve(en.target);
        var pg = pageById(+en.target.dataset.id); if (pg) drawThumb(pg, en.target.querySelector('img'));
      });
    }, { rootMargin: '300px' });
    st.io.observe(card);
  }
  function pageById(id) { for (var i = 0; i < st.pages.length; i++) if (st.pages[i].id === id) return st.pages[i]; return null; }
  function idxById(id) { for (var i = 0; i < st.pages.length; i++) if (st.pages[i].id === id) return i; return -1; }

  /* ── grid ────────────────────────────────────────────── */
  function boxSize() { var g = $('orgGrid'), w = g ? g.clientWidth : 0; return w && w < 600 ? Math.max(90, Math.min(150 * st.zoom, w / 2 - 36)) : 150 * st.zoom; }
  function fitImg(img, pg) {
    var side = norm(pg.r) % 180 !== 0;
    var w = side ? pg.h : pg.w, h = side ? pg.w : pg.h, box = boxSize();
    var k = Math.min(box / w, box / h), dw = pg.w * k, dh = pg.h * k;      // drawn size before turning
    img.style.width = dw + 'px'; img.style.height = dh + 'px';
    img.style.transform = 'translate(-50%,-50%) rotate(' + norm(pg.r) + 'deg)';
    var fr = img.parentNode; fr.style.width = (w * k) + 'px'; fr.style.height = (h * k) + 'px';
  }
  /* the grid keeps one card per page: an action only updates the cards it touches, so nothing flashes */
  function makeCard(pg) {
    var card = document.createElement('div');
    card.className = 'org-card'; card.dataset.id = pg.id; card.tabIndex = 0; card.setAttribute('role', 'listitem');
    card.innerHTML =
      '<label class="org-check" title="Select page"><input type="checkbox"><span></span></label>' +
      '<div class="org-thumb"><div class="org-frame">' + (pg.s < 0 ? '<div class="org-blank"></div>' : '<img alt="" draggable="false">') + '</div><span class="org-turn" hidden></span></div>' +
      '<div class="org-meta"><b></b><span></span></div>' +
      '<div class="org-acts">' +
      '<button type="button" data-a="l" title="Rotate left">↺</button>' +
      '<button type="button" data-a="r" title="Rotate right">↻</button>' +
      '<button type="button" data-a="d" title="Duplicate">⧉</button>' +
      '<button type="button" data-a="x" class="org-del" title="Delete">🗑</button></div>';
    var im = card.querySelector('img');
    if (im) { if (st.thumbs[thumbKey(pg)]) im.src = st.thumbs[thumbKey(pg)]; else observe(card); }
    return card;
  }
  function updateCard(card, pg, n, many) {
    var no = n + 1, rot = norm(pg.r), key = [no, rot, !!st.sel[pg.id], many, st.zoom, boxSize()].join('|');
    if (card._key === key) return;
    card._key = key;
    card.classList.toggle('sel', !!st.sel[pg.id]);
    card.setAttribute('aria-label', 'Page ' + no + (pg.s < 0 ? ', blank page' : ', from ' + st.srcs[pg.s].name + ' page ' + (pg.i + 1)) + (rot ? ', turned ' + rot + ' degrees' : ''));
    var cb = card.querySelector('input'); cb.checked = !!st.sel[pg.id]; cb.setAttribute('aria-label', 'Select page ' + no);
    card.querySelector('.org-meta b').textContent = no;
    card.querySelector('.org-meta span').textContent = pg.s < 0 ? 'Blank' : (many ? String.fromCharCode(65 + pg.s % 26) + ' · p.' + (pg.i + 1) : 'p.' + (pg.i + 1));
    var t = card.querySelector('.org-turn'); t.hidden = !rot; t.textContent = rot + '°';
    var bt = card.querySelectorAll('.org-acts button');
    ['left', 'right'].forEach(function (d, k) { bt[k].setAttribute('aria-label', 'Rotate page ' + no + ' ' + d); });
    bt[2].setAttribute('aria-label', 'Duplicate page ' + no); bt[3].setAttribute('aria-label', 'Delete page ' + no);
    var fr = card.querySelector('.org-frame'), im = card.querySelector('img');
    if (im) fitImg(im, pg);
    else { var side = rot % 180 !== 0, w = side ? pg.h : pg.w, h = side ? pg.w : pg.h, k = Math.min(boxSize() / w, boxSize() / h); fr.style.width = w * k + 'px'; fr.style.height = h * k + 'px'; }
  }
  function render() {
    var grid = $('orgGrid'), many = st.srcs.length > 1, have = {};
    grid.style.setProperty('--org-box', (boxSize() + 24) + 'px');
    Array.prototype.forEach.call(grid.children, function (c) { have[c.dataset.id] = c; });
    var want = {};
    st.pages.forEach(function (pg, n) {
      var card = have[pg.id] || makeCard(pg);
      want[pg.id] = 1;
      if (grid.children[n] !== card) grid.insertBefore(card, grid.children[n] || null);   // only cards that changed place move
      updateCard(card, pg, n, many);
    });
    Object.keys(have).forEach(function (id) { if (!want[id]) { if (st.io) st.io.unobserve(have[id]); have[id].remove(); } });
    if (!st.sortable && window.Sortable) {
      st.sortable = Sortable.create(grid, {
        animation: 160, ghostClass: 'org-ghost', chosenClass: 'org-chosen', filter: '.org-acts button, .org-check', preventOnFilter: false,
        delay: 180, delayOnTouchOnly: true, touchStartThreshold: 6, forceFallback: true, fallbackTolerance: 4, scroll: true, bubbleScroll: true,
        onStart: function () { st.dragSnap = snap(); },
        onEnd: function (e) {
          if (e.oldIndex === e.newIndex) return;
          var ids = Array.prototype.map.call(grid.children, function (c) { return +c.dataset.id; });
          st.hist.push(st.dragSnap); st.fut = [];
          // dragging a selected page carries the other selected pages with it, in their order
          var moved = +e.item.dataset.id;
          if (st.sel[moved] && Object.keys(st.sel).length > 1) {
            var keep = ids.filter(function (id) { return !st.sel[id] || id === moved; }), grp = st.pages.filter(function (p) { return st.sel[p.id]; }).map(function (p) { return p.id; });
            var at = keep.indexOf(moved); keep.splice.apply(keep, [at, 1].concat(grp)); ids = keep;
          }
          st.pages = ids.map(pageById);
          render();
        }
      });
    }
    status();
  }
  function status() {
    var n = st.pages.length, s = Object.keys(st.sel).length;
    $('orgCount').textContent = n + ' page' + (n === 1 ? '' : 's') + (s ? ' · ' + s + ' selected' : '');
    $('orgSelBar').hidden = !s;
    $('orgSave').disabled = !n || st.busy;
    $('orgSaveSel').hidden = !s;
    syncUndo();
  }

  /* ── page actions ────────────────────────────────────── */
  function targets() { var s = st.pages.filter(function (p) { return st.sel[p.id]; }); return s.length ? s : st.pages; }
  function rotate(list, d) { if (!list.length) return; push(); list.forEach(function (p) { p.r = norm(p.r + d); }); render(); }
  function del(list) {
    if (!list.length) return;
    if (list.length === st.pages.length) { say('A PDF needs at least one page. Keep one page or add another file.', 'info'); return; }
    push(); var ids = {}; list.forEach(function (p) { ids[p.id] = 1; delete st.sel[p.id]; });
    st.pages = st.pages.filter(function (p) { return !ids[p.id]; }); render();
    say(list.length + ' page' + (list.length === 1 ? '' : 's') + ' deleted. Press Undo to bring ' + (list.length === 1 ? 'it' : 'them') + ' back.', 'success');
  }
  function dup(list) {
    if (!list.length) return; push();
    var out = [];
    st.pages.forEach(function (p) { out.push(p); if (list.indexOf(p) >= 0) { var c = JSON.parse(JSON.stringify(p)); c.id = ++st.seq; out.push(c); } });
    st.pages = out; render();
  }
  function blank() {
    var s = st.pages.filter(function (p) { return st.sel[p.id]; }), ref = s.length ? s[s.length - 1] : st.pages[st.pages.length - 1];
    var at = ref ? idxById(ref.id) + 1 : 0, side = ref && norm(ref.r) % 180 !== 0;
    push();
    st.pages.splice(at, 0, { id: ++st.seq, s: -1, i: 0, r: 0, base: 0, w: ref ? (side ? ref.h : ref.w) : 595.28, h: ref ? (side ? ref.w : ref.h) : 841.89 });
    render(); say('Blank page added after page ' + at + '.', 'success');
  }
  function move(toEnd) {
    var s = st.pages.filter(function (p) { return st.sel[p.id]; }); if (!s.length) return;
    push(); var rest = st.pages.filter(function (p) { return !st.sel[p.id]; });
    st.pages = toEnd ? rest.concat(s) : s.concat(rest); render();
  }
  function reverse() { push(); st.pages.reverse(); render(); }
  /* Alternate pages from two PDFs: front sides from the first file, back sides
     from the second (A1, B1, A2, B2 …). revB = the back sides were scanned
     last-to-first, as a one-sided scanner does when you flip the stack. */
  function interleave(revB) {
    var order = [];
    st.pages.forEach(function (p) { if (p.s >= 0 && order.indexOf(p.s) < 0) order.push(p.s); });
    if (order.length < 2) { say('Add a second PDF first: one with the front pages, one with the back pages.', 'info'); return false; }
    var A = st.pages.filter(function (p) { return p.s === order[0]; }), B = st.pages.filter(function (p) { return p.s === order[1]; });
    var rest = st.pages.filter(function (p) { return p.s !== order[0] && p.s !== order[1]; });
    if (revB) B = B.slice().reverse();
    var out = [], n = Math.max(A.length, B.length);
    for (var k = 0; k < n; k++) { if (A[k]) out.push(A[k]); if (B[k]) out.push(B[k]); }
    push(); st.pages = out.concat(rest); st.sel = {}; render();
    say('Pages alternated: ' + A.length + ' + ' + B.length + (A.length !== B.length ? ' (the files have different page counts, extra pages go last)' : '') + '.', A.length !== B.length ? 'info' : 'success');
    return true;
  }
  function interleaveMenu(btn) {
    var m = $('orgIlMenu');
    if (!m) {
      m = document.createElement('div'); m.id = 'orgIlMenu'; m.hidden = true; m.setAttribute('role', 'menu');
      m.style.cssText = 'position:absolute;z-index:50;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:6px;min-width:260px';
      m.innerHTML = '<div style="font-size:12px;color:var(--text-3,#64748b);padding:6px 10px">First PDF = front pages, second PDF = back pages</div>' +
        '<button type="button" class="org-btn" data-il="0" role="menuitem" style="display:block;width:100%;text-align:left;margin:2px 0">Back pages in normal order</button>' +
        '<button type="button" class="org-btn" data-il="1" role="menuitem" style="display:block;width:100%;text-align:left;margin:2px 0">Back pages in reverse order (flipped stack)</button>';
      m.addEventListener('click', function (e) { var b = e.target.closest('[data-il]'); if (!b) return; m.hidden = true; interleave(b.dataset.il === '1'); });
      document.addEventListener('click', function (e) { if (!m.hidden && !m.contains(e.target) && e.target !== btn) m.hidden = true; });
      document.body.appendChild(m);
    }
    var r = btn.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 280)) + 'px';
    m.style.top = (window.scrollY + r.bottom + 6) + 'px';
    m.hidden = !m.hidden;
  }
  function original() { push(); st.pages.sort(function (a, b) { return (a.s < 0) - (b.s < 0) || a.s - b.s || a.i - b.i || a.id - b.id; }); render(); }
  function selectAll(on) { st.sel = {}; if (on) st.pages.forEach(function (p) { st.sel[p.id] = 1; }); render(); }
  function setZoom(z) { st.zoom = Math.max(0.6, Math.min(2, z)); render(); }

  /* ── large preview ───────────────────────────────────── */
  async function preview(id) {
    var pg = pageById(id); if (!pg) return;
    var dlg = $('orgView'), box = $('orgViewImg');
    st.viewId = id; dlg.hidden = false; box.innerHTML = '';
    $('orgViewNo').textContent = 'Page ' + (idxById(id) + 1) + ' of ' + st.pages.length;
    if (pg.s < 0) { box.innerHTML = '<div class="org-blank big"></div>'; return; }
    var page = await st.srcs[pg.s].doc.getPage(pg.i + 1), v1 = page.getViewport({ scale: 1, rotation: norm(pg.base + pg.r) });
    var maxW = Math.min(window.innerWidth - 40, 900), maxH = window.innerHeight - 140, sc = Math.min(maxW / v1.width, maxH / v1.height) * (window.devicePixelRatio || 1);
    var vp = page.getViewport({ scale: sc, rotation: norm(pg.base + pg.r) }), c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); c.style.width = (vp.width / (window.devicePixelRatio || 1)) + 'px';
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
    if (st.viewId === id) box.appendChild(c);
  }
  function step(d) { var i = idxById(st.viewId) + d; if (i >= 0 && i < st.pages.length) preview(st.pages[i].id); }

  /* ── build the new PDF ───────────────────────────────── */
  async function build(list) {
    var P = window.PDFLib; if (!P) throw new Error('the PDF writer is still loading');
    var out = await P.PDFDocument.create(), loaded = {};
    for (var i = 0; i < list.length; i++) {
      var pg = list[i];
      if (window.PDLoader && i % 10 === 0) window.PDLoader.update('Building your PDF…', 'Page ' + (i + 1) + ' of ' + list.length);
      if (pg.s < 0) { out.addPage([pg.w, pg.h]); continue; }
      if (!loaded[pg.s]) {
        try { loaded[pg.s] = await P.PDFDocument.load(st.srcs[pg.s].bytes, { updateMetadata: false }); }
        catch (e) { throw new Error(/encrypt/i.test(String(e && e.message)) ? '"' + st.srcs[pg.s].name + '" has editing restrictions, so its pages can\'t be copied' : 'could not read "' + st.srcs[pg.s].name + '"'); }
      }
      var cp = (await out.copyPages(loaded[pg.s], [pg.i]))[0];
      if (norm(pg.r)) cp.setRotation(P.degrees(norm(cp.getRotation().angle + pg.r)));
      out.addPage(cp);
    }
    try { var t = loaded[0] && loaded[0].getTitle(); if (t) out.setTitle(t); } catch (e) { }
    out.setProducer('PDFdukan PDF Organizer');
    return out.save({ useObjectStreams: true });
  }
  async function save(onlySel) {
    if (st.busy || !st.pages.length) return;
    var list = onlySel ? st.pages.filter(function (p) { return st.sel[p.id]; }) : st.pages.slice();
    if (!list.length) return;
    st.busy = true; status();
    if (window.PDLoader) window.PDLoader.show('Building your PDF…', list.length + ' pages');
    try {
      var bytes = await build(list), blob = new Blob([bytes], { type: 'application/pdf' });
      if (window.PDLoader) window.PDLoader.hide();
      var name = st.base + (onlySel ? '-selected' : '-organized') + '.pdf';
      var go = function (n) {
        if (!n) return;
        if (!/\.pdf$/i.test(n)) n += '.pdf';
        var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = n;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
        if (window.CMLogs && window.CMLogs.log) window.CMLogs.log({ tool: 'PDF Organizer', action: 'organize', output: n, size: blob.size });
        say('Saved ' + list.length + ' page' + (list.length === 1 ? '' : 's') + ' · ' + size(blob.size) + '. You can keep editing.', 'success');
      };
      if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(name).then(go); else go(name);
    } catch (e) {
      if (window.PDLoader) window.PDLoader.hide();
      console.error(e); say('Could not build the PDF: ' + (e && e.message ? e.message : 'unknown error') + '.', 'error');
    } finally { st.busy = false; status(); }
  }

  function clearAll() {
    st.srcs.forEach(function (s) { try { s.doc.destroy(); } catch (e) { } });
    st.srcs = []; st.pages = []; st.sel = {}; st.hist = []; st.fut = []; st.thumbs = {};
    if (st.sortable) { st.sortable.destroy(); st.sortable = null; }
    $('orgGrid').innerHTML = ''; $('orgEditor').hidden = true; $('orgUpload').hidden = false; $('orgFileInput').value = '';
  }

  /* ── events ──────────────────────────────────────────── */
  function init() {
    if (!$('orgDrop')) return;
    var dz = $('orgDrop'), input = $('orgFileInput'), more = $('orgMoreInput');
    dz.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag-over'); }); });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
    input.addEventListener('change', function () { addFiles(input.files).then(function () { input.value = ''; }); });
    more.addEventListener('change', function () {
      var s = st.pages.filter(function (p) { return st.sel[p.id]; }), at = s.length ? idxById(s[s.length - 1].id) + 1 : st.pages.length;
      addFiles(more.files, at).then(function () { more.value = ''; });
    });
    // files dropped on the page grid are added at the end
    $('orgEditor').addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
    $('orgEditor').addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

    var grid = $('orgGrid');
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.org-card'); if (!card) return;
      var id = +card.dataset.id, pg = pageById(id);
      var b = e.target.closest('.org-acts button');
      if (b) { var a = b.dataset.a; if (a === 'l') rotate([pg], -90); else if (a === 'r') rotate([pg], 90); else if (a === 'd') dup([pg]); else if (a === 'x') del([pg]); return; }
      var chk = e.target.closest('.org-check');
      if (chk) { if (e.target.tagName !== 'INPUT') return; }
      if (e.shiftKey && st.last != null) {
        var a1 = idxById(st.last), a2 = idxById(id); if (a1 >= 0) { for (var k = Math.min(a1, a2); k <= Math.max(a1, a2); k++) st.sel[st.pages[k].id] = 1; render(); return; }
      }
      if (!chk && !(e.ctrlKey || e.metaKey)) {
        // a plain click on the picture toggles that page only
      }
      if (st.sel[id]) delete st.sel[id]; else st.sel[id] = 1;
      st.last = id; card.classList.toggle('sel', !!st.sel[id]); var cb = card.querySelector('input'); if (cb) cb.checked = !!st.sel[id];
      status();
    });
    grid.addEventListener('dblclick', function (e) { var card = e.target.closest('.org-card'); if (card && !e.target.closest('.org-acts')) preview(+card.dataset.id); });
    grid.addEventListener('keydown', function (e) {
      var card = e.target.closest('.org-card'); if (!card) return;
      if (e.key === 'Enter') { e.preventDefault(); preview(+card.dataset.id); }
      if (e.key === ' ') { e.preventDefault(); card.click(); }
    });
    $('orgAddPdf').addEventListener('click', function () { more.click(); });
    $('orgBlank').addEventListener('click', blank);
    $('orgRotL').addEventListener('click', function () { rotate(targets(), -90); });
    $('orgRotR').addEventListener('click', function () { rotate(targets(), 90); });
    $('orgReverse').addEventListener('click', reverse);
    if ($('orgInterleave')) $('orgInterleave').addEventListener('click', function () { interleaveMenu(this); });
    $('orgOriginal').addEventListener('click', original);
    $('orgUndo').addEventListener('click', undo);
    $('orgRedo').addEventListener('click', redo);
    $('orgSelAll').addEventListener('click', function () { selectAll(Object.keys(st.sel).length !== st.pages.length); });
    $('orgZoomIn').addEventListener('click', function () { setZoom(st.zoom + 0.2); });
    $('orgZoomOut').addEventListener('click', function () { setZoom(st.zoom - 0.2); });
    $('orgSelDel').addEventListener('click', function () { del(st.pages.filter(function (p) { return st.sel[p.id]; })); });
    $('orgSelDup').addEventListener('click', function () { dup(st.pages.filter(function (p) { return st.sel[p.id]; })); });
    $('orgSelStart').addEventListener('click', function () { move(false); });
    $('orgSelEnd').addEventListener('click', function () { move(true); });
    $('orgSelNone').addEventListener('click', function () { selectAll(false); });
    $('orgSave').addEventListener('click', function () { save(false); });
    $('orgSaveSel').addEventListener('click', function () { save(true); });
    $('orgNew').addEventListener('click', clearAll);
    $('orgViewClose').addEventListener('click', function () { $('orgView').hidden = true; });
    $('orgViewPrev').addEventListener('click', function () { step(-1); });
    $('orgViewNext').addEventListener('click', function () { step(1); });
    $('orgView').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
    document.addEventListener('keydown', function (e) {
      if ($('orgEditor').hidden) return;
      var t = e.target, typing = t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!$('orgView').hidden) { if (e.key === 'Escape') $('orgView').hidden = true; if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); return; }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && Object.keys(st.sel).length) { e.preventDefault(); del(st.pages.filter(function (p) { return st.sel[p.id]; })); }
      else if (e.key === 'Escape' && Object.keys(st.sel).length) selectAll(false);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.OrgTool = { _st: st, addFiles: addFiles, save: save, build: build, interleave: interleave };
})();
