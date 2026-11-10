/* PDF Restriction Compatibility Check — PDFdukan
 * Reads a PDF in the browser and reports: open password, permission flags,
 * encryption method, signatures, form fields, PDF/A and accessibility basics.
 * Nothing is uploaded. Uses pdf-lib (structure) and pdf.js (password check).
 */
(function () {
  'use strict';
  var MAX = 200 * 1024 * 1024;
  var $ = function (id) { return document.getElementById(id); };
  var last = null; // last report object

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  /* ---------- small pdf-lib helpers ---------- */
  var L = function () { return window.PDFLib; };
  function look(ctx, v) { try { return v instanceof L().PDFRef ? ctx.lookup(v) : v; } catch (e) { return undefined; } }
  function dget(ctx, d, k) { if (!d || !(d instanceof L().PDFDict)) return undefined; return look(ctx, d.get(L().PDFName.of(k))); }
  function num(v) { return v instanceof L().PDFNumber ? v.asNumber() : undefined; }
  function nm(v) { return v instanceof L().PDFName ? v.decodeText ? v.decodeText() : v.asString().replace(/^\//, '') : undefined; }
  function txt(v) {
    try {
      if (v instanceof L().PDFString || v instanceof L().PDFHexString) return v.decodeText();
    } catch (e) {}
    return undefined;
  }
  function isTrue(v) { return v instanceof L().PDFBool && v.asBoolean ? v.asBoolean() : String(v) === 'true'; }
  function arr(ctx, v) { v = look(ctx, v); return v instanceof L().PDFArray ? v.asArray().map(function (x) { return look(ctx, x); }) : []; }

  function countBytes(u8, pat) {
    var p = []; for (var i = 0; i < pat.length; i++) p.push(pat.charCodeAt(i));
    var n = 0, first = p[0], len = p.length;
    outer: for (var j = 0; j <= u8.length - len; j++) {
      if (u8[j] !== first) continue;
      for (var k = 1; k < len; k++) if (u8[j + k] !== p[k]) continue outer;
      n++; j += len - 1;
    }
    return n;
  }
  function headStr(u8, n) { var s = ''; for (var i = 0; i < Math.min(n, u8.length); i++) s += String.fromCharCode(u8[i]); return s; }

  /* ---------- permissions ---------- */
  function permissions(P, R) {
    var b = function (n) { return (P & (1 << (n - 1))) !== 0; };
    var r3 = R >= 3;
    var print = !b(3) ? 'no' : (r3 && !b(12) ? 'low' : 'yes');
    return [
      { k: 'print', label: 'Printing', state: print, note: print === 'low' ? 'Prints at low quality only' : (print === 'yes' ? 'Can be printed' : 'Print is turned off') },
      { k: 'copy', label: 'Copy text and images', state: b(5) ? 'yes' : 'no', note: b(5) ? 'Text can be selected and copied' : 'Copy and select are turned off' },
      { k: 'edit', label: 'Edit content', state: b(4) ? 'yes' : 'no', note: b(4) ? 'Content can be changed' : 'Editing is turned off' },
      { k: 'assemble', label: 'Insert, delete or rotate pages', state: (r3 ? b(11) : b(4)) ? 'yes' : 'no', note: (r3 ? b(11) : b(4)) ? 'Pages can be reorganized' : 'Page changes are turned off' },
      { k: 'annot', label: 'Add comments', state: b(6) ? 'yes' : 'no', note: b(6) ? 'Comments and highlights allowed' : 'Commenting is turned off' },
      { k: 'forms', label: 'Fill in form fields', state: (r3 ? (b(9) || b(6)) : b(6)) ? 'yes' : 'no', note: (r3 ? (b(9) || b(6)) : b(6)) ? 'Form fields can be filled' : 'Form filling is turned off' },
      { k: 'sign', label: 'Sign', state: (r3 ? (b(9) || b(6)) : b(6)) ? 'yes' : 'no', note: 'Signing uses the form-fill permission' },
      { k: 'access', label: 'Screen reader access', state: (r3 ? b(10) : b(5)) ? 'yes' : 'no', note: (r3 ? b(10) : b(5)) ? 'Assistive tools can read the text' : 'Assistive text access is turned off' }
    ];
  }

  function cipherName(ctx, enc) {
    var V = num(dget(ctx, enc, 'V')) || 0, R = num(dget(ctx, enc, 'R')) || 0;
    var len = num(dget(ctx, enc, 'Length'));
    var filter = nm(dget(ctx, enc, 'Filter')) || 'Standard';
    var cfm;
    var cf = dget(ctx, enc, 'CF'), stm = nm(dget(ctx, enc, 'StmF'));
    if (cf && stm) cfm = nm(dget(ctx, dget(ctx, cf, stm), 'CFM'));
    var name, weak = false;
    if (filter !== 'Standard') name = filter + ' (certificate or custom security)';
    else if (V >= 5 || R >= 5) name = 'AES 256-bit';
    else if (cfm === 'AESV2') name = 'AES 128-bit';
    else if (V === 1 || R === 2 || len === 40) { name = 'RC4 40-bit'; weak = true; }
    else { name = 'RC4 ' + (len || 128) + '-bit'; weak = true; }
    var metaEnc = dget(ctx, enc, 'EncryptMetadata');
    return { name: name, weak: weak, V: V, R: R, filter: filter, metadataPlain: metaEnc !== undefined && !isTrue(metaEnc) };
  }

  /* ---------- fonts ---------- */
  function fontInfo(ctx, pages) {
    var seen = new Set(), out = { total: 0, missing: [] }, xseen = new Set(), steps = 0;
    function checkFont(f) {
      if (!f || seen.has(f)) return; seen.add(f); out.total++;
      var sub = nm(dget(ctx, f, 'Subtype'));
      var base = nm(dget(ctx, f, 'BaseFont')) || '(unnamed)';
      if (sub === 'Type3') return;
      var target = f;
      if (sub === 'Type0') target = arr(ctx, dget(ctx, f, 'DescendantFonts'))[0] || f;
      var fd = dget(ctx, target, 'FontDescriptor');
      var emb = fd && (dget(ctx, fd, 'FontFile') || dget(ctx, fd, 'FontFile2') || dget(ctx, fd, 'FontFile3'));
      if (!emb && out.missing.indexOf(base) < 0) out.missing.push(base.replace(/^[A-Z]{6}\+/, ''));
    }
    function walkRes(res, depth) {
      if (!res || depth > 4 || ++steps > 20000) return;
      var fonts = dget(ctx, res, 'Font');
      if (fonts instanceof L().PDFDict) fonts.entries().forEach(function (e) { checkFont(look(ctx, e[1])); });
      var xo = dget(ctx, res, 'XObject');
      if (xo instanceof L().PDFDict) xo.entries().forEach(function (e) {
        var ref = e[1]; if (xseen.has(String(ref))) return; xseen.add(String(ref));
        var s = look(ctx, ref); var d = s && s.dict;
        if (d && nm(dget(ctx, d, 'Subtype')) === 'Form') walkRes(dget(ctx, d, 'Resources'), depth + 1);
      });
    }
    pages.forEach(function (p) { try { walkRes(p.node.Resources(), 0); } catch (e) {} });
    return out;
  }

  /* ---------- signatures & forms ---------- */
  function fields(ctx, acro) {
    var list = [], seen = new Set();
    (function walk(a, depth, inheritedFT) {
      a.forEach(function (f) {
        if (!(f instanceof L().PDFDict) || seen.has(f) || depth > 12) return; seen.add(f);
        var ft = nm(dget(ctx, f, 'FT')) || inheritedFT;
        var kids = arr(ctx, dget(ctx, f, 'Kids'));
        var hasNamedKids = kids.some(function (k) { return dget(ctx, k, 'T'); });
        if (hasNamedKids) walk(kids, depth + 1, ft); else list.push({ d: f, ft: ft });
      });
    })(arr(ctx, dget(ctx, acro, 'Fields')), 0);
    return list;
  }

  function sigInfo(ctx, fieldList, fileLen, encrypted) {
    var sigs = [];
    fieldList.forEach(function (f) {
      if (f.ft !== 'Sig') return;
      var v = dget(ctx, f.d, 'V');
      if (!(v instanceof L().PDFDict)) { sigs.push({ empty: true, field: txt(dget(ctx, f.d, 'T')) || '' }); return; }
      var br = arr(ctx, dget(ctx, v, 'ByteRange')).map(num);
      var end = br.length === 4 ? br[2] + br[3] : 0;
      sigs.push({
        empty: false,
        field: txt(dget(ctx, f.d, 'T')) || '',
        name: encrypted ? '' : (txt(dget(ctx, v, 'Name')) || ''),
        when: encrypted ? '' : pdfDate(txt(dget(ctx, v, 'M'))),
        reason: encrypted ? '' : (txt(dget(ctx, v, 'Reason')) || ''),
        type: nm(dget(ctx, v, 'SubFilter')) || '',
        coversAll: end === fileLen,
        later: end > 0 && end < fileLen
      });
    });
    return sigs;
  }
  function pdfDate(s) {
    if (!s) return '';
    var m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
    if (!m) return s;
    return m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01') + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') : '');
  }
  function docMDP(ctx, cat) {
    var perms = dget(ctx, cat, 'Perms'); var sig = dget(ctx, perms, 'DocMDP');
    if (!sig) return 0;
    var ref = arr(ctx, dget(ctx, sig, 'Reference'))[0];
    var tp = dget(ctx, ref, 'TransformParams');
    return num(dget(ctx, tp, 'P')) || 2;
  }

  /* ---------- XMP ---------- */
  function xmpText(ctx, cat) {
    var s = dget(ctx, cat, 'Metadata');
    if (!s) return '';
    try {
      var bytes = s.contents;
      if (dget(ctx, s.dict, 'Filter') && L().decodePDFRawStream) bytes = L().decodePDFRawStream(s).decode();
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return ''; }
  }
  function xmpVal(x, key) {
    var re1 = new RegExp(key + '\\s*=\\s*"([^"]*)"'), re2 = new RegExp('<' + key + '(?:\\s[^>]*)?>([^<]*)<');
    var m = re1.exec(x) || re2.exec(x); return m ? m[1].trim() : '';
  }

  /* ---------- whole-object scan ---------- */
  function scanObjects(ctx) {
    var js = false, files = 0, n = 0;
    var JS = L().PDFName.of('JS'), S = L().PDFName.of('S'), EF = L().PDFName.of('EF');
    try {
      ctx.enumerateIndirectObjects().forEach(function (pair) {
        n++;
        var o = pair[1]; var d = o instanceof L().PDFDict ? o : (o && o.dict);
        if (!(d instanceof L().PDFDict)) return;
        if (d.has(JS) || nm(look(ctx, d.get(S))) === 'JavaScript') js = true;
        if (d.has(EF)) files++;
      });
    } catch (e) {}
    return { js: js, files: files, objects: n };
  }

  /* ---------- open-password check with pdf.js ---------- */
  async function openCheck(bytes, password) {
    if (!window.pdfjsLib) return { state: 'unknown' };
    try {
      var task = pdfjsLib.getDocument({ data: bytes.slice(0), password: password || '', isEvalSupported: false });
      var doc = await task.promise;
      var pages = doc.numPages; doc.destroy();
      return { state: 'open', pages: pages };
    } catch (e) {
      if (e && e.name === 'PasswordException') return { state: e.code === 2 ? 'wrong' : 'needs' };
      return { state: 'error', msg: e && e.message };
    }
  }

  /* ---------- main analysis ---------- */
  async function analyze(file, bytes) {
    var r = { file: file.name, size: file.size, problems: [] };
    var head = headStr(bytes, 1024);
    var hv = /%PDF-(\d\.\d)/.exec(head);
    if (!hv) throw new Error('notpdf');
    r.version = hv[1];
    r.linearized = /\/Linearized/.test(head);
    r.saves = Math.max(1, countBytes(bytes, 'startxref') - (r.linearized ? 1 : 0));

    var doc = await L().PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    var ctx = doc.context, cat = doc.catalog;
    var cv = nm(dget(ctx, cat, 'Version')); if (cv && parseFloat(cv) > parseFloat(r.version)) r.version = cv;
    r.pages = doc.getPageCount();

    var enc = look(ctx, ctx.trailerInfo.Encrypt);
    r.encrypted = !!enc;
    if (enc) {
      var c = cipherName(ctx, enc);
      r.cipher = c;
      var P = num(dget(ctx, enc, 'P'));
      r.perms = permissions(P == null ? -1 : (P | 0), c.R || 2);
    } else {
      r.perms = permissions(-1, 4);
    }
    r.restricted = r.perms.filter(function (p) { return p.state !== 'yes'; }).length;

    var oc = await openCheck(bytes, '');
    r.open = oc.state; if (oc.pages) r.pages = oc.pages;

    var acro = dget(ctx, cat, 'AcroForm');
    var fl = acro ? fields(ctx, acro) : [];
    r.fields = fl.filter(function (f) { return f.ft && f.ft !== 'Sig'; }).length;
    r.xfa = !!(acro && dget(ctx, acro, 'XFA'));
    r.sigs = sigInfo(ctx, fl, bytes.length, r.encrypted);
    r.signed = r.sigs.filter(function (s) { return !s.empty; }).length;
    r.certified = docMDP(ctx, cat);

    var x = r.encrypted && !(r.cipher && r.cipher.metadataPlain) ? '' : xmpText(ctx, cat);
    r.xmp = !!dget(ctx, cat, 'Metadata');
    r.pdfa = x ? (xmpVal(x, 'pdfaid:part') ? 'PDF/A-' + xmpVal(x, 'pdfaid:part') + (xmpVal(x, 'pdfaid:conformance') || '').toLowerCase() : '') : '';
    r.pdfua = x ? xmpVal(x, 'pdfuaid:part') : '';
    r.outputIntent = arr(ctx, dget(ctx, cat, 'OutputIntents')).length > 0;
    var mi = dget(ctx, cat, 'MarkInfo');
    r.tagged = !!(dget(ctx, cat, 'StructTreeRoot') && mi && isTrue(dget(ctx, mi, 'Marked')));
    r.lang = r.encrypted ? (dget(ctx, cat, 'Lang') ? 'set' : '') : (txt(dget(ctx, cat, 'Lang')) || '');
    var info = look(ctx, ctx.trailerInfo.Info);
    r.title = r.encrypted ? '' : (txt(dget(ctx, info, 'Title')) || (x && xmpVal(x, 'rdf:li')) || '');
    r.producer = r.encrypted ? '' : (txt(dget(ctx, info, 'Producer')) || '');

    var fonts = fontInfo(ctx, doc.getPages());
    r.fonts = fonts;
    var sc = scanObjects(ctx);
    r.js = sc.js; r.attachments = sc.files;
    return r;
  }

  /* ---------- PDF/A quick checks ---------- */
  function pdfaChecks(r) {
    var part = parseInt((r.pdfa || '').replace('PDF/A-', ''), 10) || 0;
    var list = [
      { ok: !r.encrypted, t: 'Not encrypted', f: 'PDF/A does not allow encryption' },
      { ok: r.xmp, t: 'XMP metadata present', f: 'XMP metadata is missing' },
      { ok: !!r.pdfa, t: 'Declares ' + (r.pdfa || 'PDF/A'), f: 'No PDF/A declaration in the metadata' },
      { ok: r.outputIntent, t: 'Colour profile (OutputIntent) present', f: 'No OutputIntent colour profile' },
      { ok: r.fonts.missing.length === 0, t: 'All ' + r.fonts.total + ' fonts embedded', f: r.fonts.missing.length + ' font' + (r.fonts.missing.length > 1 ? 's' : '') + ' not embedded: ' + r.fonts.missing.slice(0, 4).join(', ') + (r.fonts.missing.length > 4 ? '…' : '') },
      { ok: !r.js, t: 'No JavaScript', f: 'Contains JavaScript' },
      { ok: r.attachments === 0 || part >= 3, t: r.attachments ? 'Attachments allowed in PDF/A-3' : 'No attached files', f: r.attachments + ' attached file' + (r.attachments > 1 ? 's' : '') + ' (only PDF/A-3 allows any type)' }
    ];
    return list;
  }

  /* ---------- rendering ---------- */
  var ICON = { yes: '✓', no: '✕', low: '◐' };
  var WORD = { yes: 'Allowed', no: 'Blocked', low: 'Low quality' };

  function verdict(r) {
    if (r.open === 'needs') return { cls: 'bad', h: 'Password needed to open', p: 'This PDF has an open password. The permission flags below are still readable; enter the password to confirm it works.' };
    if (r.encrypted && r.restricted) return { cls: 'warn', h: 'Opens freely, ' + r.restricted + ' restriction' + (r.restricted > 1 ? 's' : '') + ' set', p: 'Anyone can open it, but a permissions password limits what readers like Adobe Acrobat let you do.' };
    if (r.encrypted) return { cls: 'ok', h: 'Encrypted, no restrictions', p: 'The file is encrypted but every permission is allowed.' };
    return { cls: 'ok', h: 'No password and no restrictions', p: 'Every permission is allowed. Any PDF tool can open and change this file.' };
  }

  function row(k, v) { return '<tr><th scope="row">' + esc(k) + '</th><td>' + v + '</td></tr>'; }
  function chk(ok, t) { return '<li class="rc-' + (ok ? 'ok' : 'no') + '"><span aria-hidden="true">' + (ok ? '✓' : '✕') + '</span>' + esc(t) + '</li>'; }

  function render(r) {
    var v = verdict(r);
    var h = '';
    h += '<div class="rc-head"><div class="rc-file"><span aria-hidden="true">📄</span><div><div class="rc-name">' + esc(r.file) + '</div><div class="rc-meta">' + r.pages + ' page' + (r.pages === 1 ? '' : 's') + ' · ' + size(r.size) + ' · PDF ' + esc(r.version) + '</div></div></div>' +
      '<div class="rc-actions"><button class="btn btn-secondary rc-btn" id="rcCopy" type="button">Copy report</button><button class="btn btn-secondary rc-btn" id="rcSave" type="button">Download report</button><button class="btn btn-primary rc-btn" id="rcAgain" type="button">Check another PDF</button></div></div>';
    h += '<div class="rc-verdict rc-' + v.cls + '" role="status"><strong>' + esc(v.h) + '</strong><p>' + esc(v.p) + '</p></div>';

    if (r.open === 'needs' || r.open === 'wrong') {
      h += '<form class="rc-pw" id="rcPwForm"><label for="rcPw">Know the password? Check it here (stays in your browser):</label><div><input type="password" id="rcPw" autocomplete="off" placeholder="Open password"><button class="btn btn-primary" type="submit">Check password</button></div><p id="rcPwMsg" class="rc-pwmsg" aria-live="polite">' + (r.open === 'wrong' ? 'That password is not correct.' : '') + '</p></form>';
    }

    h += '<h3 class="rc-h">Permissions</h3><div class="rc-perms">';
    r.perms.forEach(function (p) {
      h += '<div class="rc-perm rc-' + p.state + '"><span class="rc-ic" aria-hidden="true">' + ICON[p.state] + '</span><div><b>' + esc(p.label) + '</b><span>' + esc(p.note) + '</span></div><em>' + WORD[p.state] + '</em></div>';
    });
    h += '</div>';

    h += '<div class="rc-grid">';
    // security
    h += '<div class="rc-box"><h3 class="rc-h">Security</h3><table class="rc-t">';
    h += row('Open password', r.open === 'needs' || r.open === 'wrong' ? '<b class="rc-red">Yes</b>' : (r.open === 'open' ? 'No' : 'Could not test'));
    h += row('Permissions password', r.encrypted ? (r.restricted ? '<b class="rc-amb">Yes</b>' : 'Set, nothing blocked') : 'No');
    h += row('Encryption', r.encrypted ? esc(r.cipher.name) + (r.cipher.weak ? ' <span class="rc-tag">weak</span>' : '') : 'None');
    if (r.encrypted) h += row('Security revision', 'R' + r.cipher.R + (r.cipher.metadataPlain ? ' · metadata not encrypted' : ''));
    h += row('Saved revisions', r.saves + (r.saves > 1 ? ' (changed after it was first saved)' : ''));
    h += row('JavaScript', r.js ? '<b class="rc-amb">Yes</b>' : 'No');
    h += row('Attached files', r.attachments || 'None');
    h += '</table></div>';
    // signatures & forms
    h += '<div class="rc-box"><h3 class="rc-h">Signatures and forms</h3><table class="rc-t">';
    h += row('Digital signatures', r.signed ? r.signed + (r.certified ? ' · certified (level ' + r.certified + ')' : '') : 'None');
    r.sigs.filter(function (s) { return !s.empty; }).forEach(function (s, i) {
      var who = s.name || s.field || ('Signature ' + (i + 1));
      var det = [s.when, s.reason].filter(Boolean).join(' · ');
      h += row('· ' + who, (det ? esc(det) + '<br>' : '') + (s.coversAll ? 'Covers the whole file' : (s.later ? '<b class="rc-amb">File changed after this signature</b>' : 'Range not readable')));
    });
    var emptySig = r.sigs.filter(function (s) { return s.empty; }).length;
    if (emptySig) h += row('Empty signature fields', emptySig);
    h += row('Form fields', r.fields ? r.fields + (r.xfa ? ' (XFA form)' : '') : (r.xfa ? 'XFA form' : 'None'));
    h += '</table>';
    if (r.signed) h += '<p class="rc-note">Signer identity is not verified here. Open the file in Adobe Acrobat Reader to validate the certificate.</p>';
    h += '</div>';
    h += '</div>';

    // PDF/A + accessibility
    h += '<div class="rc-grid">';
    h += '<div class="rc-box"><h3 class="rc-h">PDF/A quick check</h3><ul class="rc-list">';
    pdfaChecks(r).forEach(function (c) { h += chk(c.ok, c.ok ? c.t : c.f); });
    h += '</ul><p class="rc-note">Covers common PDF/A failures only. For a full ISO 19005 report, use <a href="https://verapdf.org/" target="_blank" rel="noopener">veraPDF</a>.</p></div>';
    h += '<div class="rc-box"><h3 class="rc-h">Accessibility basics</h3><ul class="rc-list">';
    h += chk(r.tagged, r.tagged ? 'Tagged PDF (has reading structure)' : 'Not tagged: screen readers may read it out of order');
    h += chk(!!r.lang, r.lang ? 'Language set' + (r.lang !== 'set' ? ': ' + r.lang : '') : 'No document language');
    h += chk(!!r.title, r.title ? 'Title: ' + r.title.slice(0, 60) : 'No document title');
    h += chk(r.perms[7].state === 'yes', r.perms[7].state === 'yes' ? 'Screen reader access allowed' : 'Screen reader access blocked');
    if (r.pdfua) h += chk(true, 'Declares PDF/UA-' + r.pdfua);
    h += '</ul><p class="rc-note">Machine checks only. Reading order and alt text still need a person.</p></div>';
    h += '</div>';

    var box = $('rcResult');
    box.innerHTML = h;
    box.hidden = false;
    $('rcUpload').hidden = true;
    $('rcCopy').onclick = function () { copyReport(); };
    $('rcSave').onclick = function () { saveReport(); };
    $('rcAgain').onclick = function () { reset(); };
    var f = $('rcPwForm');
    if (f) f.onsubmit = function (e) { e.preventDefault(); tryPassword(); };
  }

  function reportText(r) {
    var L2 = [];
    L2.push('PDF Restriction Compatibility Check — PDFdukan');
    L2.push('File: ' + r.file + ' (' + size(r.size) + ', ' + r.pages + ' pages, PDF ' + r.version + ')');
    L2.push('Result: ' + verdict(r).h);
    L2.push('');
    L2.push('Permissions');
    r.perms.forEach(function (p) { L2.push('  ' + p.label + ': ' + WORD[p.state]); });
    L2.push('');
    L2.push('Open password: ' + (r.open === 'needs' || r.open === 'wrong' ? 'Yes' : (r.open === 'open' ? 'No' : 'Not tested')));
    L2.push('Encryption: ' + (r.encrypted ? r.cipher.name + (r.cipher.weak ? ' (weak)' : '') + ', R' + r.cipher.R : 'None'));
    L2.push('Digital signatures: ' + (r.signed || 'None') + (r.certified ? ', certified level ' + r.certified : ''));
    r.sigs.filter(function (s) { return !s.empty; }).forEach(function (s) { L2.push('  ' + (s.name || s.field) + (s.when ? ', ' + s.when : '') + ': ' + (s.coversAll ? 'covers whole file' : 'file changed after signing')); });
    L2.push('Form fields: ' + (r.fields || 'None') + (r.xfa ? ' (XFA)' : ''));
    L2.push('JavaScript: ' + (r.js ? 'Yes' : 'No') + ' | Attached files: ' + (r.attachments || 'None') + ' | Saved revisions: ' + r.saves);
    L2.push('');
    L2.push('PDF/A quick check');
    pdfaChecks(r).forEach(function (c) { L2.push('  [' + (c.ok ? 'OK' : '!!') + '] ' + (c.ok ? c.t : c.f)); });
    L2.push('Accessibility: tagged ' + (r.tagged ? 'yes' : 'no') + ', language ' + (r.lang || 'none') + ', title ' + (r.title ? 'yes' : 'no'));
    L2.push('');
    L2.push('Checked in the browser at pdfdukan.com. The file was not uploaded.');
    return L2.join('\n');
  }
  function copyReport() {
    if (!last) return;
    var t = reportText(last);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { if (window.toast) toast('Report copied', 'success'); })
      .catch(function () { if (window.toast) toast('Copy failed. Use Download report.', 'error'); });
  }
  function saveReport() {
    if (!last) return;
    var blob = new Blob([reportText(last)], { type: 'text/plain' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = last.file.replace(/\.pdf$/i, '') + '-restriction-report.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  var lastBytes = null;
  async function tryPassword() {
    var pw = $('rcPw').value, msg = $('rcPwMsg');
    if (!pw) { msg.textContent = 'Type the password first.'; return; }
    msg.textContent = 'Checking…';
    var oc = await openCheck(lastBytes, pw);
    if (oc.state === 'open') {
      msg.className = 'rc-pwmsg rc-good';
      msg.textContent = 'Correct password. The PDF opens with it (' + oc.pages + ' pages).';
    } else {
      msg.className = 'rc-pwmsg';
      msg.textContent = oc.state === 'needs' || oc.state === 'wrong' ? 'That password is not correct.' : 'Could not open the file with that password.';
    }
  }

  function reset() {
    last = null; lastBytes = null;
    $('rcResult').hidden = true; $('rcResult').innerHTML = '';
    $('rcUpload').hidden = false; $('rcInfo').textContent = '';
    $('rcFileInput').value = '';
  }

  async function onFile(f) {
    var info = $('rcInfo');
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { info.textContent = 'Choose a PDF file.'; return; }
    if (!f.size) { info.textContent = 'This file is empty.'; return; }
    if (f.size > MAX) { info.textContent = 'This checker reads PDFs up to 200 MB.'; return; }
    info.textContent = '';
    if (window.PDLoader) PDLoader.show('Checking PDF…', f.name);
    try {
      var bytes = new Uint8Array(await f.arrayBuffer());
      lastBytes = bytes;
      last = await analyze(f, bytes);
      render(last);
      if (window.trackToolUse) trackToolUse('pdf-restriction-check');
    } catch (e) {
      console.error(e);
      info.textContent = e && e.message === 'notpdf' ? 'This file is not a PDF.' : 'This PDF is damaged or uses a structure the checker cannot read.';
      if (window.toast) toast('Could not read this PDF', 'error');
    } finally { if (window.PDLoader) PDLoader.hide(); }
  }

  function init() {
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var dz = $('rcDrop'), inp = $('rcFileInput');
    if (!dz) return;
    dz.onclick = function () { inp.click(); };
    dz.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = function (e) { onFile(e.target.files[0]); };
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer.files.length) onFile(e.dataTransfer.files[0]); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.RestrictionCheck = { analyze: analyze, reportText: reportText, onFile: onFile };
})();
