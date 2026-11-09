/* PDFdukan — Compress PDF
 * Runs entirely in the browser (pdf-lib + pdf.js). Nothing is uploaded.
 *
 * Two modes:
 *  - "keep"   : keeps text, links, forms and bookmarks. Re-encodes the embedded
 *               photos/scans as smaller JPEGs and re-saves the file structure.
 *  - "image"  : turns every page into a JPEG image (strongest shrink, text is no
 *               longer selectable). Supports a target size in KB/MB.
 */
(function () {
  'use strict';

  var LEVELS = {
    keep:  { light: { dpi: 220, q: 0.85 }, balanced: { dpi: 150, q: 0.72 }, strong: { dpi: 110, q: 0.6 } },
    image: { light: { dpi: 180, q: 0.9 },  balanced: { dpi: 144, q: 0.8 },  strong: { dpi: 108, q: 0.68 } }
  };
  var MAX_FILE = 200 * 1024 * 1024;
  var MAX_PAGE_PIXELS = 20000000;

  var st = { file: null, bytes: null, mode: 'keep', level: 'balanced', targetKb: 0, out: null, outName: '', url: '', busy: false, scanned: false, pages: 0 };
  function $(id) { return document.getElementById(id); }
  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(msg, type) { if (window.toast) window.toast(msg, type); }
  function progress(pct, label) {
    $('cpProgress').hidden = false;
    $('cpProgressFill').style.width = Math.max(2, Math.min(100, pct)) + '%';
    $('cpProgressLabel').textContent = label;
  }

  /* ── File ───────────────────────────────────────────────── */
  async function setFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { say('Choose a PDF file.', 'error'); return; }
    if (!f.size) { say('This PDF file is empty.', 'error'); return; }
    if (f.size > MAX_FILE) { say('Choose a PDF up to 200 MB.', 'error'); return; }
    try { $('fileInput').value = ''; } catch (e) { /* ignore */ }
    st.file = f; st.out = null;
    st.bytes = new Uint8Array(await f.arrayBuffer());
    $('cpFileName').textContent = f.name;
    $('cpFileMeta').textContent = fmt(f.size) + ' · checking pages…';
    $('cpFile').hidden = false;
    $('cpSettings').hidden = false;
    $('cpResult').hidden = true;
    $('cpGo').disabled = false;
    resetButton();
    inspect();
  }

  /* Detects scanned PDFs (almost no text layer) so we can suggest the right mode. */
  async function inspect() {
    var hint = $('cpHint');
    hint.textContent = '';
    try {
      var doc = await window.pdfjsLib.getDocument({ data: st.bytes.slice() }).promise;
      st.pages = doc.numPages;
      var n = Math.min(doc.numPages, 5), chars = 0;
      for (var i = 1; i <= n; i++) {
        var tc = await (await doc.getPage(i)).getTextContent();
        tc.items.forEach(function (it) { chars += (it.str || '').trim().length; });
      }
      st.scanned = chars / n < 8;
      $('cpFileMeta').textContent = fmt(st.file.size) + ' · ' + doc.numPages + ' page' + (doc.numPages === 1 ? '' : 's') + (st.scanned ? ' · looks scanned' : ' · has text');
      hint.textContent = st.scanned
        ? 'This PDF looks scanned. "Keep text" shrinks the scanned pictures too. Need an exact limit, like 200 KB? Use "Pages as images" and set a max size.'
        : 'This PDF has real text. "Keep text" keeps it selectable and searchable.';
      doc.destroy();
    } catch (e) {
      var locked = /password|encrypt/i.test(String(e && (e.name + e.message)));
      $('cpFileMeta').textContent = fmt(st.file.size);
      if (locked) { hint.textContent = 'This PDF is password-protected. Open it with its password, save an unlocked copy, then add that copy.'; $('cpGo').disabled = true; }
      else hint.textContent = 'We could not read this PDF. It may be damaged.';
    }
  }

  /* ── Settings ───────────────────────────────────────────── */
  function setMode(m, auto) {
    st.mode = m;
    document.querySelectorAll('[data-cpmode]').forEach(function (b) {
      var on = b.dataset.cpmode === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    $('cpTargetWrap').hidden = m !== 'image';
    if (m !== 'image') { st.targetKb = 0; $('cpTargetKb').value = ''; markKb(); }
    levelNote();
    if (!auto) { $('cpResult').hidden = true; resetButton(); }
  }
  function setLevel(l) {
    st.level = l;
    document.querySelectorAll('[data-cplevel]').forEach(function (b) {
      var on = b.dataset.cplevel === l; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    levelNote(); $('cpResult').hidden = true; resetButton();
  }
  function levelNote() {
    var L = LEVELS[st.mode][st.level];
    var t = st.mode === 'keep'
      ? 'Photos inside the PDF are reduced to about ' + L.dpi + ' DPI at ' + Math.round(L.q * 100) + '% JPEG quality. Text, links and forms stay as they are.'
      : 'Each page becomes a ' + L.dpi + ' DPI image at ' + Math.round(L.q * 100) + '% JPEG quality. Text will no longer be selectable.';
    if (st.mode === 'image' && st.targetKb) t = 'We try sharper settings first and stop at the first result under ' + kbLabel(st.targetKb) + '.';
    $('cpLevelNote').textContent = t;
    document.querySelectorAll('[data-cplevel]').forEach(function (b) { b.disabled = st.mode === 'image' && st.targetKb > 0; });
  }
  function kbLabel(kb) { return kb >= 1024 ? (kb / 1024).toFixed(kb % 1024 ? 1 : 0) + ' MB' : kb + ' KB'; }
  function markKb() { document.querySelectorAll('[data-cpkb]').forEach(function (b) { b.classList.toggle('active', +b.dataset.cpkb === st.targetKb); }); }
  function resetButton() {
    var b = $('cpGo'); b.textContent = '📉 Compress PDF'; b.classList.add('btn-primary'); b.classList.remove('btn-secondary');
    $('cpProgress').hidden = true;
  }

  /* ── Mode 1: keep text (re-encode embedded images) ──────── */
  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no-inflate');
    var ds = new DecompressionStream('deflate');
    var out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function deflate(bytes) {
    var cs = new CompressionStream('deflate');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
  }
  function unPredict(data, w, colors, bpc, predictor) {
    if (!predictor || predictor < 10) return predictor && predictor > 1 ? null : data;
    var bpp = Math.max(1, (colors * bpc) >> 3), rowLen = (w * colors * bpc + 7) >> 3;
    var rows = Math.floor(data.length / (rowLen + 1)), out = new Uint8Array(rows * rowLen), prev = new Uint8Array(rowLen);
    for (var r = 0; r < rows; r++) {
      var ft = data[r * (rowLen + 1)], src = r * (rowLen + 1) + 1, cur = out.subarray(r * rowLen, (r + 1) * rowLen);
      for (var i = 0; i < rowLen; i++) {
        var x = data[src + i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, v;
        if (ft === 0) v = x; else if (ft === 1) v = x + a; else if (ft === 2) v = x + b;
        else if (ft === 3) v = x + ((a + b) >> 1);
        else if (ft === 4) { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        else return null;
        cur[i] = v & 255;
      }
      prev = cur;
    }
    return out;
  }
  function a85(src) {
    var out = [], tuple = 0, n = 0, i = 0, len = src.length;
    if (len >= 2 && src[0] === 60 && src[1] === 126) i = 2;          // optional <~
    for (; i < len; i++) {
      var c = src[i];
      if (c === 126) break;                                             // ~> end
      if (c <= 32) continue;
      if (c === 122 && n === 0) { out.push(0, 0, 0, 0); continue; }     // z
      if (c < 33 || c > 117) return null;
      tuple = tuple * 85 + (c - 33); n++;
      if (n === 5) { out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255); tuple = 0; n = 0; }
    }
    if (n) { for (var k = n; k < 5; k++) tuple = tuple * 85 + 84; for (var m = 0; m < n - 1; m++) out.push((tuple >>> (24 - m * 8)) & 255); }
    return new Uint8Array(out);
  }
  function canvasJpeg(canvas, q) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { if (!b) return rej(new Error('encode')); b.arrayBuffer().then(function (a) { res(new Uint8Array(a)); }); }, 'image/jpeg', q);
    });
  }

  async function keepText(L) {
    var P = window.PDFLib, N = P.PDFName;
    var doc = await P.PDFDocument.load(st.bytes.slice(), { updateMetadata: false });
    // Largest page size (points) → cap image pixels at the chosen DPI for that size.
    var maxW = 0, maxH = 0;
    doc.getPages().forEach(function (pg) { var s = pg.getSize(); maxW = Math.max(maxW, s.width); maxH = Math.max(maxH, s.height); });
    var capLong = Math.max(maxW, maxH) / 72 * L.dpi, capShort = Math.min(maxW, maxH) / 72 * L.dpi;

    var objs = doc.context.enumerateIndirectObjects().filter(function (e) {
      var o = e[1];
      return o instanceof P.PDFRawStream && o.dict.get(N.of('Subtype')) === N.of('Image');
    });
    // transparency masks must stay lossless: a JPEG mask breaks logo edges into black blocks
    var maskRefs = {};
    objs.forEach(function (e) { ['SMask', 'Mask'].forEach(function (k) { var m = e[1].dict.get(N.of(k)); if (m instanceof P.PDFRef) maskRefs[m.toString()] = 1; }); });
    var done = 0, changed = 0, saved = 0;
    for (var k = 0; k < objs.length; k++) {
      var ref = objs[k][0], obj = objs[k][1], d = obj.dict;
      if (maskRefs[ref.toString()]) { done++; continue; }
      // small see-through images (logos, icons) are left alone; only big ones are worth the risk
      if ((d.get(N.of('SMask')) || d.get(N.of('Mask'))) && obj.contents.length < 200 * 1024) { done++; continue; }
      progress(5 + Math.round(k / Math.max(1, objs.length) * 85), 'Optimizing image ' + (k + 1) + ' of ' + objs.length + '…');
      try {
        var r = await reencode(P, doc, d, obj.contents, L, capLong, capShort);
        if (r && r.length < obj.contents.length * 0.95) {
          var nd = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: r.w, Height: r.h, ColorSpace: r.gray ? 'DeviceGray' : 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' });
          var sm = d.get(N.of('SMask')); if (sm) nd.set(N.of('SMask'), sm);
          doc.context.assign(ref, P.PDFRawStream.of(nd, r.bytes));
          saved += obj.contents.length - r.bytes.length; changed++;
        }
      } catch (e) { /* leave this image as it is */ }
      done++;
    }
    // Re-pack the other compressed parts (page content, fonts) more tightly.
    if (typeof CompressionStream !== 'undefined') {
      var streams = doc.context.enumerateIndirectObjects().filter(function (e) { return e[1] instanceof P.PDFRawStream; });
      for (var t = 0; t < streams.length; t++) {
        var sref = streams[t][0], so = streams[t][1], sf = so.dict.lookup(N.of('Filter'));
        if (t % 25 === 0) progress(88 + Math.round(t / streams.length * 5), 'Re-packing file structure…');
        try {
          if (sf === N.of('FlateDecode')) {
            var re = await deflate(await inflate(so.contents));
            if (re.length < so.contents.length) { saved += so.contents.length - re.length; doc.context.assign(sref, P.PDFRawStream.of(so.dict, re)); }
          } else if (!sf && so.contents.length > 256 && so.dict.get(N.of('Subtype')) !== N.of('Image')) {
            var re2 = await deflate(so.contents);
            if (re2.length < so.contents.length * 0.9) { so.dict.set(N.of('Filter'), N.of('FlateDecode')); saved += so.contents.length - re2.length; doc.context.assign(sref, P.PDFRawStream.of(so.dict, re2)); }
          }
        } catch (e) { /* keep this part as it is */ }
      }
    }
    progress(95, 'Saving…');
    var out = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes: out, images: objs.length, changed: changed };
  }

  async function reencode(P, doc, d, raw, L, capLong, capShort) {
    var N = P.PDFName;
    if (d.get(N.of('ImageMask'))) return null;
    if (d.get(N.of('Decode'))) return null;
    var w = d.lookup(N.of('Width'), P.PDFNumber).asNumber(), h = d.lookup(N.of('Height'), P.PDFNumber).asNumber();
    if (w * h < 40000) return null;                 // tiny icons: not worth it
    var f = d.lookup(N.of('Filter')), filters = [];
    if (f instanceof P.PDFName) filters = [String(f)];
    else if (f instanceof P.PDFArray) for (var i = 0; i < f.size(); i++) filters.push(String(f.lookup(i)));
    if (filters[0] === '/ASCII85Decode' || filters[0] === '/A85') { raw = a85(raw); filters.shift(); if (!raw) return null; }
    var cs = d.lookup(N.of('ColorSpace')), comps = 0;
    if (cs === N.of('DeviceRGB')) comps = 3;
    else if (cs === N.of('DeviceGray')) comps = 1;
    else if (cs instanceof P.PDFArray && cs.lookup(0) === N.of('ICCBased')) {
      var icc = cs.lookup(1); var n = icc && icc.dict && icc.dict.lookup(N.of('N'), P.PDFNumber);
      comps = n ? n.asNumber() : 0;
    }
    if (comps !== 1 && comps !== 3) return null;     // CMYK, Indexed, Lab…: leave untouched

    var bitmap;
    if (filters.length === 1 && filters[0] === '/DCTDecode') {
      bitmap = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
    } else if (filters.length === 1 && filters[0] === '/FlateDecode') {
      var bpc = d.lookup(N.of('BitsPerComponent'), P.PDFNumber); if (!bpc || bpc.asNumber() !== 8) return null;
      var px = await inflate(raw);
      var parms = d.lookup(N.of('DecodeParms')), pred = 0;
      if (parms instanceof P.PDFDict) { var pp = parms.lookup(N.of('Predictor'), P.PDFNumber); pred = pp ? pp.asNumber() : 0; }
      px = unPredict(px, w, comps, 8, pred); if (!px || px.length < w * h * comps) return null;
      var rgba = new Uint8ClampedArray(w * h * 4);
      for (var j = 0, s = 0; j < w * h; j++) {
        if (comps === 3) { rgba[j * 4] = px[s]; rgba[j * 4 + 1] = px[s + 1]; rgba[j * 4 + 2] = px[s + 2]; s += 3; }
        else { rgba[j * 4] = rgba[j * 4 + 1] = rgba[j * 4 + 2] = px[s]; s += 1; }
        rgba[j * 4 + 3] = 255;
      }
      bitmap = await createImageBitmap(new ImageData(rgba, w, h));
    } else return null;

    var long = Math.max(w, h), short = Math.min(w, h);
    var scale = Math.min(1, capLong / long, capShort / short);
    var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
    var c = document.createElement('canvas'); c.width = tw; c.height = th;
    var x = c.getContext('2d', { alpha: false });
    x.fillStyle = '#fff'; x.fillRect(0, 0, tw, th);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(bitmap, 0, 0, tw, th);
    if (bitmap.close) bitmap.close();
    var bytes = await canvasJpeg(c, L.q);
    c.width = c.height = 0;
    return { bytes: bytes, w: tw, h: th, gray: comps === 1, length: bytes.length };
  }

  /* ── Mode 2: pages as images ────────────────────────────── */
  async function renderPages(pdf, dpi, onPage) {
    var list = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var vp1 = page.getViewport({ scale: 1 });
      var sc = Math.min(dpi / 72, Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, vp1.width * vp1.height)));
      var vp = page.getViewport({ scale: sc });
      var c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      var x = c.getContext('2d', { alpha: false }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      list.push({ canvas: c, w: vp1.width, h: vp1.height });
      page.cleanup();
      onPage(i, pdf.numPages);
    }
    return list;
  }
  async function buildFromJpegs(pages, jpegs) {
    var P = window.PDFLib, doc = await P.PDFDocument.create();
    doc.setProducer('PDFdukan Compress PDF');
    for (var i = 0; i < pages.length; i++) {
      var img = await doc.embedJpg(jpegs[i]);
      doc.addPage([pages[i].w, pages[i].h]).drawImage(img, { x: 0, y: 0, width: pages[i].w, height: pages[i].h });
    }
    return doc.save();
  }
  async function encodeAll(pages, q) {
    var out = [];
    for (var i = 0; i < pages.length; i++) out.push(await canvasJpeg(pages[i].canvas, q));
    return out;
  }

  function sumSize(jp, pgs) { return jp.reduce(function (a, b) { return a + b.length; }, 0) + 600 * pgs.length + 1200; }
  async function asImages(L) {
    var pdf = await window.pdfjsLib.getDocument({ data: st.bytes.slice() }).promise;
    try {
      if (!st.targetKb) {
        var pages = await renderPages(pdf, L.dpi, function (i, n) { progress(5 + Math.round(i / n * 80), 'Rendering page ' + i + ' of ' + n + '…'); });
        progress(88, 'Saving…');
        var bytes = await buildFromJpegs(pages, await encodeAll(pages, L.q));
        pages.forEach(function (p) { p.canvas.width = p.canvas.height = 0; });
        return { bytes: bytes, dpi: L.dpi, q: L.q, met: true };
      }
      var target = st.targetKb * 1024, best = null;
      var steps = [180, 144, 110, 90, 72, 60];
      for (var pass = 0; pass < 2 && !(best && best.met); pass++) {
        var floor = pass === 0 ? 0.5 : 0.25, list = pass === 0 ? steps : [steps[steps.length - 1]];
        for (var s = 0; s < list.length; s++) {
          var dpi = list[s];
          var pgs = await renderPages(pdf, dpi, function (i, n) { progress(5 + Math.round(((pass ? steps.length : s) + i / n) / (steps.length + 1) * 85), 'Trying ' + dpi + ' DPI · page ' + i + ' of ' + n + '…'); });
          var found = null, top = await encodeAll(pgs, 0.9);
          if (sumSize(top, pgs) <= target) found = { q: 0.9, jp: top };
          else {
            var lo = floor, hi = 0.9, low = await encodeAll(pgs, floor);
            if (sumSize(low, pgs) <= target) {
              found = { q: floor, jp: low };
              for (var it = 0; it < 4; it++) {
                var mid = (lo + hi) / 2, jp = await encodeAll(pgs, mid);
                if (sumSize(jp, pgs) <= target) { found = { q: mid, jp: jp }; lo = mid; } else hi = mid;
              }
            }
          }
          var jpUse = found ? found.jp : (pass === 1 ? low : null);
          if (jpUse) {
            var b2 = await buildFromJpegs(pgs, jpUse);
            var cand = { bytes: b2, dpi: dpi, q: found ? found.q : floor, met: b2.length <= target };
            if (!best || cand.met || b2.length < best.bytes.length) best = cand;
          }
          pgs.forEach(function (p) { p.canvas.width = p.canvas.height = 0; });
          if (best && best.met) break;
        }
      }
      return best;
    } finally { pdf.destroy(); }
  }

  /* ── Run ────────────────────────────────────────────────── */
  async function run() {
    if (!st.bytes || st.busy) return;
    st.busy = true;
    var btn = $('cpGo'); btn.disabled = true; btn.textContent = '⏳ Compressing…';
    $('cpResult').hidden = true;
    var L = LEVELS[st.mode][st.level];
    try {
      progress(3, 'Reading PDF…');
      var r = st.mode === 'keep' ? await keepText(L) : await asImages(L);
      var orig = st.bytes.length, out = r.bytes, kept = false;
      if (out.length >= orig) { out = st.bytes; kept = true; }
      st.out = out;
      var pct = Math.round((1 - out.length / orig) * 100);
      $('cpOrig').textContent = fmt(orig);
      $('cpNew').textContent = fmt(out.length);
      var pill = $('cpSaved');
      pill.textContent = kept ? 'No smaller version' : pct + '% smaller';
      pill.classList.toggle('worse', kept);
      var note = '', warn = '';
      if (kept) {
        note = 'Your file is kept as it is, because the compressed version was not smaller.';
        warn = st.mode === 'keep'
          ? (r.images ? 'The images in this PDF are already small. Try Strong, or "Pages as images" if text does not need to stay selectable.' : 'This PDF has no photos to shrink, only text and drawings, which are already compact. "Pages as images" will not help much either.')
          : 'This PDF is already well compressed.';
      } else if (st.mode === 'keep') {
        note = 'Text, links, form fields and bookmarks were kept. ' + (r.changed
          ? r.changed + ' image' + (r.changed === 1 ? ' was' : 's were') + ' made smaller.'
          : 'There were no large photos to shrink, so the text and drawings were packed more tightly.');
      } else {
        note = 'Pages saved as ' + r.dpi + ' DPI images at ' + Math.round(r.q * 100) + '% quality. Text is no longer selectable.';
        if (!r.met) warn = 'Could not get under ' + kbLabel(st.targetKb) + '. This is the smallest readable result. Remove pages you do not need with Extract PDF Pages, or set a larger limit.';
        else if (r.q < 0.45 || r.dpi < 90) warn = 'To fit ' + kbLabel(st.targetKb) + ', quality is low. Check that small text is still readable.';
      }
      $('cpNote').textContent = note;
      $('cpWarn').textContent = warn; $('cpWarn').hidden = !warn;
      st.outName = st.file.name.replace(/\.pdf$/i, '') + (kept ? '.pdf' : '-compressed.pdf');
      $('cpDownloadLabel').textContent = 'Download PDF (' + fmt(out.length) + ')';
      $('cpResult').hidden = false;
      progress(100, 'Done');
      btn.textContent = '🔁 Compress again'; btn.classList.remove('btn-primary'); btn.classList.add('btn-secondary');
      setTimeout(function () { $('cpResult').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      if (window.CMLogs) window.CMLogs.log({ tool: 'Compress PDF', action: st.mode, input: st.file.name, size: out.length });
    } catch (e) {
      console.error(e);
      var locked = /password|encrypt/i.test(String(e && (e.name + ' ' + e.message)));
      say(locked ? 'This PDF is password-protected. Save an unlocked copy first.' : 'This PDF could not be compressed: ' + (e && e.message ? e.message : 'unknown error'), 'error');
      resetButton();
    } finally {
      st.busy = false; btn.disabled = false;
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
    };
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(st.outName).then(save); else save(st.outName);
  }

  function clear() {
    st.file = null; st.bytes = null; st.out = null;
    $('cpFile').hidden = true; $('cpSettings').hidden = true; $('cpResult').hidden = true; $('cpProgress').hidden = true;
    $('cpGo').disabled = true; resetButton();
  }

  /* ── Wire up ────────────────────────────────────────────── */
  function init() {
    if (!$('cpGo')) return;
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc)
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('dropZone'), input = $('fileInput');
    dz.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', function () { if (input.files[0]) setFile(input.files[0]); });
    document.querySelectorAll('[data-cpmode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.cpmode); }); });
    document.querySelectorAll('[data-cplevel]').forEach(function (b) { b.addEventListener('click', function () { setLevel(b.dataset.cplevel); }); });
    document.querySelectorAll('[data-cpkb]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.targetKb = st.targetKb === +b.dataset.cpkb ? 0 : +b.dataset.cpkb;
        $('cpTargetKb').value = st.targetKb || ''; markKb(); levelNote(); $('cpResult').hidden = true; resetButton();
      });
    });
    $('cpTargetKb').addEventListener('input', function () { st.targetKb = Math.max(0, Math.round(+this.value || 0)); markKb(); levelNote(); $('cpResult').hidden = true; resetButton(); });
    $('cpGo').addEventListener('click', run);
    $('cpDownload').addEventListener('click', download);
    $('cpRemove').addEventListener('click', clear);
    $('cpChange').addEventListener('click', function () { input.click(); });
    levelNote();
  }
  window.CompressPdfTool = { setFile: setFile, run: run, _st: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
