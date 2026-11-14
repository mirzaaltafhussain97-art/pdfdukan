/* PDFdukan Label Crop — crops shipping labels out of A4 label PDFs (Flipkart, Meesho, Amazon …)
   and lays them out on 4x6 / 4x4 / A6 / A4-4-up pages. Vector crop: barcodes stay sharp.
   Everything runs in the browser. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var PT = 72;
  var SIZES = {
    '4x6': { w: 4 * PT, h: 6 * PT, name: '4 × 6 in (100 × 150 mm)' },
    '4x4': { w: 4 * PT, h: 4 * PT, name: '4 × 4 in (100 × 100 mm)' },
    '3x5': { w: 3 * PT, h: 5 * PT, name: '3 × 5 in' },
    'a6': { w: 297.64, h: 419.53, name: 'A6 (105 × 148 mm)' },
    'a4x4': { w: 595.28, h: 841.89, name: 'A4, 4 labels per sheet', grid: [2, 2] },
    'a4x2': { w: 595.28, h: 841.89, name: 'A4, 2 labels per sheet', grid: [1, 2] },
    'orig': { name: 'Original label size' }
  };
  var COURIERS = ['Ekart', 'Delhivery', 'Xpressbees', 'XpressBees', 'Shadowfax', 'Ecom Express', 'Valmo', 'DTDC', 'Blue Dart', 'BlueDart',
    'Amazon Shipping', 'Amazon Transportation', 'ATS', 'India Post', 'Speed Post', 'Shiprocket', 'Smartr', 'Gati', 'Professional Couriers',
    'TCS', 'Leopards', 'M&P', 'PostEx', 'Trax', 'Rider', 'Call Courier', 'BlueEx', 'Pakistan Post',
    'UPS', 'FedEx', 'DHL', 'USPS', 'Royal Mail', 'Evri', 'DPD', 'PostNL', 'GLS', 'Canada Post', 'Australia Post', 'Aramex', 'J&T', 'Ninja Van'];

  var st = { files: [], pages: [], out: null, outInv: null, base: 'labels', manual: null, cur: 0, busy: false, editing: false };

  function opt(name) { var el = document.querySelector('[data-lc-' + name + '].active'); return el ? el.getAttribute('data-lc-' + name) : null; }
  function say(msg, kind) { var n = $('lcMsg'); if (!n) return; n.textContent = msg || ''; n.className = 'lc-msg' + (kind ? ' ' + kind : ''); n.hidden = !msg; }
  function fmtB(b) { return b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }
  function cleanBase(n) { var b = n.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); return (b || 'labels').slice(0, 70); }
  function loader(on, msg, sub) { if (on) { if (window.showBrandLoader) showBrandLoader(msg, sub); } else if (window.hideBrandLoader) hideBrandLoader(); }
  function sub(s) { var el = document.querySelector('#brandLoader .brand-loader-sub'); if (el) el.textContent = s; }

  /* ── Page analysis (render with pdf.js, find label blocks) ───────────────── */
  var DPI = 100, SC = DPI / 72;

  function inkMask(ctx, w, h) {
    var d = ctx.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h), lum = new Float64Array(256), i, j;
    // adaptive threshold: paper level = 90th percentile of luminance
    var hist = new Uint32Array(256);
    for (i = 0, j = 0; i < d.length; i += 4, j++) { var L = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; hist[L]++; m[j] = L; }
    var tot = w * h, acc = 0, paper = 255;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > tot * 0.35) { paper = i; break; } }
    var thr = Math.min(170, paper * 0.72);
    for (j = 0; j < m.length; j++) m[j] = m[j] < thr ? 1 : 0;
    return m;
  }

  // does a line end join a perpendicular stroke (i.e. it is part of a box, not a free cut line)?
  function endTouch(m, w, h, end, a, b, vert) {
    var r = 3, len = 0.1 * DPI | 0, hits = 0, tries = 0;
    for (var e = end - r; e <= end + r; e++) {
      for (var t = 1; t <= len; t++) {
        tries++;
        if (!vert) { var y1 = a - t - 1, y2 = b + t + 1; if (e >= 0 && e < w && ((y1 >= 0 && m[y1 * w + e]) || (y2 < h && m[y2 * w + e]))) hits++; }
        else { var x1 = a - t - 1, x2 = b + t + 1; if (e >= 0 && e < h && ((x1 >= 0 && m[e * w + x1]) || (x2 < w && m[e * w + x2]))) hits++; }
      }
    }
    return hits > len * 0.8;
  }

  // separator lines: thin, wide, isolated rows (solid or dashed). Removed from mask.
  function findSeparators(m, w, h) {
    var rowInk = new Uint32Array(h), rowMin = new Int32Array(h), rowMax = new Int32Array(h), y, x;
    for (y = 0; y < h; y++) {
      var c = 0, mn = -1, mx = -1, o = y * w;
      for (x = 0; x < w; x++) if (m[o + x]) { c++; if (mn < 0) mn = x; mx = x; }
      rowInk[y] = c; rowMin[y] = mn; rowMax[y] = mx;
    }
    var seps = [];
    for (y = 0; y < h; y++) {
      if (rowMax[y] - rowMin[y] < w * 0.5) continue;
      if (rowInk[y] < (rowMax[y] - rowMin[y]) * 0.3) continue;
      var y2 = y; while (y2 + 1 < h && rowMax[y2 + 1] - rowMin[y2 + 1] >= w * 0.5 && rowInk[y2 + 1] >= (rowMax[y2 + 1] - rowMin[y2 + 1]) * 0.3) y2++;
      if (y2 - y > 4) { y = y2; continue; } // too thick: a filled area, not a line
      var span = rowMax[y] - rowMin[y], quiet = true;
      for (var k = 2; k <= 5 && quiet; k++) {
        if (y - k >= 0 && rowInk[y - k] > span * 0.04) quiet = false;
        if (y2 + k < h && rowInk[y2 + k] > span * 0.04) quiet = false;
      }
      if (quiet && (endTouch(m, w, h, rowMin[y], y, y2, false) || endTouch(m, w, h, rowMax[y], y, y2, false))) quiet = false;
      if (quiet) {
        seps.push({ y: (y + y2) / 2, x0: rowMin[y], x1: rowMax[y] });
        for (var yy = y; yy <= y2; yy++) for (x = 0; x < w; x++) m[yy * w + x] = 0;
      }
      y = y2;
    }
    // vertical separators (cut lines between side-by-side labels)
    var colInk = new Uint32Array(w), colMin = new Int32Array(w).fill(-1), colMax = new Int32Array(w).fill(-1);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (m[y * w + x]) { colInk[x]++; if (colMin[x] < 0) colMin[x] = y; colMax[x] = y; }
    for (x = 0; x < w; x++) {
      if (colMax[x] - colMin[x] < h * 0.4 || colInk[x] < (colMax[x] - colMin[x]) * 0.3) continue;
      var x2 = x; while (x2 + 1 < w && colMax[x2 + 1] - colMin[x2 + 1] >= h * 0.4 && colInk[x2 + 1] >= (colMax[x2 + 1] - colMin[x2 + 1]) * 0.3) x2++;
      if (x2 - x > 4) { x = x2; continue; }
      var sp = colMax[x] - colMin[x], q = true;
      for (var kk = 2; kk <= 5 && q; kk++) {
        if (x - kk >= 0 && colInk[x - kk] > sp * 0.04) q = false;
        if (x2 + kk < w && colInk[x2 + kk] > sp * 0.04) q = false;
      }
      if (q && (endTouch(m, w, h, colMin[x], x, x2, true) || endTouch(m, w, h, colMax[x], x, x2, true))) q = false;
      if (q) { seps.push({ v: true, x: (x + x2) / 2, y0: colMin[x], y1: colMax[x] }); for (var xx = x; xx <= x2; xx++) for (y = 0; y < h; y++) m[y * w + xx] = 0; }
      x = x2;
    }
    return seps;
  }

  // barcode rows: windows with many transitions whose pattern repeats 0.12in lower
  function barcodeMap(m, w, h) {
    var win = 48, gap = Math.round(0.12 * DPI), nx = Math.ceil(w / win), bm = new Uint8Array(nx * h);
    for (var y = 0; y + gap < h; y++) {
      var o = y * w, o2 = (y + gap) * w;
      for (var bx = 0; bx < nx; bx++) {
        var x0 = bx * win, x1 = Math.min(w, x0 + win), t = 0, diff = 0, ink = 0;
        for (var x = x0 + 1; x < x1; x++) { if (m[o + x] !== m[o + x - 1]) t++; if (m[o + x] !== m[o2 + x]) diff++; ink += m[o + x]; }
        if (t >= 10 && ink > (x1 - x0) * 0.2 && diff <= (x1 - x0) * 0.12) bm[y * nx + bx] = 1;
      }
    }
    return { bm: bm, nx: nx, win: win };
  }

  function components(m, w, h, d) {
    // dilate with box radius d via integral image, then label components (4-neighbour)
    var I = new Uint32Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) { var rs = 0; for (x = 0; x < w; x++) { rs += m[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + rs; } }
    var D = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var ya = Math.max(0, y - d), yb = Math.min(h, y + d + 1);
      for (x = 0; x < w; x++) {
        var xa = Math.max(0, x - d), xb = Math.min(w, x + d + 1);
        if (I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa] > 0) D[y * w + x] = 1;
      }
    }
    var lab = new Int32Array(w * h), comps = [], stack = [];
    for (var s = 0; s < w * h; s++) {
      if (!D[s] || lab[s]) continue;
      var id = comps.length + 1, c = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, ink: 0 }; lab[s] = id; stack.push(s);
      while (stack.length) {
        var p = stack.pop(), py = (p / w) | 0, px = p - py * w;
        if (m[p]) { c.ink++; if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py; }
        if (px > 0 && D[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
        if (px < w - 1 && D[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
        if (py > 0 && D[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
        if (py < h - 1 && D[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); }
      }
      if (c.ink > 0) comps.push(c);
    }
    return comps;
  }

  function sepBetween(a, b, seps) {
    for (var i = 0; i < seps.length; i++) {
      var s = seps[i];
      if (!s.v) {
        var top = Math.min(a.y1, b.y1), bot = Math.max(a.y0, b.y0);
        if (s.y > top && s.y < bot && s.x0 < Math.max(a.x1, b.x1) && s.x1 > Math.min(a.x0, b.x0)) return true;
      } else {
        var l = Math.min(a.x1, b.x1), r = Math.max(a.x0, b.x0);
        if (s.x > l && s.x < r && s.y0 < Math.max(a.y1, b.y1) && s.y1 > Math.min(a.y0, b.y0)) return true;
      }
    }
    return false;
  }

  function mergeBlocks(bl, seps, g) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < bl.length && !changed; i++) for (var j = i + 1; j < bl.length && !changed; j++) {
        var a = bl[i], b = bl[j];
        var vg = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1), hg = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
        var close = (vg < g && hg < 0) || (hg < g && vg < 0) || (vg < 0 && hg < 0);
        if (close && !sepBetween(a, b, seps)) {
          bl[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), ink: a.ink + b.ink };
          bl.splice(j, 1); changed = true;
        }
      }
    }
    return bl;
  }

  function bcCount(B, b) {
    var n = 0, bx0 = Math.floor(b.x0 / B.win), bx1 = Math.floor(b.x1 / B.win);
    for (var y = b.y0; y <= b.y1; y++) for (var bx = bx0; bx <= bx1; bx++) n += B.bm[y * B.nx + bx];
    return n;
  }

  // split a block at a clear empty band if both halves hold barcodes (2-up / 4-up sheets)
  function splitBlock(m, w, B, b, minPx) {
    var best = null;
    function tryAxis(vert) {
      var a0 = vert ? b.x0 : b.y0, a1 = vert ? b.x1 : b.y1, run = 0, start = 0;
      for (var p = a0; p <= a1; p++) {
        var empty = true;
        if (vert) { for (var y = b.y0; y <= b.y1 && empty; y++) if (m[y * w + p]) empty = false; }
        else { for (var x = b.x0; x <= b.x1 && empty; x++) if (m[p * w + x]) empty = false; }
        if (empty) { if (!run) start = p; run++; } else {
          if (run >= 4) {
            var cut = start + run / 2 | 0;
            var A = vert ? { x0: b.x0, x1: start - 1, y0: b.y0, y1: b.y1 } : { x0: b.x0, x1: b.x1, y0: b.y0, y1: start - 1 };
            var C = vert ? { x0: p, x1: b.x1, y0: b.y0, y1: b.y1 } : { x0: b.x0, x1: b.x1, y0: p, y1: b.y1 };
            var szA = vert ? A.x1 - A.x0 : A.y1 - A.y0, szC = vert ? C.x1 - C.x0 : C.y1 - C.y0;
            if (szA >= minPx && szC >= minPx && bcCount(B, A) > 20 && bcCount(B, C) > 20) {
              var bal = Math.min(szA, szC) / Math.max(szA, szC);
              if (!best || bal > best.bal) best = { bal: bal, A: A, C: C, cut: cut };
            }
          }
          run = 0;
        }
      }
    }
    tryAxis(true); tryAxis(false);
    if (!best) return [b];
    return [tight(m, w, best.A), tight(m, w, best.C)].reduce(function (acc, x) { return acc.concat(splitBlock(m, w, B, x, minPx)); }, []);
  }
  function tight(m, w, b) {
    var r = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, ink: 0 };
    for (var y = b.y0; y <= b.y1; y++) for (var x = b.x0; x <= b.x1; x++) if (m[y * w + x]) { r.ink++; if (x < r.x0) r.x0 = x; if (x > r.x1) r.x1 = x; if (y < r.y0) r.y0 = y; if (y > r.y1) r.y1 = y; }
    return r.ink ? r : b;
  }

  async function analysePage(pdfPage) {
    var vp = pdfPage.getViewport({ scale: SC });
    var w = Math.ceil(vp.width), h = Math.ceil(vp.height);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
    var m = inkMask(ctx, w, h);
    var B = barcodeMap(m, w, h);           // before separator removal: barcodes are not separators anyway
    var seps = findSeparators(m, w, h);
    var comps = components(m, w, h, Math.round(0.06 * DPI)).filter(function (c) { return c.ink > 6; });
    var blocks = mergeBlocks(comps, seps, Math.round(0.2 * DPI));
    var minIn = 1.1 * DPI, labels = [], others = [];
    blocks.forEach(function (b) {
      var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (bw >= minIn && bh >= minIn * 0.9 && bcCount(B, b) > 20) labels = labels.concat(splitBlock(m, w, B, b, minIn));
      else others.push(b);
    });
    // text per block (for invoice / courier / SKU)
    var text = await pageText(pdfPage, vp);
    function txtIn(b) { return text.filter(function (t) { return t.x >= b.x0 - 4 && t.x <= b.x1 + 4 && t.y >= b.y0 - 4 && t.y <= b.y1 + 4; }).map(function (t) { return t.s; }).join(' '); }
    var invoiceRx = /\b(tax\s*invoice|invoice\s*(no|number|date)|bill\s*of\s*supply|retail\s*invoice)\b/i, shipRx = /\b(ship\s*to|deliver\s*to|customer\s*address|awb|tracking|consignee|return\s*address|if\s*undelivered)\b/i;
    var keep = [];
    labels.forEach(function (b) { b.text = txtIn(b); if (invoiceRx.test(b.text) && !shipRx.test(b.text)) others.push(b); else keep.push(b); });
    labels = keep;
    var fallback = false;
    if (!labels.length) {
      // no barcode found: take the biggest content block (user can adjust)
      var big = blocks.slice().sort(function (a, b) { return (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0); })[0];
      if (big) { big.text = txtIn(big); labels = [big]; others = others.filter(function (o) { return o !== big; }); fallback = true; }
    }
    labels.sort(function (a, b) { return Math.abs(a.y0 - b.y0) > 0.5 * DPI ? a.y0 - b.y0 : a.x0 - b.x0; });
    // invoice = everything below the lowest label (when the page holds one label)
    var inv = null;
    if (labels.length === 1) {
      var lb = labels[0];
      others.forEach(function (o) {
        if (o.y0 > lb.y1 - 2 || (o.text && invoiceRx.test(o.text))) {
          if ((o.x1 - o.x0) * (o.y1 - o.y0) < 0.15 * DPI * DPI) return;
          inv = inv ? { x0: Math.min(inv.x0, o.x0), y0: Math.min(inv.y0, o.y0), x1: Math.max(inv.x1, o.x1), y1: Math.max(inv.y1, o.y1) } : { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 };
        }
      });
    }
    var pad = Math.round(0.04 * DPI);
    function padB(b) { return { x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(w, b.x1 + pad), y1: Math.min(h, b.y1 + pad), text: b.text || '' }; }
    labels = labels.map(padB);
    if (inv) inv = padB(inv);
    // page already label sized (≤ 4.5 × 6.5 in): keep whole page
    var small = vp.width / SC <= 4.6 * 72 + 1 && vp.height / SC <= 6.6 * 72 + 1 || vp.width / SC <= 6.6 * 72 + 1 && vp.height / SC <= 4.6 * 72 + 1;
    if (small) { labels = [{ x0: 0, y0: 0, x1: w, y1: h, text: text.map(function (t) { return t.s; }).join(' '), whole: true }]; inv = null; fallback = false; }
    labels.forEach(function (l) { l.courier = findCourier(l.text); l.sku = findSku(l.text); l.qty = findQty(l.text); });
    return { w: w, h: h, vp: vp, canvas: cv, labels: labels, invoice: inv, fallback: fallback, hasText: text.length > 0 };
  }

  async function pageText(pdfPage, vp) {
    try {
      var tc = await pdfPage.getTextContent(), out = [];
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        var p = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        out.push({ x: p[0], y: p[1] - 2, s: it.str });
      });
      return out;
    } catch (e) { return []; }
  }
  function findCourier(t) {
    if (!t) return '';
    for (var i = 0; i < COURIERS.length; i++) { var c = COURIERS[i]; if (new RegExp('(^|[^A-Za-z])' + c.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '([^A-Za-z]|$)', 'i').test(t)) return c.replace('XpressBees', 'Xpressbees').replace('BlueDart', 'Blue Dart'); }
    return '';
  }
  function findSku(t) { var m = t && t.match(/\bSKU(?:\s*ID)?\s*[:\-|]?\s*([A-Za-z0-9][A-Za-z0-9_\-\/.]{1,40})/i); return m ? m[1].replace(/[.|]+$/, '') : ''; }
  function findQty(t) { var m = t && t.match(/\bQ(?:ty|uantity)\s*[:\-]?\s*(\d{1,4})\b/i); return m ? +m[1] : 1; }

  /* ── Load files ─────────────────────────────────────────────────────────── */
  async function addFiles(list) {
    var pdfs = [].slice.call(list).filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; });
    if (!pdfs.length) { say('Please choose label PDF files.', 'error'); return; }
    if (!window.pdfjsLib || !window.PDFLib) { say('Still loading the PDF engine. Try again in a second.', 'error'); return; }
    for (var i = 0; i < pdfs.length; i++) st.files.push({ file: pdfs[i], bytes: new Uint8Array(await pdfs[i].arrayBuffer()) });
    if (st.files.length && st.base === 'labels') st.base = cleanBase(st.files[0].file.name) + (st.files.length > 1 ? '-and-more' : '');
    renderFileList();
    await analyseAll();
  }

  function renderFileList() {
    var box = $('lcFiles'); box.innerHTML = '';
    st.files.forEach(function (f, i) {
      var row = document.createElement('div'); row.className = 'lc-file';
      row.innerHTML = '<span class="lc-fi" aria-hidden="true">📄</span><span class="lc-fn"></span><span class="lc-fm"></span><button type="button" class="cz-link" aria-label="Remove file">✕</button>';
      row.querySelector('.lc-fn').textContent = f.file.name;
      row.querySelector('.lc-fm').textContent = fmtB(f.file.size) + (f.pages ? ' · ' + f.pages + ' page' + (f.pages > 1 ? 's' : '') : '');
      row.querySelector('button').onclick = function () { st.files.splice(i, 1); if (!st.files.length) return reset(); renderFileList(); analyseAll(); };
      box.appendChild(row);
    });
    $('lcDrop').classList.toggle('lc-compact', st.files.length > 0);
    $('lcAddMore').hidden = !st.files.length;
  }

  async function analyseAll() {
    if (st.busy) return; st.busy = true; say('');
    loader(true, 'Finding your labels…', 'Reading pages');
    try {
      st.pages = [];
      for (var fi = 0; fi < st.files.length; fi++) {
        var f = st.files[fi];
        var doc;
        try { doc = await pdfjsLib.getDocument({ data: f.bytes.slice() }).promise; }
        catch (e) {
          if (e && e.name === 'PasswordException') throw new Error(f.file.name + ' is password-protected. Remove the password with Unlock PDF first.');
          throw new Error(f.file.name + ' could not be opened. Is it a valid PDF?');
        }
        f.pages = doc.numPages;
        for (var p = 1; p <= doc.numPages; p++) {
          sub('File ' + (fi + 1) + ' of ' + st.files.length + ' · page ' + p + ' of ' + doc.numPages);
          var pg = await doc.getPage(p);
          var a = await analysePage(pg);
          a.file = fi; a.index = p - 1;
          var thumb = document.createElement('canvas'), tw = 220, tsc = tw / a.w; thumb.width = tw; thumb.height = Math.round(a.h * tsc);
          thumb.getContext('2d').drawImage(a.canvas, 0, 0, thumb.width, thumb.height); a.thumb = thumb; a.tsc = tsc;
          a.full = a.canvas; delete a.canvas;
          st.pages.push(a);
          pg.cleanup();
        }
        doc.destroy();
      }
      renderFileList();
      await build();
    } catch (e) { say(e.message || String(e), 'error'); }
    finally { st.busy = false; loader(false); }
  }

  /* ── Build output PDF with pdf-lib ──────────────────────────────────────── */
  function boxesFor(pg) {
    if (st.manual) {
      var mb = st.manual;
      return [{ x0: mb.x0 * pg.w, y0: mb.y0 * pg.h, x1: mb.x1 * pg.w, y1: mb.y1 * pg.h, text: pg.labels[0] ? pg.labels[0].text : '', courier: pg.labels[0] && pg.labels[0].courier, sku: pg.labels[0] && pg.labels[0].sku, qty: pg.labels[0] ? pg.labels[0].qty : 1 }];
    }
    return pg.labels;
  }

  function pdfRect(pg, b) {
    var p1 = pg.vp.convertToPdfPoint(b.x0, b.y0), p2 = pg.vp.convertToPdfPoint(b.x1, b.y1);
    return { left: Math.min(p1[0], p2[0]), right: Math.max(p1[0], p2[0]), bottom: Math.min(p1[1], p2[1]), top: Math.max(p1[1], p2[1]) };
  }

  function placeEmbedded(page, emb, bw, bh, theta, X, Y, W, H, margin) {
    // theta: counter-clockwise drawing rotation (0/90/180/270). bw,bh = unrotated size.
    var rw = theta % 180 ? bh : bw, rh = theta % 180 ? bw : bh;
    var s = Math.min((W - 2 * margin) / rw, (H - 2 * margin) / rh);
    var dw = rw * s, dh = rh * s, ox = X + (W - dw) / 2, oy = Y + (H - dh) / 2;
    var x = ox, y = oy;
    if (theta === 90) { x = ox + dw; y = oy; }
    else if (theta === 180) { x = ox + dw; y = oy + dh; }
    else if (theta === 270) { x = ox; y = oy + dh; }
    page.drawPage(emb, { x: x, y: y, xScale: s, yScale: s, rotate: PDFLib.degrees(theta) });
  }

  async function build() {
    var P = window.PDFLib, size = SIZES[opt('size') || '4x6'], inc = opt('inv') || 'labels', sort = opt('sort') || 'none';
    var rotate = $('lcRotate').checked, margin = $('lcMargin').checked ? 0.08 * PT : 0.02 * PT;
    var out = await P.PDFDocument.create();
    var srcDocs = [];
    for (var i = 0; i < st.files.length; i++) {
      try { srcDocs.push(await P.PDFDocument.load(st.files[i].bytes, { ignoreEncryption: true, updateMetadata: false })); }
      catch (e) { throw new Error(st.files[i].file.name + ' could not be read for cropping.'); }
    }
    var items = [];
    st.pages.forEach(function (pg, pi) {
      var bxs = boxesFor(pg);
      if (inc !== 'invoices') bxs.forEach(function (b, bi) { items.push({ pg: pg, b: b, kind: 'label', order: pi * 100 + bi * 2, courier: b.courier || '', sku: b.sku || '', qty: b.qty || 1 }); });
      if (inc !== 'labels' && pg.invoice && !st.manual) items.push({ pg: pg, b: pg.invoice, kind: 'invoice', order: pi * 100 + 1 + (bxs.length - 1) * 2, courier: (bxs[0] || {}).courier || '', sku: (bxs[0] || {}).sku || '' });
    });
    if (sort !== 'none') {
      var key = function (it) { return (sort === 'courier' ? (it.courier || '~') + '|' + (it.sku || '~') : (it.sku || '~') + '|' + (it.courier || '~')).toLowerCase(); };
      // keep each invoice right after its label
      items.forEach(function (it) { it.k = key(it); });
      items.sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : a.order - b.order; });
    }
    if (!items.length) throw new Error(inc === 'invoices' ? 'No invoices were found next to the labels.' : 'No labels were found.');
    var cell = null, perSheet = 1, sheet = null, slot = 0;
    if (size.grid) { perSheet = size.grid[0] * size.grid[1]; cell = { w: size.w / size.grid[0], h: size.h / size.grid[1] }; }
    for (var k = 0; k < items.length; k++) {
      var it = items[k], pg = it.pg, src = srcDocs[pg.file], sp = src.getPage(pg.index), r = pdfRect(pg, it.b);
      var emb = await out.embedPage(sp, r);
      var bw = r.right - r.left, bh = r.top - r.bottom;
      var pageRot = ((sp.getRotation().angle % 360) + 360) % 360, theta = (360 - pageRot) % 360;
      var vw = pageRot % 180 ? bh : bw, vh = pageRot % 180 ? bw : bh; // visible size
      if (size.name === SIZES.orig.name) {
        var np = out.addPage([vw, vh]); placeEmbedded(np, emb, bw, bh, theta, 0, 0, vw, vh, 0); continue;
      }
      var tw = cell ? cell.w : size.w, th = cell ? cell.h : size.h;
      if (rotate && (vw > vh) !== (tw > th) && Math.abs(vw - vh) > 0.08 * Math.max(vw, vh)) theta = (theta + 270) % 360;
      if (cell) {
        if (!sheet || slot >= perSheet) { sheet = out.addPage([size.w, size.h]); slot = 0; }
        var cx = slot % size.grid[0], cy = Math.floor(slot / size.grid[0]);
        placeEmbedded(sheet, emb, bw, bh, theta, cx * cell.w, size.h - (cy + 1) * cell.h, cell.w, cell.h, margin + 4);
        // light cut guides
        sheet.drawRectangle({ x: cx * cell.w + 2, y: size.h - (cy + 1) * cell.h + 2, width: cell.w - 4, height: cell.h - 4, borderColor: P.rgb(0.8, 0.8, 0.8), borderWidth: 0.4, borderDashArray: [3, 3] });
        slot++;
      } else {
        var page = out.addPage([size.w, size.h]); placeEmbedded(page, emb, bw, bh, theta, 0, 0, size.w, size.h, margin);
      }
    }
    out.setTitle(st.base + ' labels'); out.setProducer('PDFdukan Label Crop'); out.setCreator('PDFdukan');
    st.out = await out.save();
    st.items = items;
    showResult();
  }

  /* ── Result UI ──────────────────────────────────────────────────────────── */
  function showResult() {
    var labels = st.items.filter(function (i) { return i.kind === 'label'; }), inv = st.items.length - labels.length;
    $('lcResult').hidden = false; $('lcPreviewCard').hidden = false;
    $('lcCount').textContent = labels.length + (inv ? ' + ' + inv + ' invoice' + (inv > 1 ? 's' : '') : '');
    $('lcSize').textContent = SIZES[opt('size') || '4x6'].name;
    $('lcBytes').textContent = fmtB(st.out.length);
    var fb = st.pages.filter(function (p) { return p.fallback; }).length;
    var notes = [];
    if (fb && !st.manual) notes.push(fb + ' page' + (fb > 1 ? 's' : '') + ' had no barcode we could find, so the largest block was used. Check the preview, or use Adjust crop box.');
    if ((opt('sort') || 'none') !== 'none' && !st.pages.some(function (p) { return p.hasText; })) notes.push('This PDF has no text layer (it is a scan), so labels keep their original order.');
    $('lcNote').textContent = notes.join(' ');
    $('lcNote').hidden = !notes.length;
    renderSummary(labels);
    renderPreview();
  }

  function renderSummary(labels) {
    var by = {}, cb = {};
    labels.forEach(function (l) { var s = l.sku || '—'; by[s] = (by[s] || 0) + (l.qty || 1); var c = l.courier || '—'; cb[c] = (cb[c] || 0) + 1; });
    var skus = Object.keys(by), box = $('lcSummary');
    if (skus.length <= 1 && skus[0] === '—' && Object.keys(cb).length <= 1) { box.hidden = true; return; }
    var h = '<div class="lc-sum-col"><strong>Pick list by SKU</strong><table><thead><tr><th>SKU</th><th>Qty</th></tr></thead><tbody>';
    skus.sort().forEach(function (s) { h += '<tr><td></td><td>' + by[s] + '</td></tr>'; });
    h += '</tbody></table></div><div class="lc-sum-col"><strong>Labels by courier</strong><table><thead><tr><th>Courier</th><th>Labels</th></tr></thead><tbody>';
    var cs = Object.keys(cb).sort(); cs.forEach(function () { h += '<tr><td></td><td></td></tr>'; });
    h += '</tbody></table></div>';
    box.innerHTML = h; box.hidden = false;
    var tds = box.querySelectorAll('.lc-sum-col:first-child tbody td:first-child'); skus.forEach(function (s, i) { tds[i].textContent = s; });
    var rows = box.querySelectorAll('.lc-sum-col:last-child tbody tr'); cs.forEach(function (c, i) { rows[i].children[0].textContent = c; rows[i].children[1].textContent = cb[c]; });
  }

  function renderPreview() {
    var grid = $('lcPages'); grid.innerHTML = '';
    st.pages.forEach(function (pg, i) {
      var c = document.createElement('canvas'); c.width = pg.thumb.width; c.height = pg.thumb.height;
      var x = c.getContext('2d'); x.drawImage(pg.thumb, 0, 0);
      var inc = opt('inv') || 'labels';
      if (inc !== 'invoices') boxesFor(pg).forEach(function (b) { x.strokeStyle = '#16a34a'; x.lineWidth = 2; x.fillStyle = 'rgba(22,163,74,.10)'; x.fillRect(b.x0 * pg.tsc, b.y0 * pg.tsc, (b.x1 - b.x0) * pg.tsc, (b.y1 - b.y0) * pg.tsc); x.strokeRect(b.x0 * pg.tsc, b.y0 * pg.tsc, (b.x1 - b.x0) * pg.tsc, (b.y1 - b.y0) * pg.tsc); });
      if (inc !== 'labels' && pg.invoice && !st.manual) { var b = pg.invoice; x.setLineDash([5, 4]); x.strokeStyle = '#2563eb'; x.lineWidth = 2; x.strokeRect(b.x0 * pg.tsc, b.y0 * pg.tsc, (b.x1 - b.x0) * pg.tsc, (b.y1 - b.y0) * pg.tsc); }
      var fig = document.createElement('figure'); fig.className = 'lc-page' + (pg.fallback && !st.manual ? ' lc-warn' : '');
      var cap = document.createElement('figcaption'); cap.textContent = 'Page ' + (i + 1) + ' · ' + boxesFor(pg).length + ' label' + (boxesFor(pg).length > 1 ? 's' : '');
      fig.appendChild(c); fig.appendChild(cap); grid.appendChild(fig);
    });
    // first output page preview
    renderOutPreview();
  }

  async function renderOutPreview() {
    try {
      var doc = await pdfjsLib.getDocument({ data: st.out.slice() }).promise, n = Math.min(doc.numPages, 4), box = $('lcOut'); box.innerHTML = '';
      for (var i = 1; i <= n; i++) {
        var pg = await doc.getPage(i), vp0 = pg.getViewport({ scale: 1 }), s = 200 / Math.max(vp0.width, vp0.height), vp = pg.getViewport({ scale: s * (window.devicePixelRatio > 1 ? 2 : 1) });
        var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = (vp.width / (window.devicePixelRatio > 1 ? 2 : 1)) + 'px';
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; box.appendChild(c);
      }
      if (doc.numPages > n) { var more = document.createElement('div'); more.className = 'lc-more'; more.textContent = '+' + (doc.numPages - n) + ' more'; box.appendChild(more); }
      doc.destroy();
    } catch (e) { /* preview is optional */ }
  }

  /* ── Manual crop box (one box for all pages) ────────────────────────────── */
  function openEditor() {
    var pg = st.pages[st.cur] || st.pages[0]; if (!pg) return;
    $('lcEditor').hidden = false; st.editing = true;
    var c = $('lcEdCanvas'), maxW = Math.min(560, $('lcEditor').clientWidth - 20), s = maxW / pg.w;
    c.width = Math.round(pg.w * s); c.height = Math.round(pg.h * s); c._s = s;
    var b0 = st.manual ? { x0: st.manual.x0 * pg.w, y0: st.manual.y0 * pg.h, x1: st.manual.x1 * pg.w, y1: st.manual.y1 * pg.h } : (pg.labels[0] || { x0: pg.w * 0.1, y0: pg.h * 0.05, x1: pg.w * 0.9, y1: pg.h * 0.5 });
    st.edBox = { x0: b0.x0 * s, y0: b0.y0 * s, x1: b0.x1 * s, y1: b0.y1 * s };
    drawEditor();
    $('lcEditor').scrollIntoView({ block: 'nearest' });
  }
  function drawEditor() {
    var pg = st.pages[st.cur] || st.pages[0], c = $('lcEdCanvas'), x = c.getContext('2d'), b = st.edBox;
    x.drawImage(pg.full, 0, 0, c.width, c.height);
    x.fillStyle = 'rgba(15,23,42,.45)';
    x.fillRect(0, 0, c.width, b.y0); x.fillRect(0, b.y1, c.width, c.height - b.y1); x.fillRect(0, b.y0, b.x0, b.y1 - b.y0); x.fillRect(b.x1, b.y0, c.width - b.x1, b.y1 - b.y0);
    x.strokeStyle = '#ff6333'; x.lineWidth = 2; x.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    x.fillStyle = '#ff6333';
    [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 7, 0, 7); x.fill(); });
  }
  function bindEditor() {
    var c = $('lcEdCanvas'), drag = null;
    function pos(e) { var r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return { x: (t.clientX - r.left) * c.width / r.width, y: (t.clientY - r.top) * c.height / r.height }; }
    function down(e) {
      var p = pos(e), b = st.edBox, hit = 16;
      var corners = { tl: [b.x0, b.y0], tr: [b.x1, b.y0], bl: [b.x0, b.y1], br: [b.x1, b.y1] };
      drag = null;
      Object.keys(corners).forEach(function (k) { if (Math.abs(p.x - corners[k][0]) < hit && Math.abs(p.y - corners[k][1]) < hit) drag = { k: k }; });
      if (!drag && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) drag = { k: 'move', ox: p.x, oy: p.y, b: Object.assign({}, b) };
      if (!drag) { drag = { k: 'br' }; st.edBox = { x0: p.x, y0: p.y, x1: p.x + 2, y1: p.y + 2 }; }
      e.preventDefault();
    }
    function move(e) {
      if (!drag) return; var p = pos(e), b = st.edBox, W = c.width, H = c.height;
      p.x = Math.max(0, Math.min(W, p.x)); p.y = Math.max(0, Math.min(H, p.y));
      if (drag.k === 'move') { var dx = p.x - drag.ox, dy = p.y - drag.oy, bw = drag.b.x1 - drag.b.x0, bh = drag.b.y1 - drag.b.y0; b.x0 = Math.max(0, Math.min(W - bw, drag.b.x0 + dx)); b.y0 = Math.max(0, Math.min(H - bh, drag.b.y0 + dy)); b.x1 = b.x0 + bw; b.y1 = b.y0 + bh; }
      else { if (drag.k[1] === 'l') b.x0 = Math.min(p.x, b.x1 - 10); else b.x1 = Math.max(p.x, b.x0 + 10); if (drag.k[0] === 't') b.y0 = Math.min(p.y, b.y1 - 10); else b.y1 = Math.max(p.y, b.y0 + 10); }
      drawEditor(); e.preventDefault();
    }
    function up() { drag = null; }
    c.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    c.addEventListener('touchstart', down, { passive: false }); c.addEventListener('touchmove', move, { passive: false }); c.addEventListener('touchend', up);
    $('lcEdApply').onclick = async function () {
      var c2 = $('lcEdCanvas'), b = st.edBox;
      st.manual = { x0: b.x0 / c2.width, y0: b.y0 / c2.height, x1: b.x1 / c2.width, y1: b.y1 / c2.height };
      $('lcEditor').hidden = true; $('lcAuto').hidden = false; await rebuild();
    };
    $('lcEdCancel').onclick = function () { $('lcEditor').hidden = true; };
    $('lcAuto').onclick = async function () { st.manual = null; $('lcAuto').hidden = true; await rebuild(); };
  }

  async function rebuild() {
    if (!st.pages.length || st.busy) return;
    st.busy = true; loader(true, 'Cropping labels…', '');
    try { await build(); } catch (e) { say(e.message || String(e), 'error'); }
    finally { st.busy = false; loader(false); }
  }

  /* ── Download / print ───────────────────────────────────────────────────── */
  function download() {
    if (!st.out) return;
    var blob = new Blob([st.out], { type: 'application/pdf' }), url = URL.createObjectURL(blob);
    var name = st.base + '-labels-' + (opt('size') || '4x6') + '.pdf';
    var save = function (n) { if (!n) return; var a = document.createElement('a'); a.href = url; a.download = /\.pdf$/i.test(n) ? n : n + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (window.CMLogs && window.CMLogs.log) window.CMLogs.log({ tool: 'Label Crop', action: 'crop', output: a.download, size: blob.size }); };
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(name).then(save); else save(name);
  }
  function printPdf() {
    if (!st.out) return;
    var url = URL.createObjectURL(new Blob([st.out], { type: 'application/pdf' }));
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; f.src = url;
    f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(url, '_blank'); } setTimeout(function () { f.remove(); URL.revokeObjectURL(url); }, 60000); };
    document.body.appendChild(f);
  }

  function reset() {
    st.files = []; st.pages = []; st.out = null; st.manual = null; st.base = 'labels';
    ['lcResult', 'lcPreviewCard', 'lcEditor', 'lcAuto', 'lcAddMore'].forEach(function (id) { $(id).hidden = true; });
    $('lcFiles').innerHTML = ''; $('lcDrop').classList.remove('lc-compact'); $('lcInput').value = ''; say('');
  }

  function init() {
    if (!$('lcDrop')) return;
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('lcDrop'), input = $('lcInput');
    dz.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    input.addEventListener('change', function () { if (input.files.length) addFiles(input.files); input.value = ''; });
    $('lcAddMore').onclick = function () { input.click(); };
    document.querySelectorAll('[data-lc-size],[data-lc-inv],[data-lc-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var attr = b.hasAttribute('data-lc-size') ? 'data-lc-size' : b.hasAttribute('data-lc-inv') ? 'data-lc-inv' : 'data-lc-sort';
        document.querySelectorAll('[' + attr + ']').forEach(function (o) { o.classList.toggle('active', o === b); o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        rebuild();
      });
    });
    $('lcRotate').addEventListener('change', rebuild); $('lcMargin').addEventListener('change', rebuild);
    $('lcDownload').onclick = download; $('lcPrint').onclick = printPdf; $('lcReset').onclick = reset;
    $('lcEdit').onclick = openEditor; bindEditor();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PDLabelCrop = { _st: st, analysePage: analysePage };
})();
