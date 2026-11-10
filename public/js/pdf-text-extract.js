/* PDF Text Extractor — PDFdukan
 * Pulls the text out of a PDF in reading order (columns, right-to-left lines),
 * and reads scanned pages with OCR (Tesseract.js) automatically.
 * Everything runs in the browser; the PDF is never uploaded.
 */
(function () {
  'use strict';
  var MAX = 200 * 1024 * 1024;
  var TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  var $ = function (id) { return document.getElementById(id); };
  var st = { file: null, bytes: null, doc: null, pages: [], busy: false, cancel: false, worker: null, workerLang: '', pw: '' };
  var OPT = { breaks: true, paras: false, lang: 'eng', ocr: true };
  try { var o = JSON.parse(localStorage.getItem('pd-textx-v1') || '{}'); Object.keys(OPT).forEach(function (k) { if (o[k] !== undefined) OPT[k] = o[k]; }); } catch (e) {}
  function saveOpt() { try { localStorage.setItem('pd-textx-v1', JSON.stringify(OPT)); } catch (e) {} }
  function say(m, t) { if (window.toast) toast(m, t || 'info'); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  var RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }

  /* ---------- reading order for one page ---------- */
  function linesOf(items, vp) {
    // place every piece of text in page (display) coordinates
    var parts = [];
    items.forEach(function (it) {
      if (!it || typeof it.str !== 'string' || !it.str.length) return;
      var m = pdfjsLib.Util.transform(vp.transform, it.transform);
      var fs = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 10;
      var w = (it.width || 0) * vp.scale;
      var x = m[4], y = m[5];               // baseline start, y grows downward
      if (!/\S/.test(it.str) && !w) return;
      parts.push({ s: it.str.replace(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g, function (c) { return c.normalize('NFKC'); }), x: x, y: y, w: w, fs: fs, rtl: it.dir === 'rtl' || RTL.test(it.str) });
    });
    if (!parts.length) return [];
    parts.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [];
    parts.forEach(function (p) {
      var L = null;
      for (var i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
        var c = lines[i];
        if (Math.abs(c.y - p.y) <= Math.min(c.fs, p.fs) * 0.45) { L = c; break; }
      }
      if (!L) { L = { y: p.y, fs: p.fs, items: [] }; lines.push(L); }
      L.items.push(p); L.fs = Math.max(L.fs, p.fs);
    });
    for (var q = lines.length - 2; q >= 0; q--) {
      var A = lines[q], B = lines[q + 1], small = A.items.every(function (p) { return p.fs <= B.fs * 0.75; });
      if (small && B.y - A.y > 0 && B.y - A.y < B.fs * 0.6) { B.items = A.items.concat(B.items); lines.splice(q, 1); }
    }
    lines.forEach(function (L) {
      var rtl = L.items.filter(function (p) { return p.rtl; }).length > L.items.length / 2;
      L.rtl = rtl;
      L.items.sort(function (a, b) { return rtl ? (b.x - a.x) : (a.x - b.x); });
      L.x0 = Math.min.apply(null, L.items.map(function (p) { return p.x; }));
      L.x1 = Math.max.apply(null, L.items.map(function (p) { return p.x + p.w; }));
    });
    return lines;
  }

  // split a line into pieces wherever there is a wide horizontal gap (columns)
  function lineText(L) {
    var out = '', prev = null;
    L.items.forEach(function (p) {
      if (prev) {
        var gap = L.rtl ? (prev.x - (p.x + p.w)) : (p.x - (prev.x + prev.w));
        var need = !/\s$/.test(out) && !/^\s/.test(p.s);
        if (gap > p.fs * 0.18 && need) out += ' ';
      }
      out += p.s; prev = p;
    });
    return out.replace(/\s+/g, ' ').trim();
  }

  // find a vertical gutter shared by most lines (two- or three-column pages)
  function gutters(lines, pageW) {
    if (lines.length < 8) return [];
    var bins = 200, cover = new Array(bins).fill(0), body = 0;
    lines.forEach(function (L) {
      L.items.forEach(function (p) {
        var a = Math.max(0, Math.floor(p.x / pageW * bins)), b = Math.min(bins - 1, Math.floor((p.x + p.w) / pageW * bins));
        for (var i = a; i <= b; i++) cover[i]++;
      });
      body++;
    });
    var res = [], i = Math.floor(bins * 0.2);
    while (i < bins * 0.8) {
      if (cover[i] <= Math.max(2, body * 0.25)) {
        var j = i; while (j < bins * 0.8 && cover[j] <= Math.max(2, body * 0.25)) j++;
        if (j - i >= 2) {
          var gx = (i + j) / 2 / bins * pageW;
          var left = 0, right = 0, all = 0;
          lines.forEach(function (L) { L.items.forEach(function (p) { all++; if (p.x + p.w <= gx + 1) left++; else if (p.x >= gx - 1) right++; }); });
          if (left >= all * 0.2 && right >= all * 0.2) res.push(gx);
        }
        i = j;
      } else i++;
    }
    return res;
  }

  function orderPage(lines, pageW) {
    var g = gutters(lines, pageW);
    if (!g.length) return [lines];
    // cut lines at the gutters, then read band by band: full-width lines stay in place,
    // runs of column lines are read column after column
    var pieces = [];
    lines.forEach(function (L) {
      var groups = [[]], edges = g.slice();
      L.items.forEach(function (p) {
        var col = 0; edges.forEach(function (e, k) { if (p.x >= e - 1) col = k + 1; });
        while (groups.length <= col) groups.push([]);
        groups[col].push(p);
      });
      var used = groups.filter(function (a) { return a.length; });
      var crosses = L.items.some(function (p) { return edges.some(function (e) { return p.x < e - 2 && p.x + p.w > e + 2; }); });
      if (crosses || used.length === 0) { pieces.push({ full: true, L: L }); return; }
      groups.forEach(function (arr, col) { if (arr.length) pieces.push({ full: false, col: col, L: { y: L.y, fs: L.fs, rtl: L.rtl, items: arr, x0: arr[0].x, x1: arr[arr.length - 1].x + arr[arr.length - 1].w } }); });
    });
    var blocks = [], run = null;
    pieces.forEach(function (pc) {
      if (pc.full) { if (run) { blocks.push(run); run = null; } blocks.push({ full: [pc.L] }); return; }
      if (!run) run = { cols: {} };
      (run.cols[pc.col] = run.cols[pc.col] || []).push(pc.L);
    });
    if (run) blocks.push(run);
    var out = [];
    blocks.forEach(function (b) {
      if (b.full) out.push(b.full);
      else Object.keys(b.cols).sort(function (a, c) { return a - c; }).forEach(function (k) { out.push(b.cols[k]); });
    });
    return out;
  }

  // lines of a block -> text, with optional paragraph joining
  function blockText(lines) {
    if (!lines.length) return '';
    var gaps = [];
    for (var i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
    var sorted = gaps.slice().sort(function (a, b) { return a - b; }), typical = sorted[Math.floor(sorted.length / 2)] || lines[0].fs * 1.2;
    var out = '';
    lines.forEach(function (L, k) {
      var t = lineText(L); if (!t) return;
      if (!out) { out = t; return; }
      var gap = L.y - lines[k - 1].y, newPara = gap > typical * 1.45 || gap > L.fs * 2.2;
      if (OPT.paras && !newPara) {
        if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
        else out += ' ' + t;
      } else out += (newPara ? '\n\n' : '\n') + t;
    });
    return out;
  }

  /* ---------- OCR ---------- */
  async function ocrWorker() {
    if (st.worker && st.workerLang === OPT.lang) return st.worker;
    if (st.worker) { try { await st.worker.terminate(); } catch (e) {} st.worker = null; }
    if (typeof Tesseract === 'undefined') await loadScript(TESS_URL);
    var langs = OPT.lang.split('+');
    st.worker = await Tesseract.createWorker(langs.length > 1 ? langs : langs[0], 1, {});
    await st.worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    st.workerLang = OPT.lang;
    return st.worker;
  }
  async function ocrPage(n) {
    var page = await st.doc.getPage(n), v1 = page.getViewport({ scale: 1 });
    var sc = Math.min(300 / 72, 4200 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: sc });
    var c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    var w = await ocrWorker();
    var r = await w.recognize(c);
    c.width = c.height = 1;
    var txt = (r && r.data && r.data.text) || '';
    txt = txt.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (OPT.paras) txt = txt.split(/\n{2,}/).map(function (p) { return p.replace(/-\n(?=[a-z])/g, '').replace(/\n/g, ' '); }).join('\n\n');
    return { text: txt, conf: r && r.data ? Math.round(r.data.confidence) : 0 };
  }

  /* ---------- page selection ---------- */
  function pickPages(n) {
    var v = ($('txRange').value || '').trim();
    if ($('txPages').value !== 'range' || !v) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }
    var set = {};
    v.split(/[,;\s]+/).forEach(function (part) {
      var m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
      if (m) { var a2 = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n; for (var k = Math.max(1, a2); k <= Math.min(n, b); k++) set[k] = 1; }
      else if (/^\d+$/.test(part) && +part >= 1 && +part <= n) set[+part] = 1;
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ---------- run ---------- */
  async function extract() {
    if (!st.doc || st.busy) return;
    st.busy = true; st.cancel = false;
    var list = pickPages(st.doc.numPages);
    if (!list.length) { st.busy = false; say('No pages match that range.', 'error'); return; }
    if (window.PDLoader) PDLoader.show('Extracting text…', 'Page 1 of ' + list.length, function () { st.cancel = true; });
    var out = [], ocrCount = 0, ocrSkipped = 0, emptyCount = 0, confs = [];
    try {
      for (var i = 0; i < list.length; i++) {
        if (st.cancel) break;
        var n = list[i];
        if (window.PDLoader) PDLoader.update('Extracting text…', 'Page ' + (i + 1) + ' of ' + list.length);
        var page = await st.doc.getPage(n);
        var vp = page.getViewport({ scale: 1 });
        var tc = await page.getTextContent({ disableNormalization: false });
        var lines = linesOf(tc.items, vp);
        var chars = lines.reduce(function (s, L) { return s + L.items.reduce(function (t, p) { return t + p.s.replace(/\s/g, '').length; }, 0); }, 0);
        var text = '', how = 'text';
        if (chars >= 15) {
          text = orderPage(lines, vp.width).map(blockText).filter(Boolean).join('\n\n');
        } else if (OPT.ocr) {
          if (window.PDLoader) PDLoader.update('Reading scanned page with OCR…', 'Page ' + (i + 1) + ' of ' + list.length + ' · ' + $('txLang').selectedOptions[0].textContent);
          try { var r = await ocrPage(n); text = r.text; how = 'ocr'; ocrCount++; confs.push(r.conf); }
          catch (e) { console.error(e); how = 'ocr-failed'; ocrSkipped++; }
        } else { how = 'none'; ocrSkipped++; }
        if (!text.trim()) emptyCount++;
        out.push({ n: n, text: text, how: how });
      }
    } finally {
      if (window.PDLoader) PDLoader.hide();
      st.busy = false;
    }
    st.pages = out;
    render(ocrCount, ocrSkipped, emptyCount, confs, list.length);
  }

  function fullText() {
    return st.pages.map(function (p) {
      return (OPT.breaks ? '--- Page ' + p.n + ' ---\n' : '') + p.text;
    }).filter(function (s) { return s.trim(); }).join('\n\n');
  }

  function render(ocrCount, ocrSkipped, emptyCount, confs, total) {
    var t = fullText();
    $('txOut').value = t;
    $('txOut').dir = RTL.test(t.slice(0, 400)) && !/[A-Za-z]{4}/.test(t.slice(0, 200)) ? 'rtl' : 'auto';
    var words = (t.replace(/--- Page \d+ ---/g, '').match(/\S+/g) || []).length;
    $('txStats').innerHTML = '<span><b>' + total + '</b> page' + (total === 1 ? '' : 's') + '</span><span><b>' + words.toLocaleString() + '</b> words</span><span><b>' + t.length.toLocaleString() + '</b> characters</span>' +
      (ocrCount ? '<span class="tx-ocr"><b>' + ocrCount + '</b> scanned page' + (ocrCount > 1 ? 's' : '') + ' read with OCR' + (confs.length ? ' · ' + Math.round(confs.reduce(function (a, b) { return a + b; }, 0) / confs.length) + '% confidence' : '') + '</span>' : '');
    var note = '';
    if (ocrSkipped && !OPT.ocr) note = ocrSkipped + ' page' + (ocrSkipped > 1 ? 's have' : ' has') + ' no text layer. Turn on "Read scanned pages (OCR)" to read them.';
    else if (ocrSkipped) note = 'OCR could not run on ' + ocrSkipped + ' page' + (ocrSkipped > 1 ? 's' : '') + '. Check your connection (the OCR engine loads once), then try again.';
    else if (emptyCount === total) note = 'No text was found on these pages.';
    $('txNote').textContent = note; $('txNote').hidden = !note;
    $('txUpload').hidden = true; $('txResult').hidden = false;
    if (window.trackToolUse) trackToolUse('pdf-text-extractor');
  }

  /* ---------- outputs ---------- */
  function base() { return (st.file ? st.file.name : 'document').replace(/\.pdf$/i, ''); }
  function dl(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function xml(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  async function docx() {
    if (!window.JSZip) { say('Word export is still loading, try again in a moment.', 'error'); return; }
    var body = '';
    var text = $('txOut').value;
    text.split('\n').forEach(function (line) {
      var m = /^--- Page (\d+) ---$/.exec(line);
      if (m && +m[1] !== (st.pages[0] && st.pages[0].n)) { body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; return; }
      if (m) return;
      var rtl = RTL.test(line) && !/[A-Za-z]{3}/.test(line);
      body += '<w:p>' + (rtl ? '<w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>' : '') + '<w:r>' + (rtl ? '<w:rPr><w:rtl/></w:rPr>' : '') + '<w:t xml:space="preserve">' + xml(line) + '</w:t></w:r></w:p>';
    });
    var z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>');
    dl(await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), base() + '-text.docx');
  }

  /* ---------- file ---------- */
  async function openFile(f, password) {
    var info = $('txInfo');
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { info.textContent = 'Choose a PDF file.'; return; }
    if (f.size > MAX) { info.textContent = 'This tool reads PDFs up to 200 MB.'; return; }
    info.textContent = '';
    try {
      if (!password) { st.bytes = new Uint8Array(await f.arrayBuffer()); st.file = f; }
      if (st.doc) { try { st.doc.destroy(); } catch (e) {} }
      st.doc = await pdfjsLib.getDocument({ data: st.bytes.slice(0), password: password || '', isEvalSupported: false }).promise;
      $('txPw').hidden = true;
      $('txFile').textContent = f.name + ' · ' + st.doc.numPages + ' page' + (st.doc.numPages === 1 ? '' : 's') + ' · ' + size(f.size);
      await extract();
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        $('txPw').hidden = false; $('txPwMsg').textContent = e.code === 2 ? 'That password is not correct.' : 'This PDF needs a password to open.';
        $('txPwIn').value = ''; $('txPwIn').focus();
      } else { info.textContent = 'This file could not be read as a PDF.'; console.error(e); }
    }
  }

  function init() {
    if (!$('txDrop')) return;
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('txDrop'), inp = $('txFileInput');
    dz.onclick = function () { inp.click(); };
    dz.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = function (e) { openFile(e.target.files[0]); inp.value = ''; };
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) openFile(e.dataTransfer.files[0]); });
    $('txPwForm').onsubmit = function (e) { e.preventDefault(); var v = $('txPwIn').value; if (v) openFile(st.file, v); };
    $('txBreaks').checked = OPT.breaks; $('txParas').checked = OPT.paras; $('txOcr').checked = OPT.ocr; $('txLang').value = OPT.lang;
    function rerun() { saveOpt(); extract(); }
    $('txBreaks').onchange = function () { OPT.breaks = this.checked; saveOpt(); if (st.pages.length) $('txOut').value = fullText(); };
    $('txParas').onchange = function () { OPT.paras = this.checked; rerun(); };
    $('txOcr').onchange = function () { OPT.ocr = this.checked; rerun(); };
    $('txLang').onchange = function () { OPT.lang = this.value; saveOpt(); if (st.pages.some(function (p) { return p.how !== 'text'; })) extract(); };
    $('txPages').onchange = function () { $('txRange').hidden = this.value !== 'range'; if (this.value === 'range') $('txRange').focus(); else extract(); };
    $('txRange').onchange = function () { extract(); };
    $('txCopy').onclick = async function () { var t = $('txOut').value; if (!t) return; try { await navigator.clipboard.writeText(t); } catch (e) { $('txOut').select(); document.execCommand('copy'); } say('Text copied', 'success'); };
    $('txTxt').onclick = function () { var t = $('txOut').value; if (!t) return; dl(new Blob(['﻿', t], { type: 'text/plain;charset=utf-8' }), base() + '-text.txt'); };
    $('txDocx').onclick = docx;
    $('txAgain').onclick = function () { st.pages = []; if (st.doc) { try { st.doc.destroy(); } catch (e) {} } st.doc = null; $('txResult').hidden = true; $('txUpload').hidden = false; $('txOut').value = ''; $('txPages').value = 'all'; $('txRange').hidden = true; $('txRange').value = ''; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.TextX = { st: st, OPT: OPT, openFile: openFile, extract: extract, fullText: fullText };
})();
