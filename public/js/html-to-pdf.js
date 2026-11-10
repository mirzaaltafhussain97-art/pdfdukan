/* PDFdukan HTML to PDF — runs fully in the browser (html2canvas + jsPDF). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SIZES = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420], a5: [148, 210] };
  var KEY = 'pd-html2pdf-v1';
  var S = { size: 'a4', orient: 'portrait', margin: '12', width: 'fit' };
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  var MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', css: 'text/css', html: 'text/html', htm: 'text/html' };
  var st = { mode: 'paste', docs: [], cur: -1, blobs: [], L: null, busy: false, seq: 0 };
  var frame, timer;

  /* ---------- geometry ---------- */
  function geom() {
    var s = SIZES[S.size] || SIZES.a4, land = S.orient === 'landscape';
    var pw = land ? Math.max(s[0], s[1]) : Math.min(s[0], s[1]), ph = land ? Math.min(s[0], s[1]) : Math.max(s[0], s[1]);
    var m = +S.margin || 0, wmm = pw - 2 * m, hmm = ph - 2 * m;
    var lw = S.width === 'fit' ? Math.round(wmm * 96 / 25.4) : +S.width;
    var k = wmm / lw;
    return { pw: pw, ph: ph, m: m, wmm: wmm, hmm: hmm, lw: lw, k: k, pageH: hmm / k };
  }

  /* ---------- assets ---------- */
  function ext(p) { var m = /\.([a-z0-9]+)$/i.exec(p || ''); return m ? m[1].toLowerCase() : ''; }
  function norm(p) { var out = []; p.split('/').forEach(function (s) { if (!s || s === '.') return; if (s === '..') out.pop(); else out.push(s); }); return out.join('/'); }
  function dirOf(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function makeAssets(items) {
    var A = { byPath: new Map(), byName: new Map(), list: items };
    items.forEach(function (it) { A.byPath.set(norm(it.path).toLowerCase(), it); var n = it.path.split('/').pop().toLowerCase(); if (!A.byName.has(n)) A.byName.set(n, it); });
    return A;
  }
  function resolve(ref, dir, A) {
    if (!ref || !A) return null; ref = ref.trim();
    if (/^(data:|blob:|[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
    var p = ref.split(/[?#]/)[0]; if (!p) return null;
    try { p = decodeURIComponent(p); } catch (e) {}
    var key = (p.charAt(0) === '/' ? norm(p) : norm((dir ? dir + '/' : '') + p)).toLowerCase();
    return A.byPath.get(key) || A.byName.get(p.split('/').pop().toLowerCase()) || null;
  }
  function blobUrl(it) {
    if (!it._u) { var b = it.blob; if (!b.type && MIME[ext(it.path)]) b = new Blob([b], { type: MIME[ext(it.path)] }); it._u = URL.createObjectURL(b); st.blobs.push(it._u); }
    return it._u;
  }
  var URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, IMP_RE = /@import\s+(['"])([^'"]+)\1/g;
  async function cssText(t, dir, A, depth) {
    var refs = [], map = {};
    t.replace(URL_RE, function (m, q, r) { refs.push(r); return m; });
    t.replace(IMP_RE, function (m, q, r) { refs.push(r); return m; });
    for (var i = 0; i < refs.length; i++) {
      var it = resolve(refs[i], dir, A); if (!it) continue;
      map[refs[i]] = ext(it.path) === 'css' ? (depth < 6 ? await cssUrl(it, A, depth + 1) : null) : blobUrl(it);
    }
    return t.replace(URL_RE, function (m, q, r) { return map[r] ? 'url("' + map[r] + '")' : m; })
            .replace(IMP_RE, function (m, q, r) { return map[r] ? '@import "' + map[r] + '"' : m; });
  }
  function cssUrl(it, A, depth) {
    if (!it._c) it._c = it.blob.text().then(function (t) { return cssText(t, dirOf(it.path), A, depth || 0); })
      .then(function (t) { var u = URL.createObjectURL(new Blob([t], { type: 'text/css' })); st.blobs.push(u); return u; });
    return it._c;
  }
  async function prep(src, o) {
    var d = new DOMParser().parseFromString(src, 'text/html'), A = o.assets, dir = o.dir || '';
    d.querySelectorAll('script,base,meta[http-equiv]').forEach(function (e) { e.remove(); });
    if (o.base) { var b = d.createElement('base'); b.href = o.base; d.head.insertBefore(b, d.head.firstChild); }
    if (A) {
      var els = d.querySelectorAll('[src],[href],[poster],[srcset],[style],object[data]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i], it;
        ['src', 'poster', 'data'].forEach(function (a) { var v = el.getAttribute(a); if (v && (it = resolve(v, dir, A))) el.setAttribute(a, blobUrl(it)); });
        var h = el.getAttribute('href');
        if (h && el.tagName !== 'A' && (it = resolve(h, dir, A))) el.setAttribute('href', ext(it.path) === 'css' ? await cssUrl(it, A) : blobUrl(it));
        if (el.tagName === 'image' || el.tagName === 'use') { var x = el.getAttribute('xlink:href'); if (x && (it = resolve(x, dir, A))) el.setAttribute('xlink:href', blobUrl(it)); }
        var ss = el.getAttribute('srcset');
        if (ss) el.setAttribute('srcset', ss.split(',').map(function (part) { var bits = part.trim().split(/\s+/), r = resolve(bits[0], dir, A); if (r) bits[0] = blobUrl(r); return bits.join(' '); }).join(', '));
        var sty = el.getAttribute('style'); if (sty && /url\(/i.test(sty)) el.setAttribute('style', await cssText(sty, dir, A, 0));
      }
      var styles = d.querySelectorAll('style');
      for (var j = 0; j < styles.length; j++) styles[j].textContent = await cssText(styles[j].textContent, dir, A, 0);
    }
    var fix = d.createElement('style');
    fix.textContent = 'html{-webkit-print-color-adjust:exact;print-color-adjust:exact}';
    d.head.appendChild(fix);
    return { html: '<!DOCTYPE html>\n' + d.documentElement.outerHTML, title: (d.title || '').trim() };
  }
  function safeName(s) { return (s || '').replace(/\.(x?html?)$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'webpage'; }

  /* ---------- sources ---------- */
  async function fromPaste() {
    var code = $('hpCode').value;
    if (!code.trim()) { st.docs = []; hideOut(); return; }
    var r = await prep(code, {});
    st.docs = [{ name: safeName(r.title || 'html-to-pdf'), html: r.html }];
    show(0);
  }
  async function readEntry(entry, path, out) {
    if (entry.isFile) { var f = await new Promise(function (res, rej) { entry.file(res, rej); }); out.push({ path: path + f.name, blob: f }); return; }
    if (!entry.isDirectory) return;
    var rd = entry.createReader(), batch;
    do { batch = await new Promise(function (res, rej) { rd.readEntries(res, rej); }); for (var i = 0; i < batch.length; i++) await readEntry(batch[i], path + entry.name + '/', out); } while (batch.length);
  }
  async function addItems(items) {
    var all = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (ext(it.path) === 'zip' && window.JSZip) {
        try {
          var z = await JSZip.loadAsync(it.blob), names = Object.keys(z.files);
          for (var j = 0; j < names.length; j++) { var e = z.files[names[j]]; if (e.dir || /(^|\/)(__MACOSX|\.)/.test(names[j])) continue; var b = await e.async('blob'); all.push({ path: names[j], blob: MIME[ext(names[j])] ? new Blob([b], { type: MIME[ext(names[j])] }) : b }); }
        } catch (er) { info('Could not open ' + it.path + ' — is it a valid ZIP?', true); }
      } else all.push(it);
    }
    revoke();
    var A = makeAssets(all), htmls = all.filter(function (x) { return /^(html?|xhtml)$/.test(ext(x.path)); });
    if (!htmls.length) { info('No .html file found. Add the HTML page itself, not only its CSS or images.', true); return; }
    htmls.sort(function (a, b) { return /(^|\/)index\.html?$/i.test(b.path) - /(^|\/)index\.html?$/i.test(a.path) || a.path.localeCompare(b.path); });
    var docs = [];
    for (var k = 0; k < htmls.length; k++) {
      var src = await htmls[k].blob.text();
      var r = await prep(src, { assets: A, dir: dirOf(htmls[k].path) });
      docs.push({ name: safeName(htmls[k].path.split('/').pop()), html: r.html, path: htmls[k].path });
    }
    st.docs = docs;
    var list = $('hpFiles'); list.innerHTML = ''; list.hidden = false;
    docs.forEach(function (d, i) { var li = document.createElement('li'); li.className = 'hp-html'; li.textContent = d.path; li.title = 'Preview ' + d.path; li.tabIndex = 0; li.onclick = li.onkeydown = function (ev) { if (ev.type === 'keydown' && ev.key !== 'Enter') return; show(i); }; list.appendChild(li); });
    var extra = all.length - htmls.length;
    if (extra) { var li2 = document.createElement('li'); li2.textContent = '+ ' + extra + ' asset file' + (extra > 1 ? 's' : '') + ' (CSS, images, fonts)'; list.appendChild(li2); }
    $('hpAll').hidden = docs.length < 2;
    show(0);
  }
  function filesToItems(files) { return Array.prototype.map.call(files, function (f) { return { path: f.webkitRelativePath || f.name, blob: f }; }); }
  async function fromUrl(u) {
    u = u.trim(); if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    var msg = $('hpUrlMsg'); msg.className = 'hp-note'; msg.textContent = 'Loading ' + u + ' …';
    try {
      var r = await fetch(u, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!r.ok) throw new Error('The site answered with error ' + r.status + '.');
      var t = await r.text();
      if (!/<(html|body|div|p|h1|table)[\s>]/i.test(t)) throw new Error('That address did not return a web page.');
      var p = await prep(t, { base: r.url || u });
      st.docs = [{ name: safeName(p.title || new URL(r.url || u).hostname), html: p.html }];
      msg.textContent = 'Page loaded. Pictures from other servers only appear if that server allows it.';
      show(0);
    } catch (e) {
      msg.className = 'hp-note hp-warn';
      msg.innerHTML = '<b>This website does not let other sites read its pages</b>, so it can’t be loaded from your browser. Two quick ways around it:<ol><li>Open the page, press <b>Ctrl+S</b> (Mac: Cmd+S), save as “Webpage, Complete”, then upload the .html file and its folder in the <b>Upload HTML file</b> tab.</li><li>Or open the page, press <b>Ctrl+P</b> and pick “Save as PDF”.</li></ol>';
    }
  }

  /* ---------- preview & layout ---------- */
  function revoke() { st.blobs.forEach(function (u) { URL.revokeObjectURL(u); }); st.blobs = []; }
  function hideOut() { $('hpOut').hidden = true; st.cur = -1; st.L = null; }
  function show(i) {
    var d = st.docs[i]; if (!d) return;
    st.cur = i; var my = ++st.seq;
    $('hpOut').hidden = false;
    $('hpName').textContent = d.name + '.pdf';
    $('hpPages').textContent = 'Preparing preview…';
    document.querySelectorAll('#hpFiles li.hp-html').forEach(function (li, k) { li.classList.toggle('hp-on', k === i); });
    var g = geom();
    frame.style.width = g.lw + 'px'; frame.style.height = Math.round(g.pageH) + 'px';
    frame.onload = function () { if (my === st.seq) settle(my); };
    frame.srcdoc = d.html;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function frames(n) { return new Promise(function (r) { (function f() { if (n-- <= 0) r(); else requestAnimationFrame(f); })(); }); }
  async function settle(my) {
    var doc = frame.contentDocument; if (!doc) return;
    var imgs = Array.prototype.filter.call(doc.images, function (im) { return !im.complete; });
    await Promise.race([Promise.all(imgs.map(function (im) { return new Promise(function (r) { im.addEventListener('load', r); im.addEventListener('error', r); }); })), wait(8000)]);
    if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, wait(4000)]);
    if (my !== st.seq) return;
    await relayout(my);
  }
  async function relayout(my) {
    var doc = frame.contentDocument; if (!doc || !doc.documentElement) return;
    var g = geom();
    frame.style.width = g.lw + 'px'; frame.style.height = Math.round(g.pageH) + 'px';
    await frames(2);
    var h = docHeight(doc); frame.style.height = h + 'px';
    await frames(2);
    h = Math.max(1, docHeight(doc)); frame.style.height = h + 'px';
    if (my !== undefined && my !== st.seq) return;
    var C = collect(doc);
    st.L = { g: g, docH: h, cuts: cutsFor(C, g, h), links: C.links };
    drawPreview();
  }
  function docHeight(doc) { var de = doc.documentElement, b = doc.body; return Math.ceil(Math.max(de.scrollHeight, b ? b.scrollHeight : 0, de.getBoundingClientRect().height)); }
  function drawPreview() {
    var L = st.L; if (!L) return;
    var box = $('hpPrev'), stage = $('hpStage'), avail = Math.max(200, box.clientWidth - 22);
    var s = Math.min(1, avail / L.g.lw);
    frame.style.transform = 'scale(' + s + ')';
    stage.style.width = Math.round(L.g.lw * s) + 'px'; stage.style.height = Math.round(L.docH * s) + 'px';
    var cuts = $('hpCuts'); cuts.innerHTML = '';
    for (var i = 1; i < L.cuts.length - 1; i++) { var c = document.createElement('div'); c.className = 'hp-cut'; c.style.top = (L.cuts[i] * s) + 'px'; c.innerHTML = '<span>Page ' + (i + 1) + '</span>'; cuts.appendChild(c); }
    var n = L.cuts.length - 1, sz = S.size === 'letter' || S.size === 'legal' ? S.size.charAt(0).toUpperCase() + S.size.slice(1) : S.size.toUpperCase();
    $('hpPages').textContent = n + ' page' + (n > 1 ? 's' : '') + ' · ' + sz + ' ' + S.orient;
  }

  /* collect line boxes, blocks to keep whole, forced breaks and links (layout px) */
  function collect(doc) {
    var W = doc.defaultView, sy = W.scrollY || 0, avoid = [], forced = [], heads = [], links = [];
    var root = doc.body || doc.documentElement, rg = doc.createRange(), tw = doc.createTreeWalker(root, 4), n, cnt = 0;
    while ((n = tw.nextNode()) && cnt < 80000) {
      if (!/\S/.test(n.nodeValue)) continue;
      rg.selectNodeContents(n); var rs = rg.getClientRects();
      for (var i = 0; i < rs.length; i++) if (rs[i].height > 0) { avoid.push([rs[i].top + sy, rs[i].bottom + sy, 0.9]); cnt++; }
    }
    var LIM = { IMG: .95, SVG: .95, CANVAS: .95, VIDEO: .95, PICTURE: .95, IFRAME: .95, OBJECT: .95, EMBED: .95, INPUT: .95, TEXTAREA: .5, SELECT: .95, BUTTON: .95, TR: .5, LI: .3, FIGURE: .6, PRE: .3, BLOCKQUOTE: .3 };
    var all = root.getElementsByTagName('*'), checkStyle = all.length < 12000;
    for (var j = 0; j < all.length; j++) {
      var e = all[j], tag = e.tagName.toUpperCase(), lim = LIM[tag], cs = null;
      if (checkStyle) {
        cs = W.getComputedStyle(e);
        if (/page|always|left|right/.test(cs.breakBefore + cs.pageBreakBefore)) { var r0 = e.getBoundingClientRect(); forced.push(r0.top + sy); }
        if (/page|always|left|right/.test(cs.breakAfter + cs.pageBreakAfter)) { var r1 = e.getBoundingClientRect(); forced.push(r1.bottom + sy); }
        if (/avoid/.test(cs.breakInside + cs.pageBreakInside)) lim = .95;
      }
      if (lim) { var r = e.getBoundingClientRect(); if (r.height > 0) avoid.push([r.top + sy, r.bottom + sy, lim]); }
      if (/^H[1-6]$/.test(tag)) { var rh = e.getBoundingClientRect(); if (rh.height > 0) heads.push([rh.top + sy, rh.bottom + sy]); }
    }
    var tables = [];
    doc.querySelectorAll('table').forEach(function (tb) {
      var th = tb.tHead; if (!th) return; var r = tb.getBoundingClientRect(), rh = th.getBoundingClientRect();
      if (rh.height > 0 && r.height > rh.height) tables.push({ top: r.top + sy, bottom: r.bottom + sy, hTop: rh.top + sy, hBot: rh.bottom + sy });
    });
    var hasBase = !!doc.querySelector('base[href]');
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var h = (a.getAttribute('href') || '').trim(), url = null, t = null;
      if (h.charAt(0) === '#' && h.length > 1) {
        var id = h.slice(1); try { id = decodeURIComponent(id); } catch (e) {}
        var el = doc.getElementById(id) || doc.getElementsByName(id)[0]; if (!el) return;
        t = el.getBoundingClientRect().top + sy;
      } else {
        if (!/^[a-z][a-z0-9+.-]*:/i.test(h) && !hasBase) return;
        try { var u = new URL(h, doc.baseURI); if (!/^(https?|mailto|tel):$/.test(u.protocol)) return; url = u.href; } catch (e) { return; }
      }
      var rs2 = a.getClientRects();
      for (var k = 0; k < rs2.length; k++) if (rs2[k].width > 0 && rs2[k].height > 0) links.push({ x: rs2[k].left, y: rs2[k].top + sy, w: rs2[k].width, h: rs2[k].height, url: url, t: t });
    });
    return { avoid: avoid, forced: forced, heads: heads, links: links, tables: tables };
  }
  function cutsFor(C, g, H) {
    var P0 = g.pageH, cuts = [0], reps = [], s = 0, guard = 0;
    var forced = C.forced.filter(function (y) { return y > 2 && y < H - 2; }).sort(function (a, b) { return a - b; });
    while (s < H - 1 && guard++ < 5000) {
      var rp = null;
      for (var tt = 0; tt < C.tables.length; tt++) { var T = C.tables[tt]; if (s > 1 && T.hBot <= s + 0.5 && T.bottom > s + 1 && (T.hBot - T.hTop) < P0 * 0.25) { rp = T; break; } }
      reps.push(rp);
      var P = rp ? P0 - (rp.hBot - rp.hTop) : P0;
      var ideal = s + P, cut, f = null;
      for (var i = 0; i < forced.length; i++) if (forced[i] > s + 1 && forced[i] <= ideal + 0.5) { f = forced[i]; break; }
      if (f !== null) cut = f;
      else if (ideal >= H - 1) cut = H;
      else {
        cut = ideal; var min = s + P * 0.3;
        for (var it = 0; it < 60; it++) {
          var nc = cut;
          for (var j = 0; j < C.avoid.length; j++) { var a = C.avoid[j]; if (a[0] < nc - 0.5 && a[1] > nc + 0.5 && (a[1] - a[0]) <= P * a[2] && a[0] > min) nc = Math.min(nc, a[0]); }
          if (nc === cut) break; cut = nc;
        }
        for (var h = 0; h < C.heads.length; h++) { var hd = C.heads[h]; if (hd[0] > Math.max(min, cut - P * 0.12) && hd[1] <= cut + 0.5) cut = Math.min(cut, hd[0]); }
        // centre the cut in the gap between lines so descenders and accents don't spill over
        var pb = s, nt = H;
        for (var q = 0; q < C.avoid.length; q++) { var v = C.avoid[q]; if (v[1] <= cut + 0.5 && v[1] > pb) pb = v[1]; if (v[0] >= cut - 0.5 && v[0] < nt) nt = v[0]; }
        if (nt > pb && pb > s && nt < H) cut = Math.min(ideal, (pb + nt) / 2);
      }
      if (cut <= s + 1) cut = Math.min(H, s + P);
      cuts.push(cut); s = cut;
    }
    cuts.reps = reps;
    return cuts;
  }

  /* ---------- PDF ---------- */
  function hexOf(c) {
    var m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(c || '');
    if (!m || (m[4] !== undefined && +m[4] === 0)) return null;
    return '#' + [m[1], m[2], m[3]].map(function (v) { return (+v).toString(16).padStart(2, '0'); }).join('');
  }
  function pageBg(doc) { var W = doc.defaultView; return hexOf(W.getComputedStyle(doc.documentElement).backgroundColor) || (doc.body && hexOf(W.getComputedStyle(doc.body).backgroundColor)) || '#ffffff'; }
  async function buildPdf(onProg) {
    var doc = frame.contentDocument, L = st.L, g = L.g, cuts = L.cuts, n = cuts.length - 1;
    var scale = Math.max(1.5, Math.min(3, (180 / 25.4) * g.k)), bg = pageBg(doc), white = bg === '#ffffff';
    var orient = g.pw > g.ph ? 'l' : 'p', pdf = new window.jspdf.jsPDF({ orientation: orient, unit: 'mm', format: [g.pw, g.ph], compress: true });
    var MAXH = 14000, i = 0, hcache = new Map();
    async function headCanvas(T) {
      if (hcache.has(T)) return hcache.get(T);
      var hh = T.hBot - T.hTop, c = doc.createElement('canvas'); c.width = Math.floor(g.lw * scale); c.height = Math.max(1, Math.round(hh * scale));
      await window.html2canvas(doc.documentElement, { canvas: c, scale: scale, x: 0, y: T.hTop, width: g.lw, height: hh, windowWidth: g.lw, windowHeight: L.docH, scrollX: 0, scrollY: 0, useCORS: true, backgroundColor: bg, logging: false });
      hcache.set(T, c); return c;
    }
    while (i < n) {
      var j = i + 1; while (j < n && (cuts[j + 1] - cuts[i]) * scale <= MAXH) j++;
      var y0 = cuts[i], hh = cuts[j] - y0, cv = doc.createElement('canvas');
      cv.width = Math.floor(g.lw * scale); cv.height = Math.max(1, Math.floor(hh * scale));
      await window.html2canvas(doc.documentElement, { canvas: cv, scale: scale, x: 0, y: y0, width: g.lw, height: hh, windowWidth: g.lw, windowHeight: L.docH, scrollX: 0, scrollY: 0, useCORS: true, backgroundColor: bg, logging: false, imageTimeout: 10000 });
      for (var p = i; p < j; p++) {
        var a = Math.round((cuts[p] - y0) * scale), b = Math.min(cv.height, Math.round((cuts[p + 1] - y0) * scale)), ph = Math.max(1, b - a);
        var R = cuts.reps && cuts.reps[p], hc = R ? await headCanvas(R) : null, hp = hc ? hc.height : 0;
        var pc = document.createElement('canvas'); pc.width = cv.width; pc.height = ph + hp;
        var cx = pc.getContext('2d'); cx.fillStyle = bg; cx.fillRect(0, 0, pc.width, pc.height);
        if (hc) cx.drawImage(hc, 0, 0);
        cx.drawImage(cv, 0, a, cv.width, ph, 0, hp, pc.width, ph);
        if (p > 0) pdf.addPage([g.pw, g.ph], orient);
        if (!white) { pdf.setFillColor(bg); pdf.rect(0, 0, g.pw, g.ph, 'F'); }
        pdf.addImage(pc.toDataURL('image/jpeg', 0.85), 'JPEG', g.m, g.m, g.wmm, (cuts[p + 1] - cuts[p] + (R ? R.hBot - R.hTop : 0)) * g.k, 'pg' + p, 'FAST');
        pc.width = pc.height = 0;
        if (onProg) onProg(p + 1, n);
      }
      cv.width = cv.height = 0; i = j;
      await wait(0);
    }
    L.links.forEach(function (lk) {
      for (var p = 0; p < n; p++) {
        var top = Math.max(lk.y, cuts[p]), bot = Math.min(lk.y + lk.h, cuts[p + 1]); if (bot - top < 1) continue;
        var opt = lk.url ? { url: lk.url } : { pageNumber: pageOf(lk.t) + 1 };
        var off = cuts.reps && cuts.reps[p] ? cuts.reps[p].hBot - cuts.reps[p].hTop : 0;
        pdf.setPage(p + 1); pdf.link(g.m + lk.x * g.k, g.m + (top - cuts[p] + off) * g.k, lk.w * g.k, (bot - top) * g.k, opt);
      }
    });
    function pageOf(y) { for (var q = 0; q < n; q++) if (y < cuts[q + 1] - 0.5) return q; return n - 1; }
    var d = st.docs[st.cur];
    pdf.setProperties({ title: d ? d.name : 'webpage', creator: 'PDFdukan HTML to PDF', producer: 'PDFdukan.com' });
    return pdf.output('blob');
  }
  function libsReady() { return window.html2canvas && window.jspdf && window.jspdf.jsPDF; }
  function dl(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
  }
  function info(t, err) { var el = $('hpInfo'); el.textContent = t; el.className = 'hp-info' + (err ? ' hp-err' : ''); }
  function lock(on) { st.busy = on; ['hpGo', 'hpAll', 'hpPrint'].forEach(function (id) { $(id).disabled = on; }); }
  async function go() {
    if (st.busy || !st.L) return;
    if (!libsReady()) { info('Still loading the converter — try again in a second.', true); return; }
    lock(true); var t0 = Date.now();
    try {
      var blob = await buildPdf(function (p, n) { info('Making page ' + p + ' of ' + n + '…'); });
      var d = st.docs[st.cur]; dl(blob, d.name + '.pdf');
      info('Done: ' + (st.L.cuts.length - 1) + ' page PDF, ' + (blob.size / 1048576).toFixed(2) + ' MB, in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.');
      if (window.trackToolUse) trackToolUse('html-to-pdf');
    } catch (e) { console.error(e); info('Could not make the PDF: ' + (e && e.message || e) + '. Try “Print to PDF” instead.', true); }
    lock(false);
  }
  async function goAll() {
    if (st.busy || st.docs.length < 2 || !libsReady() || !window.JSZip) return;
    lock(true);
    try {
      var z = new JSZip(), used = {};
      for (var i = 0; i < st.docs.length; i++) {
        info('Converting file ' + (i + 1) + ' of ' + st.docs.length + '…');
        await new Promise(function (res) { var my; var d = st.docs[i]; st.cur = i; my = ++st.seq; var g = geom(); frame.style.width = g.lw + 'px'; frame.style.height = Math.round(g.pageH) + 'px'; frame.onload = function () { settle(my).then(res); }; frame.srcdoc = d.html; });
        var blob = await buildPdf(), nm = st.docs[i].name + '.pdf', k = 2;
        while (used[nm]) nm = st.docs[i].name + '-' + (k++) + '.pdf'; used[nm] = 1; z.file(nm, blob);
      }
      dl(await z.generateAsync({ type: 'blob' }), 'html-to-pdf.zip');
      info('Done: ' + st.docs.length + ' PDFs in one ZIP.');
      if (window.trackToolUse) trackToolUse('html-to-pdf');
    } catch (e) { console.error(e); info('Could not finish the ZIP: ' + (e && e.message || e), true); }
    lock(false); show(0);
  }
  function printIt() {
    var doc = frame.contentDocument; if (!doc || !doc.head) return;
    var g = geom(), s = doc.getElementById('pd-page');
    if (!s) { s = doc.createElement('style'); s.id = 'pd-page'; doc.head.appendChild(s); }
    s.textContent = '@page{size:' + g.pw + 'mm ' + g.ph + 'mm;margin:' + g.m + 'mm}';
    try { frame.contentWindow.focus(); frame.contentWindow.print(); info('In the print window, choose “Save as PDF” as the printer.'); }
    catch (e) { info('Your browser blocked printing from the preview. Download the PDF instead.', true); }
  }

  /* ---------- sample ---------- */
  var SAMPLE = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Invoice INV-1042</title>\n<style>\n body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:24px;font-size:14px}\n .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #ff6333;padding-bottom:14px}\n h1{margin:0;font-size:26px;color:#ff6333}\n .muted{color:#6b7280;font-size:12px}\n table{width:100%;border-collapse:collapse;margin-top:20px}\n th{background:#fff1ec;text-align:left;padding:9px;font-size:12px;text-transform:uppercase;color:#9a3412}\n td{padding:9px;border-bottom:1px solid #e5e7eb}\n td.n,th.n{text-align:right}\n .total{margin-top:14px;text-align:right;font-size:18px}\n .total b{color:#ff6333}\n .note{margin-top:28px;padding:12px;background:#f9fafb;border-left:4px solid #ff6333;font-size:13px}\n</style></head>\n<body>\n<div class="top"><div><h1>INVOICE</h1><div class="muted">INV-1042 · 10 November 2026</div></div><div style="text-align:right"><b>Your Company</b><br><span class="muted">12 Market Road<br>hello@yourcompany.com</span></div></div>\n<p><b>Bill to:</b> Client Name, 45 Park Avenue</p>\n<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>\n<tr><td>Website design</td><td class="n">1</td><td class="n">$450.00</td><td class="n">$450.00</td></tr>\n<tr><td>Hosting, 12 months</td><td class="n">1</td><td class="n">$96.00</td><td class="n">$96.00</td></tr>\n<tr><td>Logo revisions</td><td class="n">3</td><td class="n">$25.00</td><td class="n">$75.00</td></tr>\n</tbody></table>\n<div class="total">Total due: <b>$621.00</b></div>\n<div class="note">Thank you for your business. Pay within 14 days. Questions? <a href="mailto:hello@yourcompany.com">hello@yourcompany.com</a></div>\n</body></html>';

  /* ---------- init ---------- */
  function setMode(m) {
    st.mode = m;
    document.querySelectorAll('.hp-tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-m') === m)); });
    document.querySelectorAll('.hp-pane').forEach(function (p) { p.hidden = p.getAttribute('data-p') !== m; });
  }
  function init() {
    frame = $('hpFrame'); if (!frame) return;
    ['size', 'orient', 'margin', 'width'].forEach(function (k) {
      var el = $('hp' + k.charAt(0).toUpperCase() + k.slice(1)); el.value = S[k]; if (el.value !== String(S[k])) S[k] = el.value;
      el.addEventListener('change', function () { S[k] = el.value; save(); if (st.cur >= 0 && !st.busy) relayout(st.seq); });
    });
    document.querySelectorAll('.hp-tab').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-m')); }); });
    $('hpCode').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(fromPaste, 500); });
    $('hpSample').addEventListener('click', function () { $('hpCode').value = SAMPLE; fromPaste(); });
    var drop = $('hpDrop'), inp = $('hpFileInput'), dir = $('hpDirInput');
    drop.addEventListener('click', function () { inp.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    $('hpDirBtn').addEventListener('click', function () { dir.click(); });
    inp.addEventListener('change', function () { if (inp.files.length) addItems(filesToItems(inp.files)); inp.value = ''; });
    dir.addEventListener('change', function () { if (dir.files.length) addItems(filesToItems(dir.files)); dir.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('drag-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('drag-over'); }); });
    drop.addEventListener('drop', async function (e) {
      var dt = e.dataTransfer, out = [];
      var ents = dt.items ? Array.prototype.map.call(dt.items, function (it) { return it.webkitGetAsEntry && it.webkitGetAsEntry(); }).filter(Boolean) : [];
      if (ents.length) { for (var i = 0; i < ents.length; i++) await readEntry(ents[i], '', out); addItems(out); }
      else if (dt.files.length) addItems(filesToItems(dt.files));
    });
    $('hpUrlForm').addEventListener('submit', function (e) { e.preventDefault(); fromUrl($('hpUrl').value); });
    $('hpGo').addEventListener('click', go);
    $('hpAll').addEventListener('click', goAll);
    $('hpPrint').addEventListener('click', printIt);
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(drawPreview, 150); });
  }
  window.HtmlToPdf = { geom: geom, cutsFor: cutsFor, collect: collect, state: st, fromPaste: fromPaste, addItems: addItems, buildPdf: buildPdf, S: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
