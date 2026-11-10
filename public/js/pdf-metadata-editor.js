/* PDFdukan – PDF Metadata Editor
 * Reads and edits the document information dictionary (Title, Author, Subject, Keywords,
 * Creator, Producer, CreationDate, ModDate, Trapped, custom keys), the catalog /Lang and
 * DisplayDocTitle, and keeps the XMP metadata packet in step with those fields.
 * Everything runs in the browser with pdf-lib; restricted PDFs are decrypted with qpdf.
 */
(function () {
  'use strict';
  var JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var MAX_FILES = 20, MAX_MB = 200;
  var STD = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];
  var NS = { rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', dc: 'http://purl.org/dc/elements/1.1/', pdf: 'http://ns.adobe.com/pdf/1.3/', xmp: 'http://ns.adobe.com/xap/1.0/', pdfx: 'http://ns.adobe.com/pdfx/1.3/', x: 'adobe:ns:meta/', xml: 'http://www.w3.org/XML/1998/namespace', xmlns: 'http://www.w3.org/2000/xmlns/' };
  var IDS = { title: 'mdTitle', author: 'mdAuthor', subject: 'mdSubject', keywords: 'mdKeywords', creator: 'mdCreator', producer: 'mdProducer', created: 'mdCreated', modified: 'mdModified', lang: 'mdLang', trapped: 'mdTrapped' };
  var SHARED = ['author', 'subject', 'keywords', 'creator', 'producer', 'lang', 'trapped'];
  var $ = function (id) { return document.getElementById(id); };
  var st = { files: [], active: 0, busy: false, seq: 0 };

  function say(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 3500); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function clean(v) { return String(v || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) { return d && !isNaN(d) ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) : ''; }
  function parsePdfDate(s) {
    var m = /D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+\-])?(\d{2})?'?(\d{2})?/.exec(String(s || ''));
    if (!m) return null;
    var t = Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0);
    if (m[7] === '+' || m[7] === '-') { var off = ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000; t += m[7] === '+' ? -off : off; }
    else if (!m[7]) { var d = new Date(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0); return d; }
    return new Date(t);
  }

  /* ---------- reading ---------- */
  function txt(obj) {
    var L = PDFLib;
    if (obj instanceof L.PDFString || obj instanceof L.PDFHexString) return obj.decodeText();
    if (obj instanceof L.PDFName) return obj.decodeText ? obj.decodeText() : String(obj).replace(/^\//, '');
    if (obj && obj.asNumber) return String(obj.asNumber());
    if (obj instanceof L.PDFBool) return String(obj.asBoolean ? obj.asBoolean() : obj);
    return '';
  }
  function readXmp(doc) {
    var L = PDFLib, ref = doc.catalog.get(L.PDFName.of('Metadata'));
    if (!ref) return null;
    try {
      var s = doc.context.lookup(ref);
      var bytes = s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : (s.getContents ? s.getContents() : null);
      return bytes ? new TextDecoder('utf-8').decode(bytes) : null;
    } catch (e) { return null; }
  }
  function xmpDom(xml) {
    if (!xml) return null;
    try {
      var d = new DOMParser().parseFromString(xml.replace(/^[\s\S]*?(<\?xpacket|<x:xmpmeta|<rdf:RDF)/, '$1'), 'application/xml');
      if (d.getElementsByTagName('parsererror').length || !d.getElementsByTagNameNS(NS.rdf, 'RDF').length) return null;
      return d;
    } catch (e) { return null; }
  }
  function xmpGet(dom, ns, local) {
    if (!dom) return '';
    var ds = dom.getElementsByTagNameNS(NS.rdf, 'Description');
    for (var i = 0; i < ds.length; i++) {
      if (ds[i].hasAttributeNS(ns, local)) return ds[i].getAttributeNS(ns, local);
      for (var c = ds[i].firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI === ns && c.localName === local) {
          var li = c.getElementsByTagNameNS(NS.rdf, 'li');
          if (li.length) return Array.prototype.map.call(li, function (x) { return x.textContent.trim(); }).join(', ');
          return c.textContent.trim();
        }
      }
    }
    return '';
  }
  function readFields(doc) {
    var L = PDFLib, info = doc.getInfoDict(), get = function (k) { var v = info.lookup(L.PDFName.of(k)); return v ? clean(txt(v)) : ''; };
    var dget = function (k) { var v = info.lookup(L.PDFName.of(k)); if (!v) return ''; var d = null; try { d = v instanceof L.PDFString ? v.decodeDate() : null; } catch (e) {} if (!d) d = parsePdfDate(txt(v)); return toLocalInput(d); };
    var xml = readXmp(doc), dom = xmpDom(xml);
    var F = {
      title: get('Title'), author: get('Author'), subject: get('Subject'), keywords: get('Keywords'),
      creator: get('Creator'), producer: get('Producer'), created: dget('CreationDate'), modified: dget('ModDate'),
      trapped: get('Trapped'), lang: '', custom: [], showTitle: false
    };
    var lang = doc.catalog.lookup(L.PDFName.of('Lang')); if (lang) F.lang = clean(txt(lang));
    info.keys().forEach(function (k) { var n = k.decodeText ? k.decodeText() : String(k).slice(1); if (STD.indexOf(n) < 0) F.custom.push([n, clean(txt(info.lookup(k)))]); });
    try { var vp = doc.catalog.lookup(L.PDFName.of('ViewerPreferences')); if (vp) { var dt = vp.lookup(L.PDFName.of('DisplayDocTitle')); F.showTitle = !!(dt && dt.asBoolean && dt.asBoolean()); } } catch (e) {}
    if (!/^(True|False|Unknown)$/.test(F.trapped)) F.trapped = '';
    var X = { has: !!xml, ok: !!dom, title: xmpGet(dom, NS.dc, 'title'), author: xmpGet(dom, NS.dc, 'creator'), pdfa: xmpGet(dom, 'http://www.aiim.org/pdfa/ns/id/', 'part') };
    // fill gaps from XMP when the Info dictionary is empty
    if (dom) {
      if (!F.title) F.title = X.title; if (!F.author) F.author = X.author;
      if (!F.subject) F.subject = xmpGet(dom, NS.dc, 'description');
      if (!F.keywords) F.keywords = xmpGet(dom, NS.pdf, 'Keywords');
      if (!F.creator) F.creator = xmpGet(dom, NS.xmp, 'CreatorTool');
      if (!F.producer) F.producer = xmpGet(dom, NS.pdf, 'Producer');
      if (!F.created) F.created = toLocalInput(new Date(xmpGet(dom, NS.xmp, 'CreateDate') || 'x'));
      if (!F.modified) F.modified = toLocalInput(new Date(xmpGet(dom, NS.xmp, 'ModifyDate') || 'x'));
    }
    return { F: F, X: X };
  }
  function isSigned(doc) {
    try { var L = PDFLib, af = doc.catalog.lookup(L.PDFName.of('AcroForm')); if (!af) return false; var sf = af.lookup(L.PDFName.of('SigFlags')); return !!(sf && sf.asNumber && (sf.asNumber() & 1)); } catch (e) { return false; }
  }

  /* ---------- qpdf ---------- */
  var qw = null, qseq = 0, qwait = {};
  function qpdf(bytes, password) {
    if (!qw) { qw = new Worker('../js/qpdf-worker.js?v=20261110'); qw.onmessage = function (e) { var d = e.data, cb = qwait[d.id]; if (cb) { delete qwait[d.id]; cb(d); } }; }
    return new Promise(function (res) { var id = ++qseq; qwait[id] = res; var b = bytes.slice().buffer; qw.postMessage({ id: id, bytes: b, password: password || '' }, [b]); });
  }

  /* ---------- files ---------- */
  async function openFile(f) {
    var L = PDFLib, doc;
    try { doc = await L.PDFDocument.load(f.bytes, { updateMetadata: false }); }
    catch (e) {
      if (!/encrypt/i.test(String(e && e.message))) throw e;
      var d = await qpdf(f.bytes, f.password || '');
      if (!d.ok) { f.status = 'pw'; f.needPw = true; f.note = f.password ? 'Wrong password, try again' : 'Password needed'; return; }
      f.bytes = new Uint8Array(d.bytes); f.unlocked = true;
      doc = await L.PDFDocument.load(f.bytes, { updateMetadata: false });
    }
    f.needPw = false; f.pages = doc.getPageCount();
    var r = readFields(doc); f.F = r.F; f.X = r.X; f.orig = JSON.parse(JSON.stringify(r.F)); f.signed = isSigned(doc);
    f.status = 'ready'; f.note = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + mb(f.size) + (f.X.has ? ' · XMP' : '') + (f.unlocked ? ' · unlocked' : '');
  }
  async function addFiles(list) {
    if (st.busy) return;
    var arr = Array.prototype.slice.call(list || []), bad = 0;
    for (var i = 0; i < arr.length; i++) {
      var file = arr[i];
      if (st.files.length >= MAX_FILES) { say('Up to ' + MAX_FILES + ' PDFs at a time', 'error'); break; }
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) || !file.size || file.size > MAX_MB * 1048576) { bad++; continue; }
      var f = { id: ++st.seq, name: file.name, size: file.size, status: 'load', note: 'Reading…' };
      st.files.push(f); if (st.files.length === 1) st.active = 0; render();
      try { f.bytes = new Uint8Array(await file.arrayBuffer()); await openFile(f); }
      catch (e) { console.error(e); f.status = 'fail'; f.note = 'Could not read this PDF'; }
      render(); fillForm();
    }
    if (bad) say(bad + ' file' + (bad > 1 ? 's were' : ' was') + ' skipped: PDF only, up to ' + MAX_MB + ' MB', 'error');
  }
  function cur() { return st.files[st.active]; }
  function render() {
    var has = st.files.length > 0;
    $('mdUpload').hidden = has; $('mdEditor').hidden = !has;
    if (!has) { $('mdResult').hidden = true; return; }
    if (st.active >= st.files.length) st.active = st.files.length - 1;
    $('mdCount').textContent = '(' + st.files.length + ')';
    $('mdAll').hidden = st.files.length < 2;
    $('mdSave').textContent = st.files.length > 1 ? 'Save all files' : 'Save metadata';
    $('mdFiles').innerHTML = st.files.map(function (f, i) {
      var pw = f.needPw ? '<div class="md-pw"><input type="password" data-pw="' + f.id + '" placeholder="Password" aria-label="Password for ' + esc(f.name) + '"><button type="button" class="btn btn-secondary" data-a="pw" data-id="' + f.id + '">Unlock</button></div>' : '';
      return '<div class="md-file ' + f.status + (i === st.active ? ' on' : '') + '"><button type="button" class="md-fsel" data-a="sel" data-id="' + f.id + '"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><span>' + esc(f.note) + '</span></button>' + pw +
        '<button type="button" class="md-x" data-a="rm" data-id="' + f.id + '" aria-label="Remove ' + esc(f.name) + '">✕</button></div>';
    }).join('');
    var f = cur(), ready = f && f.F;
    $('mdForm').style.opacity = ready ? '' : '.5';
    Array.prototype.forEach.call($('mdForm').querySelectorAll('input,select,button'), function (el) { el.disabled = !ready || st.busy; });
    var w = [];
    if (f && f.signed) w.push('This PDF has a digital signature. Saving new metadata will make the signature show as invalid.');
    if (f && f.X && f.X.has && !f.X.ok) w.push('This PDF’s XMP metadata could not be read, so a fresh XMP packet will replace it.');
    if (f && f.X && f.X.ok && f.orig && f.X.title && f.orig.title && f.X.title !== f.orig.title) w.push('The XMP title (“' + f.X.title + '”) differs from the document title. Saving with XMP update on makes them match.');
    if (f && f.X && f.X.pdfa) w.push('This is a PDF/A-' + f.X.pdfa + ' file. Its PDF/A label is kept; keep “Also update XMP metadata” on so both copies stay the same.');
    if (f && f.unlocked) w.push('This PDF had restrictions. The saved copy will open without them.');
    $('mdWarn').hidden = !w.length; $('mdWarn').innerHTML = w.map(esc).join('<br>');
    tabPrev();
  }
  function tabPrev() {
    var f = cur(); if (!f || !f.F) { $('mdTabPrev').textContent = ''; return; }
    var t = clean($('mdTitle').value), show = $('mdShowTitle').checked;
    $('mdTabPrev').innerHTML = 'Reader window shows: <b>' + esc(t && show ? t : f.name) + '</b>' + (t && !show ? '<br><span>Tick “Show the title…” to show the title instead.</span>' : '');
  }
  function fillForm() {
    var f = cur(); if (!f || !f.F) return;
    Object.keys(IDS).forEach(function (k) { $(IDS[k]).value = f.F[k] || ''; });
    $('mdShowTitle').checked = !!f.F.showTitle;
    renderCustom(); render();
  }
  function renderCustom() {
    var f = cur(); if (!f || !f.F) { $('mdCustom').innerHTML = ''; return; }
    $('mdCustom').innerHTML = f.F.custom.map(function (kv, i) {
      return '<div class="md-crow"><input class="md-in" data-ck="' + i + '" value="' + esc(kv[0]) + '" placeholder="Name" aria-label="Custom field name"><input class="md-in" data-cv="' + i + '" value="' + esc(kv[1]) + '" placeholder="Value" aria-label="Custom field value"><button type="button" class="md-x" data-cx="' + i + '" aria-label="Remove field">✕</button></div>';
    }).join('');
  }
  function readForm() {
    var f = cur(); if (!f || !f.F) return;
    Object.keys(IDS).forEach(function (k) { f.F[k] = $(IDS[k]).value; });
    f.F.showTitle = $('mdShowTitle').checked;
  }

  /* ---------- writing ---------- */
  function setText(info, k, v) { var L = PDFLib; v = clean(v); if (v) info.set(L.PDFName.of(k), L.PDFHexString.fromText(v)); else info.delete(L.PDFName.of(k)); }
  function setDate(info, k, v) { var L = PDFLib, d = v ? new Date(v) : null; if (d && !isNaN(d)) info.set(L.PDFName.of(k), L.PDFString.fromDate(d)); else info.delete(L.PDFName.of(k)); }
  function keyName(k) { return clean(k).replace(/[^A-Za-z0-9_.-]/g, ''); }
  var FRESH = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  function writeXmp(doc, F, now) {
    var L = PDFLib, cat = doc.catalog, ref = cat.get(L.PDFName.of('Metadata'));
    var dom = xmpDom(readXmp(doc)) || xmpDom(FRESH);
    var rdf = dom.getElementsByTagNameNS(NS.rdf, 'RDF')[0], ds = dom.getElementsByTagNameNS(NS.rdf, 'Description');
    if (!ds.length) { var nd = dom.createElementNS(NS.rdf, 'rdf:Description'); nd.setAttributeNS(NS.rdf, 'rdf:about', ''); rdf.appendChild(nd); }
    var main = ds[0];
    function drop(ns, local) {
      Array.prototype.forEach.call(dom.getElementsByTagNameNS(NS.rdf, 'Description'), function (d) {
        if (local === '*') { Array.prototype.slice.call(d.attributes).forEach(function (a) { if (a.namespaceURI === ns) d.removeAttributeNode(a); }); }
        else if (d.hasAttributeNS(ns, local)) d.removeAttributeNS(ns, local);
        Array.prototype.slice.call(d.children).forEach(function (c) { if (c.namespaceURI === ns && (local === '*' || c.localName === local)) d.removeChild(c); });
      });
    }
    function put(prefix, local, kind, val) {
      var ns = NS[prefix]; drop(ns, local);
      var vals = Array.isArray(val) ? val.filter(Boolean) : [clean(val)].filter(Boolean);
      if (!vals.length) return;
      main.setAttributeNS(NS.xmlns, 'xmlns:' + prefix, ns);
      var el = dom.createElementNS(ns, prefix + ':' + local);
      if (kind === 'text') el.textContent = vals[0];
      else {
        var box = dom.createElementNS(NS.rdf, kind === 'alt' ? 'rdf:Alt' : kind === 'seq' ? 'rdf:Seq' : 'rdf:Bag');
        vals.forEach(function (v) { var li = dom.createElementNS(NS.rdf, 'rdf:li'); if (kind === 'alt') li.setAttributeNS(NS.xml, 'xml:lang', 'x-default'); li.textContent = v; box.appendChild(li); });
        el.appendChild(box);
      }
      main.appendChild(el);
    }
    var iso = function (v) { var d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : ''; };
    var kw = clean(F.keywords);
    put('dc', 'title', 'alt', F.title);
    put('dc', 'creator', 'seq', F.author ? [clean(F.author)] : []);
    put('dc', 'description', 'alt', F.subject);
    put('dc', 'subject', 'bag', kw ? kw.split(/\s*[,;]\s*/) : []);
    put('pdf', 'Keywords', 'text', kw);
    put('pdf', 'Producer', 'text', F.producer);
    put('pdf', 'Trapped', 'text', F.trapped);
    put('xmp', 'CreatorTool', 'text', F.creator);
    put('xmp', 'CreateDate', 'text', iso(F.created));
    put('xmp', 'ModifyDate', 'text', iso(F.modified));
    put('xmp', 'MetadataDate', 'text', now.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    drop(NS.pdfx, '*');
    F.custom.forEach(function (kv) { var k = keyName(kv[0]); if (/^[A-Za-z_]/.test(k) && clean(kv[1])) put('pdfx', k, 'text', kv[1]); });
    var out = new XMLSerializer().serializeToString(dom);
    out = out.replace(/<\?xpacket end=["'][rw]["']\?>\s*$/, '');
    if (!/^<\?xpacket begin/.test(out)) out = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' + out;
    out += '\n' + new Array(21).join(new Array(100).join(' ') + '\n') + '<?xpacket end="w"?>';
    var s = doc.context.stream(new TextEncoder().encode(out), { Type: 'Metadata', Subtype: 'XML' });
    cat.set(L.PDFName.of('Metadata'), doc.context.register(s));
    if (ref instanceof L.PDFRef) doc.context.delete(ref);
  }
  async function build(f, strip) {
    var L = PDFLib, doc = await L.PDFDocument.load(f.bytes, { updateMetadata: false });
    var info = doc.getInfoDict(), cat = doc.catalog, F = f.F, now = new Date();
    if (strip) {
      info.keys().forEach(function (k) { info.delete(k); });
      var ref = cat.get(L.PDFName.of('Metadata'));
      if (ref) { cat.delete(L.PDFName.of('Metadata')); if (ref instanceof L.PDFRef) doc.context.delete(ref); }
    } else {
      setText(info, 'Title', F.title); setText(info, 'Author', F.author); setText(info, 'Subject', F.subject);
      setText(info, 'Keywords', F.keywords); setText(info, 'Creator', F.creator); setText(info, 'Producer', F.producer);
      setDate(info, 'CreationDate', F.created); setDate(info, 'ModDate', F.modified);
      if (F.trapped) info.set(L.PDFName.of('Trapped'), L.PDFName.of(F.trapped)); else info.delete(L.PDFName.of('Trapped'));
      info.keys().forEach(function (k) { var n = k.decodeText ? k.decodeText() : String(k).slice(1); if (STD.indexOf(n) < 0) info.delete(k); });
      F.custom.forEach(function (kv) { var k = keyName(kv[0]); if (k && STD.indexOf(k) < 0 && clean(kv[1])) info.set(L.PDFName.of(k), L.PDFHexString.fromText(clean(kv[1]))); });
      var lang = clean(F.lang); if (lang) cat.set(L.PDFName.of('Lang'), L.PDFString.of(lang.replace(/[^A-Za-z0-9-]/g, ''))); else cat.delete(L.PDFName.of('Lang'));
      var vp = cat.lookup(L.PDFName.of('ViewerPreferences'));
      if (F.showTitle) { if (!vp) { vp = doc.context.obj({}); cat.set(L.PDFName.of('ViewerPreferences'), vp); } vp.set(L.PDFName.of('DisplayDocTitle'), L.PDFBool.True); }
      else if (vp) vp.delete(L.PDFName.of('DisplayDocTitle'));
      if ($('mdXmp').checked) writeXmp(doc, F, now);
    }
    var pdfa1 = f.X && f.X.pdfa === '1'; // PDF/A-1 does not allow object streams
    var out = await doc.save({ useObjectStreams: !pdfa1, updateFieldAppearances: false });
    // verify by reopening the saved bytes
    var chk = await L.PDFDocument.load(out, { updateMetadata: false }), r = readFields(chk);
    if (chk.getPageCount() !== f.pages) throw new Error('verify-pages');
    var msg = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' kept';
    if (strip) { if (r.X.has || r.F.title || r.F.author) throw new Error('verify-strip'); msg += ', all document properties and XMP removed'; }
    else {
      if (clean(r.F.title) !== clean(F.title) || clean(r.F.author) !== clean(F.author)) throw new Error('verify-fields');
      if ($('mdXmp').checked) { if (clean(r.X.title) !== clean(F.title)) throw new Error('verify-xmp'); msg += ', title and XMP match'; }
    }
    return { bytes: out, msg: msg };
  }
  async function save(strip) {
    if (st.busy) return; readForm();
    var list = st.files.filter(function (f) { return f.F && (f.status === 'ready' || f.status === 'done'); });
    if (!list.length) return;
    st.busy = true; render(); $('mdInfo').textContent = 'Saving…';
    var ok = 0, msgs = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try { var r = await build(f, strip); f.out = r.bytes; f.status = 'done'; f.note = 'Saved · ' + mb(r.bytes.length); msgs.push(r.msg); ok++; }
      catch (e) { console.error(e); f.out = null; f.status = 'fail'; f.note = 'Could not save this PDF'; }
    }
    st.busy = false; $('mdInfo').textContent = ''; render();
    if (!ok) { say('Nothing was saved. Try another PDF.', 'error'); return; }
    $('mdRTitle').textContent = strip ? 'Metadata removed' : ok > 1 ? ok + ' PDFs saved' : 'Metadata saved';
    $('mdRInfo').textContent = 'Checked after saving: ' + (ok > 1 ? ok + ' files, ' : '') + msgs[0] + '.' + (ok < list.length ? ' ' + (list.length - ok) + ' file(s) failed.' : '');
    $('mdDl').textContent = ok > 1 ? 'Download all (ZIP)' : 'Download PDF';
    $('mdResult').hidden = false; $('mdResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (window.trackToolUse) window.trackToolUse('pdf-metadata');
  }
  function saveBlob(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); }
  async function download() {
    var done = st.files.filter(function (f) { return f.out; });
    if (!done.length) return;
    if (done.length === 1) return saveBlob(new Blob([done[0].out], { type: 'application/pdf' }), done[0].name.replace(/\.pdf$/i, '') + '.pdf');
    if (typeof JSZip === 'undefined') await loadScript(JSZIP);
    var z = new JSZip(), used = {};
    done.forEach(function (f) { var n = f.name.replace(/\.pdf$/i, '') + '.pdf', k = 2; while (used[n]) n = f.name.replace(/\.pdf$/i, '') + '-' + (k++) + '.pdf'; used[n] = 1; z.file(n, f.out); });
    saveBlob(await z.generateAsync({ type: 'blob' }), 'pdf-metadata.zip');
  }

  /* ---------- wiring ---------- */
  function init() {
    if (!$('mdDrop')) return;
    var dz = $('mdDrop'), inp = $('mdFileInput');
    dz.addEventListener('click', function (e) { if (e.target.closest('.pdz-terms, .cloud-pick, .pdz-foot')) return; inp.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    ['dragover', 'dragenter'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('dragover'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function () { dz.classList.remove('dragover'); }); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
    inp.addEventListener('change', function () { addFiles(inp.files); inp.value = ''; });
    $('mdMoreInput').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    $('mdMore').addEventListener('click', function () { $('mdMoreInput').click(); });
    $('mdReset').addEventListener('click', function () { if (st.busy) return; st.files = []; st.active = 0; render(); });
    $('mdForm').addEventListener('input', function (e) {
      var f = cur(); if (!f || !f.F) return;
      if (e.target.dataset.ck != null) f.F.custom[+e.target.dataset.ck][0] = e.target.value;
      else if (e.target.dataset.cv != null) f.F.custom[+e.target.dataset.cv][1] = e.target.value;
      else readForm();
      $('mdResult').hidden = true; tabPrev();
    });
    $('mdForm').addEventListener('change', function () { readForm(); tabPrev(); });
    $('mdForm').addEventListener('click', function (e) {
      var f = cur(); if (!f || !f.F) return;
      var n = e.target.closest('[data-now]'); if (n) { e.preventDefault(); $(n.dataset.now).value = toLocalInput(new Date()); readForm(); return; }
      var x = e.target.closest('[data-cx]'); if (x) { f.F.custom.splice(+x.dataset.cx, 1); renderCustom(); render(); }
    });
    $('mdAddCustom').addEventListener('click', function () { var f = cur(); if (!f || !f.F) return; f.F.custom.push(['', '']); renderCustom(); render(); var ins = $('mdCustom').querySelectorAll('input[data-ck]'); if (ins.length) ins[ins.length - 1].focus(); });
    $('mdSave').addEventListener('click', function () { save(false); });
    $('mdStrip').addEventListener('click', function () {
      var f = cur(); if (!f || !f.F) return;
      Object.keys(IDS).forEach(function (k) { $(IDS[k]).value = ''; }); readForm(); f.F.custom = []; f.F.showTitle = false; renderCustom();
      st.files.forEach(function (o) { if (o.F) { Object.keys(IDS).forEach(function (k) { o.F[k] = ''; }); o.F.custom = []; o.F.showTitle = false; } });
      save(true);
    });
    $('mdAll').addEventListener('click', function () {
      readForm(); var f = cur(); if (!f || !f.F) return;
      st.files.forEach(function (o) { if (o !== f && o.F) { SHARED.forEach(function (k) { o.F[k] = f.F[k]; }); o.F.custom = JSON.parse(JSON.stringify(f.F.custom)); o.F.showTitle = f.F.showTitle; } });
      say('Author, subject, keywords, apps, language and custom fields copied to all files. Titles and dates stay per file.', 'success');
    });
    $('mdFiles').addEventListener('click', async function (e) {
      var b = e.target.closest('button[data-a]'); if (!b || st.busy) return;
      var i = -1; st.files.forEach(function (f, k) { if (f.id === +b.dataset.id) i = k; }); if (i < 0) return;
      var f = st.files[i];
      if (b.dataset.a === 'sel') { readForm(); st.active = i; fillForm(); }
      else if (b.dataset.a === 'rm') { st.files.splice(i, 1); if (st.active >= i && st.active > 0) st.active--; fillForm(); render(); }
      else if (b.dataset.a === 'pw') {
        var pw = document.querySelector('input[data-pw="' + f.id + '"]'); f.password = pw ? pw.value : '';
        f.status = 'load'; f.note = 'Unlocking…'; render();
        try { await openFile(f); } catch (err) { f.status = 'fail'; f.note = 'Could not open this PDF'; }
        st.active = i; fillForm(); render();
      }
    });
    $('mdFiles').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('input[data-pw]')) { var b = e.target.parentNode.querySelector('button'); if (b) b.click(); } });
    $('mdDl').addEventListener('click', download);
    $('mdBack').addEventListener('click', function () { $('mdResult').hidden = true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PDFMetaEditor = { state: st };
})();
