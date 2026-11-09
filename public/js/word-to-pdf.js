/* PDFdukan — Word to PDF converter
 * Engine: ZetaOffice (LibreOffice compiled to WebAssembly) running in the browser tab.
 * The Word file is written into the engine's private in-memory file system and exported
 * with LibreOffice's own PDF export, so page size, margins, fonts, tables, headers,
 * footers, page numbers, text boxes and images follow the document.
 * Nothing is uploaded. The engine itself (about 50–100 MB) is downloaded from
 * cdn.zetaoffice.net the first time and then cached by the browser.
 *
 * The engine needs a cross-origin isolated page (SharedArrayBuffer). The server sends the
 * headers; /w2p-coi-sw.js adds them when a host cannot. If the browser still can't run
 * the engine, a print view (docx-preview) lets the user save a PDF with the browser's printer.
 */
(function () {
  'use strict';

  var MAX_BYTES = 50 * 1024 * 1024;
  var MAX_FILES = 10;
  var OK_EXT = /\.(docx|doc|odt|rtf|txt)$/i;
  var RUNTIME = 'https://cdn.zetaoffice.net/zetaoffice_latest/';
  var DOCX_PREVIEW = 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js';
  var H2C_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

  var st = { files: [], lastFiles: [], results: [], merged: null, busy: false, previewUrl: null, local: undefined, quality: 'best' };

  function $(id) { return document.getElementById(id); }
  function say(m, t) { if (window.toast) window.toast(m, t || 'success'); }
  function size(b) { return b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; }
  function esc(v) { var s = document.createElement('span'); s.textContent = v; return s.innerHTML; }
  function loadScript(src, cors) {
    return new Promise(function (res, rej) {
      if (Array.from(document.scripts).some(function (s) { return s.src === src; })) { res(); return; }
      var s = document.createElement('script'); s.src = src; if (cors) s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src.split('/')[2])); }; document.head.appendChild(s);
    });
  }
  function progress(pct, label) {
    $('progressCard').style.display = '';
    $('progressFill').style.width = Math.max(1, Math.min(100, pct)) + '%';
    $('progressLabel').textContent = label || '';
  }
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : 'docx'; }
  function baseOf(name) { return name.replace(/\.[a-z0-9]+$/i, '') || 'document'; }

  /* ── Files: adding files starts the conversion right away ── */
  function addFiles(list) {
    if (st.busy) return;
    var batch = [];
    Array.from(list || []).forEach(function (f) {
      if (/\.(doc|odt|rtf)$/i.test(f.name) && !engineWanted() && !st.local) { say('"' + f.name + '" is an older format. Open it in Word, choose File > Save As > Word Document (.docx), then add the new file.', 'error'); return; }
      if (!OK_EXT.test(f.name)) { say('"' + f.name + '" is not a Word file. Use DOCX or TXT.', 'error'); return; }
      if (f.size > MAX_BYTES) { say('"' + f.name + '" is over 50 MB.', 'error'); return; }
      if (st.results.length + batch.length >= MAX_FILES) { say('Up to ' + MAX_FILES + ' files at a time.', 'info'); return; }
      batch.push(f);
    });
    if (batch.length) { st.files = batch; run(); }
  }
  /* ── Engine ────────────────────────────────────────────── */
  function NoEngine(msg) { var e = new Error(msg); e.noEngine = true; return e; }
  async function localApi() {
    if (st.local !== undefined) return st.local;
    st.local = false;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;
    try { var r = await fetch('/api/word-to-pdf', { cache: 'no-store' }); if (r.ok) { var j = await r.json(); st.local = j.ready ? j : false; } } catch (e) { }
    return st.local;
  }
  // fonts that look and measure like the Word fonts people use (all open licence, served by jsDelivr)
  var FONT_CDN = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/';
  var FONT_SETS = {
    tinos: { family: 'Tinos', pkg: 'tinos@0.4.2', files: { r: '400Regular/Tinos_400Regular', b: '700Bold/Tinos_700Bold', i: '400Regular_Italic/Tinos_400Regular_Italic', bi: '700Bold_Italic/Tinos_700Bold_Italic' } },
    arimo: { family: 'Arimo', pkg: 'arimo@0.4.3', files: { r: '400Regular/Arimo_400Regular', b: '700Bold/Arimo_700Bold', i: '400Regular_Italic/Arimo_400Regular_Italic', bi: '700Bold_Italic/Arimo_700Bold_Italic' } },
    cousine: { family: 'Cousine', pkg: 'cousine@0.4.3', files: { r: '400Regular/Cousine_400Regular', b: '700Bold/Cousine_700Bold', i: '400Regular_Italic/Cousine_400Regular_Italic', bi: '700Bold_Italic/Cousine_700Bold_Italic' } },
    carlito: { family: 'Carlito', pkg: 'carlito@0.4.1', files: { r: '400Regular/Carlito_400Regular', b: '700Bold/Carlito_700Bold', i: '400Regular_Italic/Carlito_400Regular_Italic', bi: '700Bold_Italic/Carlito_700Bold_Italic' } },
    caladea: { family: 'Caladea', pkg: 'caladea@0.4.2', files: { r: '400Regular/Caladea_400Regular', b: '700Bold/Caladea_700Bold', i: '400Regular_Italic/Caladea_400Regular_Italic', bi: '700Bold_Italic/Caladea_700Bold_Italic' } },
    naskh: { family: 'Noto Naskh Arabic', pkg: 'noto-naskh-arabic@0.4.5', files: { r: '400Regular/NotoNaskhArabic_400Regular', b: '700Bold/NotoNaskhArabic_700Bold' } },
    nastaliq: { family: 'Noto Nastaliq Urdu', pkg: 'noto-nastaliq-urdu@0.4.2', files: { r: '400Regular/NotoNastaliqUrdu_400Regular', b: '700Bold/NotoNastaliqUrdu_700Bold' } }
  };
  // Word font name → stand-in set
  var FONT_MAP = [
    [/^(times new roman|times|tms rmn)$/i, 'tinos'],
    [/^(arial|helvetica|arial mt|liberation sans)$/i, 'arimo'],
    [/^(courier new|courier)$/i, 'cousine'],
    [/^calibri( light)?$/i, 'carlito'],
    [/^cambria( math)?$/i, 'caladea'],
    [/nasta(l|')?(i|ee)q|nastaliq|nastaleeq|nafees nastaleeq|mehr|pak nastaleeq|urdu typesetting/i, 'nastaliq'],
    [/naskh|traditional arabic|simplified arabic|arabic typesetting|sakkal|tahoma|segoe ui|majalla|andalus|aldhabi|amiri|scheherazade/i, 'naskh']
  ];
  function fontKey(name) { for (var i = 0; i < FONT_MAP.length; i++) if (FONT_MAP[i][0].test(String(name).trim())) return FONT_MAP[i][1]; return null; }
  function fontUrl(set, k) { return FONT_CDN + set.pkg + '/' + set.files[k] + '.ttf'; }
  // which Word fonts a file asks for, and whether it has Urdu/Arabic text
  async function fontsOf(buf) {
    var out = { names: {}, rtl: false };
    try {
      var zip = await window.JSZip.loadAsync(buf);
      var parts = Object.keys(zip.files).filter(function (n) { return /^word\/(document|styles|fontTable|header\d*|footer\d*|footnotes|endnotes|numbering)\.xml$/.test(n); });
      for (var i = 0; i < parts.length; i++) {
        var x = await zip.file(parts[i]).async('string'), m, re = /w:(?:ascii|hAnsi|cs|eastAsia|name)="([^"]+)"/g;
        while ((m = re.exec(x))) out.names[m[1]] = 1;
        if (!out.rtl && /w:document|w:hdr|w:ftr/.test(x.slice(0, 600)) && RTL_CH.test(x.replace(/<[^>]+>/g, ''))) out.rtl = true;
        if (/w:cstheme="minorBidi"|w:cstheme="majorBidi"/.test(x)) out.names['Times New Roman'] = 1;
      }
    } catch (e) { }
    return out;
  }
  function neededSets(info) {
    var sets = {};
    Object.keys(info.names).forEach(function (n) { var k = fontKey(n); if (k) sets[k] = 1; });
    if (info.rtl) sets.naskh = 1;                                // Word draws Urdu in Times New Roman/Arial with Naskh letters
    return Object.keys(sets);
  }
  async function fetchFontFiles(keys) {
    var list = [];
    await Promise.all(keys.map(function (k) {
      var set = FONT_SETS[k];
      return Promise.all(Object.keys(set.files).map(function (w) {
        return fetch(fontUrl(set, w), { mode: 'cors' }).then(function (r) { return r.ok ? r.arrayBuffer() : null; })
          .then(function (b) { if (b) list.push({ name: set.files[w].split('/')[1] + '.ttf', data: new Uint8Array(b) }); }).catch(function () { });
      }));
    }));
    return list;
  }
  var FC_ALIASES = [['Times New Roman', 'Tinos'], ['Times', 'Tinos'], ['Arial', 'Arimo'], ['Helvetica', 'Arimo'], ['Courier New', 'Cousine'], ['Calibri', 'Carlito'], ['Calibri Light', 'Carlito'], ['Cambria', 'Caladea'],
    ['Jameel Noori Nastaleeq', 'Noto Nastaliq Urdu'], ['Jameel Noori Nastaleeq Kasheeda', 'Noto Nastaliq Urdu'], ['Alvi Nastaleeq', 'Noto Nastaliq Urdu'], ['Nafees Nastaleeq', 'Noto Nastaliq Urdu'], ['Urdu Typesetting', 'Noto Nastaliq Urdu'],
    ['Traditional Arabic', 'Noto Naskh Arabic'], ['Simplified Arabic', 'Noto Naskh Arabic'], ['Arabic Typesetting', 'Noto Naskh Arabic'], ['Sakkal Majalla', 'Noto Naskh Arabic']];

  // the office engine failed on this browser recently: go straight to the quick engine for a day
  function engineBlocked() { try { return Date.now() - Number(localStorage.getItem('w2pEngineFail') || 0) < 3600000; } catch (e) { return false; } }
  function markEngineFail() { try { localStorage.setItem('w2pEngineFail', String(Date.now())); } catch (e) { } }
  // ---- Office engine: LibreOffice compiled to WebAssembly (MPL-2.0), served by jsDelivr, kept in the browser cache ----
  var LO_BASE = 'https://cdn.jsdelivr.net/npm/@bentopdf/libreoffice-wasm@2.3.1/assets/';
  var LO_CACHE = 'pdfdukan-office-2.3.1';
  var LO_FILES = { worker: ['browser.worker.global.js', 110190, 0], js: ['soffice.js', 444077, 0], pthread: ['soffice.worker.js', 3221, 0], wasm: ['soffice.wasm.gz', 48763638, 1], data: ['soffice.data.gz', 28604373, 1] };
  var engine = null, engineSeq = 0, enginePending = {};
  // switched off for now: the fast in-browser converter is the default (no 75 MB download). Kept for a later "exact" mode.
  var ENGINE_ON = false;
  function engineWanted() {
    if (window.W2P_FORCE_ENGINE) return true;
    if (!ENGINE_ON) return false;
    if (!self.crossOriginIsolated || typeof DecompressionStream === 'undefined' || typeof SharedArrayBuffer === 'undefined') return false;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;          // too heavy for phones: quick engine there
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
    return !engineBlocked();
  }
  async function engineCached() { try { var c = await caches.open(LO_CACHE); return !!(await c.match(LO_BASE + LO_FILES.wasm[0])) && !!(await c.match(LO_BASE + LO_FILES.data[0])); } catch (e) { return false; } }
  // download one engine file (from the browser's own store when it is there), unzip it, hand back a local link
  async function engineAsset(key, onBytes, signal) {
    var f = LO_FILES[key], url = LO_BASE + f[0], cache = null, res = null;
    try { cache = await caches.open(LO_CACHE); res = await cache.match(url); } catch (e) { cache = null; }
    if (!res) {
      res = await fetch(url, { mode: 'cors', signal: signal });
      if (!res.ok) throw NoEngine('office engine download failed (' + res.status + ')');
      if (cache) { try { await cache.put(url, res.clone()); res = await cache.match(url) || res; } catch (e) { } }
    }
    var counted = res.body.pipeThrough(new TransformStream({ transform: function (chunk, c) { onBytes(chunk.length); c.enqueue(chunk); } }));
    if (f[2]) counted = counted.pipeThrough(new DecompressionStream('gzip'));
    var type = /\.wasm/.test(f[0]) ? 'application/wasm' : /\.js$/.test(f[0]) ? 'text/javascript' : 'application/octet-stream';
    var blob = await new Response(counted).blob();
    return URL.createObjectURL(new Blob([blob], { type: type }));
  }
  function loadEngine(fontFiles, progress, signal) {
    if (engine) return engine;
    engine = (async function () {
      var total = 0, got = 0; Object.keys(LO_FILES).forEach(function (k) { total += LO_FILES[k][1]; });
      var tick = function (n) { got += n; progress && progress(Math.min(99, Math.round(got / total * 100))); };
      var urls = {};
      for (var k in LO_FILES) urls[k] = await engineAsset(k, tick, signal);
      progress && progress(100);
      // a small wrapper puts the extra fonts in place before the engine starts
      var wrap = "self.__pdFonts=[];self.__pdDebug=" + (window.W2P_DEBUG_ENGINE ? 'true' : 'false') + ";" +
        "self.addEventListener('message',function(e){if(e.data&&e.data.type==='pd-fonts'){self.__pdFonts=e.data.fonts||[];e.stopImmediatePropagation();}});" +
        "var __pdM;Object.defineProperty(self,'Module',{configurable:true,get:function(){return __pdM},set:function(m){" +
        "if(m&&!m.__pd){m.__pd=1;if(!self.__pdDebug){m.print=function(){};m.printErr=function(t){if(/abort|exception|fatal/i.test(String(t)))console.error(t)};}" +
        // the engine's debug log (SAL_LOG=+ALL) floods the page and makes Word files crawl: keep it quiet
        "var pre=m.preRun?[].concat(m.preRun):[];pre.unshift(function(M){try{var E=(M&&M.ENV)||self.ENV;if(E&&!self.__pdDebug){Object.defineProperty(E,'SAL_LOG',{configurable:true,enumerable:true,get:function(){return '-INFO-WARN'},set:function(){}});E.MAX_CONCURRENCY='1';}}catch(x){}});" +
        "pre.unshift(function(M){try{var F=(M&&M.FS)||self.FS;if(!F||!self.__pdFonts.length)return;" +
        "var d='/instdir/share/fonts/truetype';try{F.mkdirTree(d)}catch(x){}" +
        "self.__pdFonts.forEach(function(f){try{F.writeFile(d+'/'+f.name,f.data)}catch(x){}});" +
        "try{F.mkdirTree('/instdir/share/fontconfig/conf.d')}catch(x){}" +
        "try{F.writeFile('/instdir/share/fontconfig/conf.d/99-pdfdukan.conf',self.__pdConf||'')}catch(x){}" +
        "}catch(x){}});m.preRun=pre;}__pdM=m;}});" +
        "self.addEventListener('message',function(e){if(e.data&&e.data.type==='pd-conf'){self.__pdConf=e.data.conf;e.stopImmediatePropagation();}});" +
        "importScripts(" + JSON.stringify(urls.worker) + ");";
      var w = new Worker(URL.createObjectURL(new Blob([wrap], { type: 'text/javascript' })));
      var loaded = new Promise(function (res, rej) {
        var t = setTimeout(function () { rej(NoEngine('office engine did not start')); }, 20000);
        w.addEventListener('message', function on(e) { if (e.data && e.data.type === 'loaded') { clearTimeout(t); w.removeEventListener('message', on); res(); } });
      });
      w.onmessage = function (e) {
        var d = e.data || {}, p = enginePending[d.id]; if (!p) return;
        if (d.type === 'progress') return;
        delete enginePending[d.id];
        if (d.type === 'error') p.reject(new Error(d.error || 'The office engine could not convert this file.')); else p.resolve(d.data);
      };
      w.onerror = function (e) { Object.keys(enginePending).forEach(function (id) { enginePending[id].reject(new Error('The office engine stopped: ' + (e.message || 'out of memory?'))); delete enginePending[id]; }); };
      await loaded;
      var conf = '<?xml version="1.0"?><fontconfig>' + FC_ALIASES.filter(function (a) { return /Noto/.test(a[1]); }).map(function (a) { return '<alias binding="same"><family>' + a[0] + '</family><prefer><family>' + a[1] + '</family></prefer></alias>'; }).join('') + '</fontconfig>';
      w.postMessage({ type: 'pd-conf', conf: conf });
      w.postMessage({ type: 'pd-fonts', fonts: fontFiles || [] });
      await engineCall(w, 'init', { sofficeJs: urls.js, sofficeWasm: urls.wasm, sofficeData: urls.data, sofficeWorkerJs: urls.pthread, verbose: false }, 240000);
      try { localStorage.removeItem('w2pEngineFail'); } catch (e) { }
      return w;
    })();
    engine.catch(function () { engine = null; });
    return engine;
  }
  function engineCall(w, type, data, ms) {
    return new Promise(function (resolve, reject) {
      var id = ++engineSeq, t = setTimeout(function () { delete enginePending[id]; reject(NoEngine('the office engine took too long')); }, ms || 120000);
      enginePending[id] = { resolve: function (v) { clearTimeout(t); resolve(v); }, reject: function (e) { clearTimeout(t); reject(e); } };
      var msg = Object.assign({ type: type, id: id }, data);
      if (data.inputData) w.postMessage(msg, [data.inputData.buffer]); else w.postMessage(msg);
    });
  }
  async function officeConvert(file) {
    if (window.W2P_TEST_ENGINE) return window.W2P_TEST_ENGINE(file);           // used by our automated tests only
    var bytes = new Uint8Array(await file.arrayBuffer()), ext = extOf(file.name);
    var local = ext === 'docx' ? await localApi() : false;
    if (local) {
      var r = await fetch('/api/word-to-pdf', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: bytes });
      if (!r.ok) throw new Error(((await r.json().catch(function () { return {}; })).error) || 'Local conversion failed.');
      return new Uint8Array(await r.arrayBuffer());
    }
    if (ext === 'txt') { bytes = new Uint8Array(await (await txtToDocx(file)).arrayBuffer()); ext = 'docx'; }   // A4 page, like Word
    var w = await loadEngine();
    var out = await engineCall(w, 'convert', { inputData: bytes, inputExt: ext, outputFormat: 'pdf', filterOptions: '' }, window.W2P_ENGINE_MS || 180000);
    out = out instanceof Uint8Array ? out : new Uint8Array(out);
    if (out.length < 5 || out[0] !== 0x25 || out[1] !== 0x50) throw new Error('The office engine returned an empty file.');
    return out;
  }

  /* ── Convert ───────────────────────────────────────────── */
  function step(i, n, name, sub) { if (window.PDLoader) window.PDLoader.update(n > 1 ? 'Converting ' + (i + 1) + ' of ' + n + '…' : 'Converting to PDF…', sub || name); }
  async function run() {
    if (!st.files.length || st.busy) return;
    st.busy = true; st.merged = null;
    var files = st.files.slice(), failed = [], quick = false;
    st.lastFiles = files.slice();
    if (window.PDLoader) window.PDLoader.show('Converting to PDF…', files[0].name);
    try {
      if (!window.PDFLib) await loadScript(PDFLIB_URL);
      var useOffice = !!window.W2P_TEST_ENGINE || !!(await localApi()) || engineWanted();
      if (useOffice && !window.W2P_TEST_ENGINE && !(await localApi())) {
        var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, skipped = false;
        try {
          var first = !engine && !(await engineCached());
          var skip = function () { skipped = true; if (ctl) ctl.abort(); };
          if (window.PDLoader) {
            window.PDLoader.show(first ? 'Getting the office engine…' : 'Starting the office engine…', first ? 'First time only, about 75 MB. Next time it opens from your browser.' : files[0].name, first ? skip : null);
            var cb = document.querySelector('.pd-loader-cancel'); if (cb) cb.textContent = 'Skip, use quick mode';
          }
          var keys = {};
          if (!window.JSZip) await loadScript(JSZIP_URL);
          for (var fi = 0; fi < files.length; fi++) if (/\.docx$/i.test(files[fi].name)) neededSets(await fontsOf(await files[fi].arrayBuffer())).forEach(function (k) { if (k === 'nastaliq' || k === 'naskh') keys[k] = 1; });
          var fontList = engine ? null : await fetchFontFiles(Object.keys(keys));
          await loadEngine(fontList, function (pc) { if (window.PDLoader && first) window.PDLoader.update('Getting the office engine… ' + pc + '%', 'First time only, about 75 MB. Next time it opens from your browser.'); }, ctl && ctl.signal);
          if (window.PDLoader) { window.PDLoader.show('Converting to PDF…', files[0].name); }
        }
        catch (e) {
          console.warn(e); useOffice = false;
          if (!skipped && !(e && e.name === 'AbortError')) markEngineFail();
          if (window.PDLoader) window.PDLoader.show('Converting to PDF…', files[0].name);
        }
      }
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        step(i, files.length, f.name);
        try {
          var pdf;
          var viaQuick = !useOffice;
          if (useOffice) {
            try { pdf = await officeConvert(f); }
            catch (oe) { if (!/\.(docx|txt)$/i.test(f.name) || window.W2P_TEST_ENGINE) throw oe; console.warn(oe); viaQuick = true; }
          }
          if (!viaQuick) { }
          else if (/\.(docx|txt)$/i.test(f.name)) {
            var src = /\.txt$/i.test(f.name) ? await txtToDocx(f) : f;
            pdf = await quickConvert(src, function (t) { step(i, files.length, f.name, t); }); quick = true;
          }
          else throw new Error('the office engine is needed for DOC, ODT and RTF files and it could not start in this browser. Save the file as DOCX in Word (File > Save As) and add it again');
          var doc = await window.PDFLib.PDFDocument.load(pdf, { ignoreEncryption: true });
          var p0 = doc.getPage(0).getSize();
          st.results.push({ name: baseOf(f.name) + '.pdf', src: f.name, bytes: pdf, pages: doc.getPageCount(), w: p0.width, h: p0.height, quick: !useOffice });
        } catch (e) { console.error(e); failed.push(f.name + ': ' + (e && e.message ? e.message : 'could not be converted')); }
      }
      showResult(failed, quick);
    } catch (e) {
      console.error(e); say('Conversion stopped: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    } finally {
      st.busy = false; st.files = [];
      if (window.PDLoader) window.PDLoader.hide();
    }
  }
  async function combine() {
    if (st.results.length < 2) return;
    if (window.PDLoader) window.PDLoader.show('Combining into one PDF…', st.results.length + ' files');
    try {
      var out = await window.PDFLib.PDFDocument.create();
      for (var k = 0; k < st.results.length; k++) {
        var src = await window.PDFLib.PDFDocument.load(st.results[k].bytes, { ignoreEncryption: true });
        (await out.copyPages(src, src.getPageIndices())).forEach(function (pg) { out.addPage(pg); });
      }
      st.merged = { name: baseOf(st.results[0].src) + '-combined.pdf', bytes: new Uint8Array(await out.save()), pages: out.getPageCount() };
      save(st.merged.bytes, st.merged.name);
    } finally { if (window.PDLoader) window.PDLoader.hide(); }
  }

  /* ── Quick engine (browsers that can't run the office engine): the Word page is drawn
        in the page, saved as a picture per PDF page, with the words added as invisible,
        selectable text on top so the PDF can still be searched and copied. ── */
  // ---- Word rules the preview library skips: right-to-left paragraphs, Urdu/Arabic bold, size and font, OLE pictures ----
  var WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var RTL_CH = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  function kid(el, name) { if (!el) return null; for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; }
  function wattr(el, name) { return el ? (el.getAttributeNS(WNS, name) || el.getAttribute('w:' + name)) : null; }
  function onOff(el) { if (!el) return null; var v = wattr(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); }
  function wset(el, name, v) { el.setAttributeNS(WNS, 'w:' + name, v); }
  function ensure(doc, parent, name, front) {
    var e = kid(parent, name); if (e) return e;
    e = doc.createElementNS(WNS, 'w:' + name);
    if (front && parent.firstChild) parent.insertBefore(e, parent.firstChild); else parent.appendChild(e);
    return e;
  }
  async function prepDocx(buf) {
    try {
      var zip = await window.JSZip.loadAsync(buf), dp = new DOMParser(), xs = new XMLSerializer();
      var S = {}, defR = null, defP = null, defPara = null, theme = {};
      var sf = zip.file('word/styles.xml');
      if (sf) {
        var sd = dp.parseFromString(await sf.async('string'), 'application/xml');
        var dd = sd.getElementsByTagNameNS(WNS, 'docDefaults')[0];
        if (dd) { defR = kid(kid(dd, 'rPrDefault'), 'rPr'); defP = kid(kid(dd, 'pPrDefault'), 'pPr'); }
        Array.from(sd.getElementsByTagNameNS(WNS, 'style')).forEach(function (s) {
          var id = wattr(s, 'styleId'); if (!id) return;
          S[id] = { based: wattr(kid(s, 'basedOn'), 'val'), rPr: kid(s, 'rPr'), pPr: kid(s, 'pPr') };
          if (wattr(s, 'type') === 'paragraph' && wattr(s, 'default') === '1') defPara = id;
        });
        // the preview library lets the document defaults beat the Normal style on every run (Word does the reverse):
        // copy the Normal style's run settings into the defaults
        var nR = defPara && S[defPara] && S[defPara].rPr;
        if (nR && dd) {
          var rpd = kid(dd, 'rPrDefault') || dd.appendChild(sd.createElementNS(WNS, 'w:rPrDefault'));
          var dR = kid(rpd, 'rPr') || rpd.appendChild(sd.createElementNS(WNS, 'w:rPr'));
          Array.from(nR.children).forEach(function (c) {
            var old = kid(dR, c.localName), cp = c.cloneNode(true);
            if (c.localName === 'rFonts' && old) {
              var m = old.cloneNode(true), th = { ascii: 'asciiTheme', hAnsi: 'hAnsiTheme', cs: 'cstheme', eastAsia: 'eastAsiaTheme' };
              Array.from(c.attributes).forEach(function (a) { m.setAttributeNS(a.namespaceURI, a.name, a.value); var t = th[a.localName]; if (t) { m.removeAttributeNS(WNS, t); m.removeAttribute('w:' + t); } });
              cp = m;
            }
            if (old) dR.replaceChild(cp, old); else dR.appendChild(cp);
          });
          defR = dR;
          zip.file('word/styles.xml', xs.serializeToString(sd));
        }
      }
      var tf = zip.file('word/theme/theme1.xml');
      if (tf) {
        var th = await tf.async('string');
        ['minor', 'major'].forEach(function (k) {
          var m = new RegExp('<a:' + k + 'Font>([\\s\\S]*?)</a:' + k + 'Font>').exec(th); if (!m) return;
          var ar = /<a:font script="Arab" typeface="([^"]+)"/.exec(m[1]), cs = /<a:cs typeface="([^"]*)"/.exec(m[1]);
          theme[k] = (ar && ar[1]) || (cs && cs[1]) || '';
        });
      }
      function chain(id) { var out = [], n = 0; while (id && S[id] && n++ < 12) { out.push(S[id]); id = S[id].based; } return out; }
      function lookR(name, rPr, rStyle, pStyle) {     // direct → character style → paragraph style → defaults
        var e = kid(rPr, name); if (e) return e;
        var lists = [chain(rStyle), chain(pStyle)];
        for (var a = 0; a < lists.length; a++) for (var b = 0; b < lists[a].length; b++) { e = kid(lists[a][b].rPr, name); if (e) return e; }
        return kid(defR, name);
      }
      function lookP(name, pPr, pStyle) {
        var e = kid(pPr, name); if (e) return e;
        var l = chain(pStyle); for (var b = 0; b < l.length; b++) { e = kid(l[b].pPr, name); if (e) return e; }
        return kid(defP, name);
      }
      // Word bullets drawn with the Symbol/Wingdings fonts: use the same shapes from normal fonts
      var nf = zip.file('word/numbering.xml'), numInd = {};
      if (nf) {
        var nx = await nf.async('string'), BUL = { '\uF0B7': '\u2022', '\uF0A7': '\u25AA', '\uF0D8': '\u27A2', '\uF0FC': '\u2713', '\uF076': '\u2756', '\uF0A8': '\u25A1', '\uF06F': '\u25CB', '\uF0E8': '\u2794' };
        var nx2 = nx.replace(/<w:lvlText w:val="([\uF000-\uF0FF])"\/>/g, function (m, c) { return '<w:lvlText w:val="' + (BUL[c] || '\u2022') + '"/>'; })
          .replace(/<w:rFonts [^>]*w:(?:ascii|hAnsi)="(?:Symbol|Wingdings)"[^>]*\/>/g, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>');
        if (nx2 !== nx) zip.file('word/numbering.xml', nx2);
        try {
          var nd = dp.parseFromString(nx2, 'application/xml'), absInd = {};
          Array.from(nd.getElementsByTagNameNS(WNS, 'abstractNum')).forEach(function (a) {
            var id = wattr(a, 'abstractNumId'); absInd[id] = {};
            Array.from(a.getElementsByTagNameNS(WNS, 'lvl')).forEach(function (l) { var ind = kid(kid(l, 'pPr'), 'ind'); if (ind) absInd[id][wattr(l, 'ilvl')] = ind; });
          });
          Array.from(nd.getElementsByTagNameNS(WNS, 'num')).forEach(function (n) { numInd[wattr(n, 'numId')] = absInd[wattr(kid(n, 'abstractNumId'), 'val')] || {}; });
        } catch (e) { }
      }
      var names = Object.keys(zip.files).filter(function (n) { return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n); });
      var mark = 0, kn = 0, fields = 0;
      for (var ni = 0; ni < names.length; ni++) {
        var doc = dp.parseFromString(await zip.file(names[ni]).async('string'), 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) continue;
        // embedded objects (logos, pasted pictures) carry a VML preview picture: show it as a picture
        Array.from(doc.getElementsByTagNameNS(WNS, 'object')).forEach(function (o) {
          var pict = doc.createElementNS(WNS, 'w:pict');
          Array.from(o.childNodes).forEach(function (c) { if (c.localName !== 'OLEObject') pict.appendChild(c); });
          o.parentNode.replaceChild(pict, o);
        });
        Array.from(doc.getElementsByTagNameNS(WNS, 'p')).forEach(function (p) {
          var pPr = kid(p, 'pPr'), pStyle = wattr(kid(pPr, 'pStyle'), 'val') || defPara;
          if (onOff(lookP('bidi', pPr, pStyle))) {
            if (!pPr) pPr = ensure(doc, p, 'pPr', true);
            var jcEl = lookP('jc', pPr, pStyle), v = wattr(jcEl, 'val') || 'left';
            // in a right-to-left paragraph Word reads left/right as start/end
            var nv = (v === 'left' || v === 'start') ? 'right' : (v === 'right' || v === 'end') ? 'left' : v;
            wset(ensure(doc, pPr, 'jc'), 'val', nv);
            var bm = doc.createElementNS(WNS, 'w:bookmarkStart'); wset(bm, 'id', String(900000 + mark)); wset(bm, 'name', 'pdrtl' + (mark++));
            pPr.nextSibling ? p.insertBefore(bm, pPr.nextSibling) : p.appendChild(bm);
          }
        });
        // lists that come from the paragraph style (List Bullet, List Number): give the paragraph its own list setting
        Array.from(doc.getElementsByTagNameNS(WNS, 'p')).forEach(function (p) {
          var pPr = kid(p, 'pPr'); if (kid(pPr, 'numPr')) return;
          var pStyle = wattr(kid(pPr, 'pStyle'), 'val'); if (!pStyle) return;
          var np = null; chain(pStyle).some(function (st2) { np = kid(st2.pPr, 'numPr'); return !!np; });
          if (np && kid(np, 'numId') && wattr(kid(np, 'numId'), 'val') !== '0') {
            if (!pPr) pPr = ensure(doc, p, 'pPr', true);
            var np2 = np.cloneNode(true); if (!kid(np2, 'ilvl')) { var il = doc.createElementNS(WNS, 'w:ilvl'); wset(il, 'val', '0'); np2.insertBefore(il, np2.firstChild); }
            pPr.appendChild(np2);
          }
        });
        Array.from(doc.getElementsByTagNameNS(WNS, 'p')).forEach(function (p) {
          var pPr = kid(p, 'pPr'), np = kid(pPr, 'numPr'); if (!np || kid(pPr, 'ind')) return;
          var ind = (numInd[wattr(kid(np, 'numId'), 'val')] || {})[wattr(kid(np, 'ilvl'), 'val') || '0'];
          if (ind) pPr.appendChild(ind.cloneNode(true));
        });
        // "don't add space between paragraphs of the same style"
        var allP = Array.from(doc.getElementsByTagNameNS(WNS, 'p'));
        allP.forEach(function (p, i) {
          var pPr = kid(p, 'pPr'), sty = wattr(kid(pPr, 'pStyle'), 'val') || defPara;
          if (!onOff(lookP('contextualSpacing', pPr, sty))) return;
          var nx = allP[i + 1]; if (!nx || nx.parentNode !== p.parentNode) return;
          var nPr = kid(nx, 'pPr'), nSty = wattr(kid(nPr, 'pStyle'), 'val') || defPara;
          if (nSty !== sty) return;
          var sp = ensure(doc, pPr || ensure(doc, p, 'pPr', true), 'spacing'); wset(sp, 'after', '0');
          var sp2 = ensure(doc, nPr || ensure(doc, nx, 'pPr', true), 'spacing'); wset(sp2, 'before', '0');
        });
        // headings that Word keeps with the next paragraph
        Array.from(doc.getElementsByTagNameNS(WNS, 'p')).forEach(function (p) {
          var pPr = kid(p, 'pPr'), pStyle = wattr(kid(pPr, 'pStyle'), 'val') || defPara;
          if (!onOff(lookP('keepNext', pPr, pStyle))) return;
          var bm = doc.createElementNS(WNS, 'w:bookmarkStart'); wset(bm, 'id', String(800000 + kn)); wset(bm, 'name', 'pdkn' + (kn++));
          pPr && pPr.nextSibling ? p.insertBefore(bm, pPr.nextSibling) : p.insertBefore(bm, p.firstChild);
        });
        // page number fields: leave a marker that each page fills in
        var FIELD = { PAGE: '\u2460', NUMPAGES: '\u2461', SECTIONPAGES: '\u2461' };
        Array.from(doc.getElementsByTagNameNS(WNS, 'fldSimple')).forEach(function (f) {
          var code = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(wattr(f, 'instr') || ''); if (!code) return;
          var r = doc.createElementNS(WNS, 'w:r'), firstR = kid(f, 'r'), rp = firstR && kid(firstR, 'rPr');
          if (rp) r.appendChild(rp.cloneNode(true));
          var t = doc.createElementNS(WNS, 'w:t'); t.textContent = FIELD[code[1].toUpperCase()]; r.appendChild(t);
          f.parentNode.replaceChild(r, f); fields++;
        });
        Array.from(doc.getElementsByTagNameNS(WNS, 'instrText')).forEach(function (it) {
          var code = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(it.textContent || ''); if (!code) return;
          var all = Array.from(doc.getElementsByTagNameNS(WNS, 'r')), i = all.indexOf(it.parentNode), state = 0, done = false, lastR = it.parentNode;
          for (var j = i + 1; j < all.length && !done; j++) {
            var fc = kid(all[j], 'fldChar'), ty = fc && wattr(fc, 'fldCharType');
            if (ty === 'separate') { state = 1; lastR = all[j]; continue; }
            if (ty === 'end') { done = true; if (state < 2) { var nr = doc.createElementNS(WNS, 'w:r'), rp2 = kid(it.parentNode, 'rPr'); if (rp2) nr.appendChild(rp2.cloneNode(true)); var nt = doc.createElementNS(WNS, 'w:t'); nt.textContent = FIELD[code[1].toUpperCase()]; nr.appendChild(nt); lastR.parentNode.insertBefore(nr, lastR.nextSibling); } break; }
            if (state >= 1) Array.from(all[j].getElementsByTagNameNS(WNS, 't')).forEach(function (t) { t.textContent = state === 1 ? FIELD[code[1].toUpperCase()] : ''; state = 2; });
          }
          it.textContent = ''; fields++;
        });
        Array.from(doc.getElementsByTagNameNS(WNS, 'r')).forEach(function (r) {
          var txt = Array.from(r.getElementsByTagNameNS(WNS, 't')).map(function (t) { return t.textContent; }).join('');
          var rPr = kid(r, 'rPr');
          if (!RTL_CH.test(txt) && !onOff(kid(rPr, 'rtl')) && !onOff(kid(rPr, 'cs'))) return;
          var p = r.parentNode; while (p && p.localName !== 'p') p = p.parentNode;
          var pStyle = (p && wattr(kid(kid(p, 'pPr'), 'pStyle'), 'val')) || defPara, rStyle = wattr(kid(rPr, 'rStyle'), 'val');
          // Word uses the complex-script settings (bCs, szCs, cs font) only for runs marked right-to-left;
          // Urdu typed in a run without that mark keeps the run's normal bold, size and font
          if (!onOff(lookR('rtl', rPr, rStyle, pStyle)) && !onOff(lookR('cs', rPr, rStyle, pStyle))) return;
          if (!rPr) rPr = ensure(doc, r, 'rPr', true);
          // Word draws Urdu/Arabic with the complex-script settings: bCs, iCs, szCs and the cs font
          [['b', 'bCs'], ['i', 'iCs']].forEach(function (pr) { wset(ensure(doc, rPr, pr[0]), 'val', onOff(lookR(pr[1], rPr, rStyle, pStyle)) ? '1' : '0'); });
          var szCs = wattr(lookR('szCs', rPr, rStyle, pStyle), 'val');
          if (szCs) wset(ensure(doc, rPr, 'sz'), 'val', szCs);
          var csFont = null;
          // the cs font may sit on a different level than the Latin one: search for it
          [kid(rPr, 'rFonts')].concat(chain(rStyle).map(function (s) { return kid(s.rPr, 'rFonts'); }), chain(pStyle).map(function (s) { return kid(s.rPr, 'rFonts'); }), [kid(defR, 'rFonts')]).some(function (e) {
            if (!e) return false;
            if (wattr(e, 'cs')) { csFont = wattr(e, 'cs'); return true; }
            var t = wattr(e, 'cstheme'); if (t) { csFont = theme[/major/i.test(t) ? 'major' : 'minor'] || null; return !!csFont; }
            return false;
          });
          if (csFont) {
            var rf = ensure(doc, rPr, 'rFonts');
            ['asciiTheme', 'hAnsiTheme'].forEach(function (a) { rf.removeAttributeNS(WNS, a); rf.removeAttribute('w:' + a); });
            wset(rf, 'ascii', csFont); wset(rf, 'hAnsi', csFont);
          }
        });
        zip.file(names[ni], xs.serializeToString(doc));
      }
      // "snap to grid" (Asian and many Urdu templates): each line is the grid pitch times the line spacing
      try {
        var dxml = await zip.file('word/document.xml').async('string'), gm = /<w:docGrid [^>]*w:type="(lines|linesAndChars)"[^>]*w:linePitch="(\d+)"/.exec(dxml) || /<w:docGrid [^>]*w:linePitch="(\d+)"[^>]*w:type="(lines|linesAndChars)"/.exec(dxml);
        var pitch = gm ? Number(/^\d+$/.test(gm[1]) ? gm[1] : gm[2]) : 0;
        if (pitch > 120) {
          var gdoc = dp.parseFromString(dxml, 'application/xml');
          Array.from(gdoc.getElementsByTagNameNS(WNS, 'p')).forEach(function (p) {
            var pPr = kid(p, 'pPr'), sty = wattr(kid(pPr, 'pStyle'), 'val') || defPara;
            if (lookP('snapToGrid', pPr, sty) && !onOff(lookP('snapToGrid', pPr, sty))) return;
            var spEl = lookP('spacing', pPr, sty), rule = wattr(spEl, 'lineRule') || 'auto', ln = Number(wattr(spEl, 'line') || 240);
            if (rule !== 'auto') return;
            // biggest letters on the line decide how many grid rows it takes
            var big = 0;
            Array.from(p.getElementsByTagNameNS(WNS, 'r')).forEach(function (r) {
              var rp = kid(r, 'rPr'), rs = wattr(kid(rp, 'rStyle'), 'val'), sz = Number(wattr(lookR('sz', rp, rs, sty), 'val') || 22);
              if (r.getElementsByTagNameNS(WNS, 't').length) big = Math.max(big, sz);
            });
            if (!big) big = Number(wattr(lookR('sz', kid(pPr, 'rPr'), null, sty), 'val') || 22);
            var natural = big * 10 * 1.15, rows = Math.max(1, Math.ceil(natural / pitch - 0.02));
            if (!pPr) pPr = ensure(gdoc, p, 'pPr', true);
            var sp = ensure(gdoc, pPr, 'spacing'); wset(sp, 'line', String(Math.round(rows * pitch * ln / 240))); wset(sp, 'lineRule', 'exact');
          });
          dxml = xs.serializeToString(gdoc); zip.file('word/document.xml', dxml);
        }
      } catch (e) { }
      var foot = /<w:pgMar [^>]*w:footer="(\d+)"/.exec(await zip.file('word/document.xml').async('string'));
      return { buf: await zip.generateAsync({ type: 'arraybuffer' }), rtl: mark, keep: kn, fields: fields, footerDist: foot ? Number(foot[1]) / 15 : 48 };
    } catch (e) { return { buf: buf, rtl: 0, keep: 0, fields: 0, footerDist: 48 }; }
  }

  // quick engine: fonts the file asks for but this device lacks get an open look-alike (as data, so the page renderer can use it)
  var fontData = {};
  function hasLocal(name) {
    if (window.W2P_NO_LOCAL) return false;                       // tests only
    try {
      var c = document.createElement('canvas').getContext('2d'), t = 'mmmmmmmmmmlli WQ 1234567890 ابجد';
      return ['monospace', 'serif', 'sans-serif'].some(function (b) {
        c.font = '72px ' + b; var w0 = c.measureText(t).width;
        c.font = '72px "' + name.replace(/"/g, '') + '", ' + b; return Math.abs(c.measureText(t).width - w0) > 0.5;
      });
    } catch (e) { return true; }
  }
  async function setData(k) {
    if (fontData[k]) return fontData[k];
    var set = FONT_SETS[k], out = {};
    await Promise.all(Object.keys(set.files).map(function (w) {
      return fetch(fontUrl(set, w), { mode: 'cors' }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
        if (!b) return; return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { out[w] = String(fr.result).replace(/^data:[^;,]*/, 'data:font/ttf'); res(); }; fr.onerror = res; fr.readAsDataURL(b); });
      }).catch(function () { });
    }));
    return (fontData[k] = out);
  }
  function faceCss(family, data, range) {
    var css = '', ws = { r: [400, 'normal'], b: [700, 'normal'], i: [400, 'italic'], bi: [700, 'italic'] };
    Object.keys(data).forEach(function (w) {
      css += '@font-face{font-family:"' + family.replace(/"/g, '') + '";src:url(' + data[w] + ') format("truetype");font-weight:' + ws[w][0] + ';font-style:' + ws[w][1] + ';font-display:block' + (range ? ';unicode-range:' + range : '') + '}';
    });
    return css;
  }
  async function quickFonts(buf, host) {
    var info = await fontsOf(buf), css = '', used = {};
    if (host) Array.from(host.querySelectorAll('p, span, td, li')).forEach(function (e) {
      getComputedStyle(e).fontFamily.split(',').forEach(function (f) { used[f.trim().replace(/^["']|["']$/g, '')] = 1; });
    });
    // only fonts the pages really use, so the page snapshot stays small
    var names = Object.keys(host ? used : info.names).filter(function (n) { return fontKey(n) && !hasLocal(n); }).slice(0, 6);
    for (var i = 0; i < names.length; i++) {
      var k = fontKey(names[i]), d = await setData(k);
      css += faceCss(names[i], d);
      if (info.rtl && k !== 'naskh' && k !== 'nastaliq') css += faceCss(names[i], await setData('naskh'), 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF');
    }
    return css;
  }
  window.__w2pPrep = prepDocx; window.__w2pFonts = quickFonts;
  // Word's "auto" line spacing multiplies the font's own line height; CSS multiplies the font size. Match Word.
  function fixLineHeights(host) {
    var probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;line-height:normal;font-size:100px;white-space:nowrap';
    probe.textContent = 'Hg'; host.appendChild(probe);
    var cache = {};
    var natural = function (fam) { if (!(fam in cache)) { probe.style.fontFamily = fam; cache[fam] = probe.getBoundingClientRect().height / 100; } return cache[fam]; };
    Array.from(host.querySelectorAll('section.docx span')).forEach(function (sp) {
      if (sp.closest('svg') || !sp.textContent) return;
      var cs = getComputedStyle(sp), lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
      if (!lh || !fs || cs.lineHeight === 'normal') return;
      var ratio = lh / fs, n = ratio * 240;
      if (ratio < 0.8 || ratio > 3.5 || Math.abs(n - Math.round(n)) > 0.12) return;   // exact spacing: leave it
      var pp = sp.closest('p'); if (pp && /pt$/.test(pp.style.lineHeight || '')) return;   // the paragraph has a fixed line height
      var nat = natural(cs.fontFamily);
      if (nat > 0.9 && nat < 4) sp.style.lineHeight = String(Math.round(ratio * nat * 1000) / 1000);
    });
    probe.remove();
  }
  var QUALITY = { best: { scale: 2, jpeg: 0.92 }, small: { scale: 1.5, jpeg: 0.72 } };
  // a plain text file becomes a simple Word file (Calibri 11, one paragraph per line) for the quick engine
  async function txtToDocx(file) {
    if (!window.JSZip) await loadScript(JSZIP_URL);
    var text = await file.text(), esc2 = function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    var body = text.replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      var rtl = RTL_CH.test(l);
      return '<w:p><w:pPr>' + (rtl ? '<w:bidi/>' : '') + '<w:spacing w:after="0"/></w:pPr><w:r><w:t xml:space="preserve">' + esc2(l.replace(/\t/g, '    ')) + '</w:t></w:r></w:p>';
    }).join('');
    var z = new window.JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>');
    z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>');
    return new File([await z.generateAsync({ type: 'blob' })], file.name.replace(/\.txt$/i, '.docx'));
  }
  async function quickConvert(file, tick) {
    if (!window.JSZip) await loadScript(JSZIP_URL);
    if (!window.docx) await loadScript(DOCX_PREVIEW);
    if (!window.html2canvas) await loadScript(H2C_URL);
    if (!window.jspdf) await loadScript(JSPDF_URL);
    var host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;background:#fff;pointer-events:none;';   // hidden behind the loader
    document.body.appendChild(host);
    try {
      var prep = await prepDocx(await file.arrayBuffer());
      await window.docx.renderAsync(prep.buf, host, null, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true, experimental: true, useBase64URL: true });
      var faces = '';
      try { faces = await quickFonts(prep.buf, host); } catch (e) { }
      var fix = document.createElement('style');
      fix.textContent = faces + 'section.docx, section.docx *{hyphens:manual !important;-webkit-hyphens:manual !important;-webkit-text-size-adjust:100%;text-size-adjust:100%}section.docx{line-height:normal}body > div[style*="hidden"] > img{display:inline !important}' +
        'section.docx sup,section.docx sub,section.docx span[style*="vertical-align: super"],section.docx span[style*="vertical-align: sub"]{line-height:0}section.docx p div:has(> svg){display:inline-block;vertical-align:baseline}section.docx p div > svg{display:inline-block;vertical-align:baseline}';   // Word does not hyphenate by itself
      host.appendChild(fix);

      if (window.W2P_KEEP) window.__w2pHost = host;
      for (var m = 0; m < prep.rtl; m++) {
        var mk = host.querySelector('[id="pdrtl' + m + '"]'), pe = mk && mk.closest('p');
        if (pe) {
          pe.dir = 'rtl'; pe.style.direction = 'rtl';
          var cs0 = getComputedStyle(pe), ml = cs0.marginLeft, mr = cs0.marginRight;
          if (ml !== mr) { pe.style.setProperty('margin-left', mr, 'important'); pe.style.setProperty('margin-right', ml, 'important'); }
        }
      }
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1500); })]);
      await new Promise(function (r) { setTimeout(r, 120); });
      if (!window.W2P_NO_LH) fixLineHeights(host);
      await new Promise(function (r) { setTimeout(r, 60); });
      var secs = Array.from(host.querySelectorAll('section.docx'));
      if (!secs.length) throw new Error('nothing to show in this file');
      var q = QUALITY[st.quality] || QUALITY.best;
      var useFO = !window.W2P_NO_FO && !/^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      var snap = async function (el, w, h, check) {
        var o = { scale: q.scale, backgroundColor: '#ffffff', logging: false, useCORS: true, width: w, height: h, windowWidth: (secs[0].offsetWidth || w) + 40,
          // the page snapshot only carries what is inside it, so the fonts are put inside it
          onclone: function (d, el2) {
            // the snapshot measures letter positions with a tiny picture: the site's img{display:block} would push every word down
            var z0 = d.createElement('style'); z0.textContent = 'body > div[style*="hidden"] > img{display:inline !important}'; (d.head || d.documentElement).appendChild(z0);
            if (faces && el2) { var z = d.createElement('style'); z.textContent = faces; el2.insertBefore(z, el2.firstChild); }
          } };
        if (useFO) {
          try {
            var cv = await window.html2canvas(el, Object.assign({ foreignObjectRendering: true }, o));
            if (!check) return cv;
            var px = cv.getContext('2d').getImageData(0, 0, cv.width, Math.min(cv.height, 2400)).data, dark = 0;
            for (var qq = 0; qq < px.length; qq += 400) if (px[qq] < 200) { dark++; if (dark > 20) break; }
            if (dark > 20) return cv;
            useFO = false;                                   // came out blank: use the other renderer from now on
          } catch (e) { useFO = false; }
        }
        return window.html2canvas(el, o);
      };
      // a header or footer is drawn from a copy placed at the top of a blank page of the same kind
      var snapPart = async function (sec, el, r) {
        var tmp = document.createElement('section'); tmp.className = sec.className;
        tmp.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;background:#fff;width:' + r.width + 'px;min-height:0;height:' + Math.ceil(r.height) + 'px;overflow:hidden';
        var cl = el.cloneNode(true); cl.style.margin = '0'; cl.style.visibility = 'visible'; tmp.appendChild(cl);
        sec.parentNode.appendChild(tmp);
        try { return await snap(tmp, r.width, Math.ceil(r.height), false); } finally { tmp.remove(); }
      };
      // 1) work out every page of every section first (page numbers need the total)
      var plan = [];
      secs.forEach(function (sec) {
        var cs = getComputedStyle(sec), srect = sec.getBoundingClientRect();
        var pw = sec.offsetWidth, ph = parseFloat(cs.minHeight) || pw * 1.294;
        var pt = parseFloat(cs.paddingTop) || 72, pb = parseFloat(cs.paddingBottom) || 72;
        var art = sec.querySelector(':scope > article') || sec, header = sec.querySelector(':scope > header'), footer = sec.querySelector(':scope > footer');
        var rel = function (e) { var b = e.getBoundingClientRect(); return { top: b.top - srect.top, bottom: b.bottom - srect.top, left: b.left - srect.left, width: b.width, height: b.height }; };
        var ar = rel(art), top0 = Math.max(pt, ar.top), contentH = ph - pt - pb;
        var endY = top0;
        Array.from(art.children).forEach(function (e) { var b = rel(e); if (b.height) endY = Math.max(endY, b.bottom); });
        var words = textBoxes(art, srect);
        // things a page must not cut through: pictures and table rows (when they fit on a page)
        var blocks = Array.from(art.querySelectorAll('img, svg, canvas, tr')).map(rel).filter(function (b) { return b.height > 2 && b.height < contentH * 0.9; });
        var keeps = Array.from(art.querySelectorAll('[id^="pdkn"]')).map(function (m) { return m.closest('p'); }).filter(Boolean);
        var cuts = [top0], y = top0;
        while (endY > y + contentH + 1 && cuts.length < 500) {
          var target = y + contentH, cut = target;
          for (var pass = 0; pass < 3; pass++) {
            words.forEach(function (w) { if (w.top < cut && w.bottom > cut) cut = Math.min(cut, w.top - 1); });
            blocks.forEach(function (b) { if (b.top < cut - 1 && b.bottom > cut + 1) cut = Math.min(cut, b.top - 1); });
            // a heading (keep with next) is never the last thing on a page
            keeps.forEach(function (pe) {
              var b = rel(pe), nx = pe.nextElementSibling, nb = nx ? rel(nx) : null;
              if (b.top > y + 2 && b.top < cut && (b.bottom > cut - 2 || !nb || nb.top >= cut - 2)) cut = Math.min(cut, b.top - 1);
            });
          }
          // Word's widow/orphan rule: never leave a single line of a paragraph alone at the bottom or top of a page
          var byP = new Map();
          words.forEach(function (w) { if (!w.p || w.p.closest('td')) return; var a = byP.get(w.p); if (!a) byP.set(w.p, a = {}); a[Math.round(w.top)] = 1; });
          byP.forEach(function (lines) {
            var tops = Object.keys(lines).map(Number).sort(function (a, b) { return a - b; });
            var before = tops.filter(function (t) { return t < cut; }), after = tops.length - before.length;
            if (!before.length || !after || before[0] <= y + 1) return;
            if (before.length === 1) cut = Math.min(cut, before[0] - 1);                       // orphan: move the whole paragraph
            else if (after === 1) cut = Math.min(cut, before[before.length - 1] - 1);           // widow: take one more line along
          });
          if (cut <= y + 20) cut = target;                   // something taller than a page: cut where it falls
          cuts.push(cut); y = cut;
        }
        cuts.push(Math.max(endY, y + 1));
        for (var c = 0; c < cuts.length - 1; c++) plan.push({ sec: sec, pw: pw, ph: ph, pt: pt, y0: cuts[c], y1: cuts[c + 1], words: words, header: header, footer: footer, rel: rel });
      });
      var total = plan.length;
      // 2) draw: body once per section, header and footer per page when they hold page numbers
      var pdf = null, bodyCanvas = null, bodySec = null, k = q.scale;
      var markMap = new Map();
      var marks = function (el) { if (!el) return false; if (!markMap.has(el)) markMap.set(el, /[①②]/.test(el.textContent)); return markMap.get(el); };
      var setNums = function (el, n) {
        if (!el) return;
        var tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t;
        while ((t = tw.nextNode())) { if (t.__orig === undefined) t.__orig = t.nodeValue; if (/[①②]/.test(t.__orig)) t.nodeValue = t.__orig.replace(/①/g, String(n)).replace(/②/g, String(total)); }
      };
      var hfCache = new Map();
      for (var pi = 0; pi < plan.length; pi++) {
        var P = plan[pi], pw = P.pw, ph = P.ph;
        tick && tick('Drawing page ' + (pi + 1) + ' of ' + total + '…');
        if (bodySec !== P.sec) {
          if (bodyCanvas) bodyCanvas.width = bodyCanvas.height = 0;
          [P.header, P.footer].forEach(function (e) { if (e) e.style.visibility = 'hidden'; });
          bodyCanvas = await snap(P.sec, pw, P.sec.scrollHeight, true);
          [P.header, P.footer].forEach(function (e) { if (e) e.style.visibility = ''; });
          bodySec = P.sec;
        }
        var page = document.createElement('canvas'); page.width = Math.round(pw * k); page.height = Math.round(ph * k);
        var g = page.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, page.width, page.height);
        var drawTop = P.pt;
        if (pi === 0 || plan[pi - 1].sec !== P.sec) drawTop = P.y0;   // first page of a section keeps its own top
        var lastOfSec = pi === plan.length - 1 || plan[pi + 1].sec !== P.sec;
        // last page of a section: a little extra room so letters that hang below the line are not clipped
        var srcH = Math.min(P.y1 - P.y0 + (lastOfSec ? 30 : 0), ph - drawTop - 4);
        var kb = bodyCanvas.width / pw, kh = bodyCanvas.height / P.sec.scrollHeight;    // the snapshot's real scale
        g.drawImage(bodyCanvas, 0, P.y0 * kh, bodyCanvas.width, srcH * kh, 0, drawTop * k, page.width, srcH * k);
        // header at its own place, footer at the footer distance from the bottom
        for (var hf = 0; hf < 2; hf++) {
          var el = hf ? P.footer : P.header; if (!el || !el.textContent.trim() && !el.querySelector('img,svg')) continue;
          var r = P.rel(el), key = el, cv = null;
          if (marks(el)) { setNums(el, pi + 1); cv = await snapPart(P.sec, el, r); }
          else { cv = hfCache.get(key); if (!cv) { cv = await snapPart(P.sec, el, r); hfCache.set(key, cv); } }
          var inner = r.top;                                 // where the footer's own text ends
          Array.from(el.children).forEach(function (c2) { var b2 = P.rel(c2); if (b2.height) inner = Math.max(inner, b2.bottom); });
          var used = Math.max(1, (inner > r.top ? inner : r.bottom) - r.top);
          var yy = hf ? Math.min(ph - prep.footerDist - used, ph - 4 - r.height) : r.top;
          g.drawImage(cv, r.left * k, yy * k, r.width * k, r.height * k);
          if (marks(el)) cv.width = cv.height = 0;
        }
        var wpt = pw * 0.75, hpt = ph * 0.75;
        if (!pdf) pdf = new window.jspdf.jsPDF({ unit: 'pt', format: [wpt, hpt], orientation: wpt > hpt ? 'l' : 'p', compress: true });
        else pdf.addPage([wpt, hpt], wpt > hpt ? 'l' : 'p');
        pdf.addImage(page.toDataURL('image/jpeg', q.jpeg), 'JPEG', 0, 0, wpt, hpt);
        // hidden text so the PDF can be searched and copied
        P.words.forEach(function (w) {
          if (w.top < P.y0 - 1 || w.bottom > P.y1 + 1 || !/^[\x20-\xFF]+$/.test(w.text)) return;
          var yy2 = (w.bottom - P.y0 + drawTop) * 0.75, fs = Math.max(4, (w.bottom - w.top) * 0.75 * 0.85);
          pdf.setFontSize(fs);
          var nat = pdf.getTextWidth(w.text), hs = nat > 0 ? Math.max(0.2, Math.min(3, (w.width * 0.75 * 0.92) / nat)) : 1;
          pdf.text(w.text, w.left * 0.75, yy2 - fs * 0.2, { renderingMode: 'invisible', horizontalScale: hs });
        });
        page.width = page.height = 0;
      }
      if (bodyCanvas) bodyCanvas.width = bodyCanvas.height = 0;
      hfCache.forEach(function (cv) { cv.width = cv.height = 0; });
      return new Uint8Array(pdf.output('arraybuffer'));
    } finally { host.remove(); }
  }
  function textBoxes(root, rr) {
    var out = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n, range = document.createRange();
    while ((n = walker.nextNode())) {
      var t = n.nodeValue, re = /\S+/g, m;
      while ((m = re.exec(t))) {
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        var r = range.getBoundingClientRect();
        if (r.width && r.height) out.push({ text: m[0], left: r.left - rr.left, width: r.width, top: r.top - rr.top, bottom: r.bottom - rr.top, p: n.parentElement && n.parentElement.closest('p') });
      }
    }
    return out;
  }
  function paperName(w, h) {
    var a = Math.min(w, h), b = Math.max(w, h);
    if (Math.abs(a - 612) < 3 && Math.abs(b - 792) < 3) return 'Letter';
    if (Math.abs(a - 595) < 3 && Math.abs(b - 842) < 3) return 'A4';
    if (Math.abs(a - 612) < 3 && Math.abs(b - 1008) < 3) return 'Legal';
    return Math.round(w / 72 * 25.4) + ' × ' + Math.round(h / 72 * 25.4) + ' mm';
  }
  function showResult(failed, quick) {
    var list = $('w2pResults'); list.innerHTML = '';
    st.results.forEach(function (r, i) {
      var row = document.createElement('div'); row.className = 'w2p-file';
      row.innerHTML = '<span class="w2p-ext w2p-pdf">PDF</span><div class="w2p-info"><div class="w2p-name">' + esc(r.name) + '</div><div class="w2p-meta">' + r.pages + (r.pages === 1 ? ' page' : ' pages') + ' · ' + paperName(r.w, r.h) + (r.w > r.h ? ' landscape' : '') + ' · ' + size(r.bytes.length) + '</div></div>' +
        (st.results.length > 1 ? '<button type="button" class="btn btn-secondary btn-sm" data-dl="' + i + '">Download</button>' : '');
      list.appendChild(row);
    });
    var last = st.results[st.results.length - 1];
    if (last) {
      if (st.previewUrl) URL.revokeObjectURL(st.previewUrl);
      st.previewUrl = URL.createObjectURL(new Blob([last.bytes], { type: 'application/pdf' }));
      $('pdfPreview').src = st.previewUrl + '#view=FitH';
    }
    var n = st.results.length;
    $('w2pDownloadMain').textContent = n > 1 ? '⬇️ Download all (ZIP)' : '⬇️ Download PDF';
    $('w2pCombine').hidden = n < 2;
    var notes = failed.length ? ['Not converted: ' + failed.join(' · ')] : [];
    if (quick) notes.push('Made in your browser: pages, fonts, headers and page numbers follow your Word file, but small details (list bullets, text boxes, charts) can differ.');
    $('w2pSmaller').hidden = !quick || !st.lastFiles.length;
    $('w2pSmaller').textContent = st.quality === 'small' ? 'Best quality' : 'Make the file smaller';
    $('w2pResultNote').textContent = notes.join(' ');
    $('w2pResultNote').hidden = !notes.length;
    $('w2pUpload').hidden = n > 0;
    $('resultSection').style.display = n || failed.length ? '' : 'none';
    if (n) say('Your PDF is ready.', 'success'); else say('The file could not be converted.', 'error');
  }
  function save(bytes, name, type) {
    var go = function (n) {
      if (!n) return;
      var u = URL.createObjectURL(new Blob([bytes], { type: type || 'application/pdf' })), a = document.createElement('a');
      a.href = u; a.download = n; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      if (window.CMLogs) try { window.CMLogs.log({ tool: 'Word to PDF', action: 'convert', input: st.files.map(function (f) { return f.name; }).join(', '), output: n, size: bytes.length }); } catch (e) { }
    };
    if (window.CMFilename && window.CMFilename.prompt) window.CMFilename.prompt(name).then(go); else go(name);
  }
  async function downloadMain() {
    if (st.results.length === 1) return save(st.results[0].bytes, st.results[0].name);
    if (!st.results.length) return;
    if (!window.JSZip) await loadScript(JSZIP_URL);
    var z = new JSZip(), used = {};
    st.results.forEach(function (r) { var n = r.name, k = 2; while (used[n]) n = r.name.replace(/\.pdf$/, '') + '-' + (k++) + '.pdf'; used[n] = 1; z.file(n, r.bytes); });
    save(await z.generateAsync({ type: 'uint8array' }), 'word-to-pdf.zip', 'application/zip');
  }

  function resetResult() {
    st.results = []; st.merged = null;
    if (st.previewUrl) { URL.revokeObjectURL(st.previewUrl); st.previewUrl = null; }
    $('pdfPreview').removeAttribute('src');
    $('resultSection').style.display = 'none';
    $('w2pUpload').hidden = false;
  }
  function init() {
    var zone = $('dropZone'), input = $('fileInput');
    if (!zone || !input) return;
    zone.addEventListener('click', function (e) { if (e.target !== input && !st.busy) input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('drag-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('drag-over'); }); });
    zone.addEventListener('drop', function (e) { addFiles(e.dataTransfer && e.dataTransfer.files); });
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    $('w2pResults').addEventListener('click', function (e) { var b = e.target.closest('[data-dl]'); if (b) { var r = st.results[+b.dataset.dl]; save(r.bytes, r.name); } });
    $('w2pDownloadMain').addEventListener('click', downloadMain);
    $('w2pCombine').addEventListener('click', combine);
    $('w2pSmaller').addEventListener('click', function () {
      if (st.busy || !st.lastFiles.length) return;
      st.quality = st.quality === 'small' ? 'best' : 'small';
      st.results = []; st.files = st.lastFiles.slice(); run();
    });
    $('w2pAgain').addEventListener('click', function () { if (!st.busy) resetResult(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.WordToPDF = { add: addFiles, run: run };
})();
