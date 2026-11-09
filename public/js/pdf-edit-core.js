/* PDFdukan PDF editor core: real text replacement, matching fonts, forms, links.
   - removeText(): rewrites a page's content stream so the original words are really gone
     (not just hidden under a white box), keeping every other word in its place.
   - fonts(): open look-alike fonts (same widths as Times, Arial, Courier, Calibri, Cambria) plus
     Noto fonts for other scripts, loaded only when an edit needs them. */
(function () {
  'use strict';
  var CDN = window.PD_FONT_CDN || 'https://cdn.jsdelivr.net/npm/';
  // fontkit 2 makes small, correct font subsets (fontkit 1 breaks the letters of many Google fonts)
  var FONTKIT_URL = window.PD_FONTKIT_URL || CDN + 'fontkit@2.0.4/+esm';
  var fkPromise = null;
  function getFontkit() {
    if (!fkPromise) fkPromise = import(FONTKIT_URL).then(function (m) {
      var fk = m && m.default && m.default.create ? m.default : m;
      // pdf-lib expects the older streaming subset API
      return { create: function (buf) {
        var f = fk.create(buf), orig = f.createSubset.bind(f);
        f.createSubset = function () {
          var sub = orig();
          sub.encodeStream = function () { var h = {}, sent = false, em = { on: function (ev, cb) { h[ev] = cb; if (h.data && h.end && !sent) { sent = true; setTimeout(function () { try { h.data(sub.encode()); h.end(); } catch (e) { h.error && h.error(e); } }, 0); } return em; } }; return em; };
          return sub;
        };
        return f;
      } };
    }).catch(function (e) { fkPromise = null; throw e; });
    return fkPromise;
  }
  var FAMS = {
    serif: { pkg: '@expo-google-fonts/tinos@0.4.2', css: 'PD Tinos', f: { r: '400Regular/Tinos_400Regular', b: '700Bold/Tinos_700Bold', i: '400Regular_Italic/Tinos_400Regular_Italic', bi: '700Bold_Italic/Tinos_700Bold_Italic' } },
    sans: { pkg: '@expo-google-fonts/arimo@0.4.3', css: 'PD Arimo', f: { r: '400Regular/Arimo_400Regular', b: '700Bold/Arimo_700Bold', i: '400Regular_Italic/Arimo_400Regular_Italic', bi: '700Bold_Italic/Arimo_700Bold_Italic' } },
    mono: { pkg: '@expo-google-fonts/cousine@0.4.3', css: 'PD Cousine', f: { r: '400Regular/Cousine_400Regular', b: '700Bold/Cousine_700Bold', i: '400Regular_Italic/Cousine_400Regular_Italic', bi: '700Bold_Italic/Cousine_700Bold_Italic' } },
    calibri: { pkg: '@expo-google-fonts/carlito@0.4.1', css: 'PD Carlito', f: { r: '400Regular/Carlito_400Regular', b: '700Bold/Carlito_700Bold', i: '400Regular_Italic/Carlito_400Regular_Italic', bi: '700Bold_Italic/Carlito_700Bold_Italic' } },
    cambria: { pkg: '@expo-google-fonts/caladea@0.4.2', css: 'PD Caladea', f: { r: '400Regular/Caladea_400Regular', b: '700Bold/Caladea_700Bold', i: '400Regular_Italic/Caladea_400Regular_Italic', bi: '700Bold_Italic/Caladea_700Bold_Italic' } },
    roboto: { pkg: '@expo-google-fonts/roboto@0.4.3', css: 'PD Roboto', f: { r: '400Regular/Roboto_400Regular', b: '700Bold/Roboto_700Bold', i: '400Regular_Italic/Roboto_400Regular_Italic', bi: '700Bold_Italic/Roboto_700Bold_Italic' } },
    opensans: { pkg: '@expo-google-fonts/open-sans@0.4.2', css: 'PD OpenSans', f: { r: '400Regular/OpenSans_400Regular', b: '700Bold/OpenSans_700Bold', i: '400Regular_Italic/OpenSans_400Regular_Italic', bi: '700Bold_Italic/OpenSans_700Bold_Italic' } },
    lato: { pkg: '@expo-google-fonts/lato@0.4.1', css: 'PD Lato', f: { r: '400Regular/Lato_400Regular', b: '700Bold/Lato_700Bold', i: '400Regular_Italic/Lato_400Regular_Italic', bi: '700Bold_Italic/Lato_700Bold_Italic' } },
    montserrat: { pkg: '@expo-google-fonts/montserrat@0.4.2', css: 'PD Montserrat', f: { r: '400Regular/Montserrat_400Regular', b: '700Bold/Montserrat_700Bold', i: '400Regular_Italic/Montserrat_400Regular_Italic', bi: '700Bold_Italic/Montserrat_700Bold_Italic' } },
    poppins: { pkg: '@expo-google-fonts/poppins@0.4.1', css: 'PD Poppins', f: { r: '400Regular/Poppins_400Regular', b: '700Bold/Poppins_700Bold', i: '400Regular_Italic/Poppins_400Regular_Italic', bi: '700Bold_Italic/Poppins_700Bold_Italic' } },
    georgia: { pkg: '@expo-google-fonts/gelasio@0.4.1', css: 'PD Gelasio', f: { r: '400Regular/Gelasio_400Regular', b: '700Bold/Gelasio_700Bold', i: '400Regular_Italic/Gelasio_400Regular_Italic', bi: '700Bold_Italic/Gelasio_700Bold_Italic' } },
    merriweather: { pkg: '@expo-google-fonts/merriweather@0.4.2', css: 'PD Merriweather', f: { r: '400Regular/Merriweather_400Regular', b: '700Bold/Merriweather_700Bold', i: '400Regular_Italic/Merriweather_400Regular_Italic', bi: '700Bold_Italic/Merriweather_700Bold_Italic' } },
    playfair: { pkg: '@expo-google-fonts/playfair-display@0.4.2', css: 'PD Playfair', f: { r: '400Regular/PlayfairDisplay_400Regular', b: '700Bold/PlayfairDisplay_700Bold', i: '400Regular_Italic/PlayfairDisplay_400Regular_Italic', bi: '700Bold_Italic/PlayfairDisplay_700Bold_Italic' } },
    impact: { pkg: '@expo-google-fonts/anton@0.4.2', css: 'PD Anton', f: { r: '400Regular/Anton_400Regular' } },
    naskh: { pkg: '@expo-google-fonts/noto-naskh-arabic@0.4.5', css: 'PD Naskh', f: { r: '400Regular/NotoNaskhArabic_400Regular', b: '700Bold/NotoNaskhArabic_700Bold' } },
    nastaliq: { pkg: '@expo-google-fonts/noto-nastaliq-urdu@0.4.2', css: 'PD Nastaliq', f: { r: '400Regular/NotoNastaliqUrdu_400Regular', b: '700Bold/NotoNastaliqUrdu_700Bold' } },
    symbols: { pkg: 'dejavu-fonts-ttf@2.37.3', css: 'PD DejaVu', f: { r: 'ttf/DejaVuSans', b: 'ttf/DejaVuSans-Bold', i: 'ttf/DejaVuSans-Oblique', bi: 'ttf/DejaVuSans-BoldOblique' } }
  };
  // fonts offered in the font menu (label shown, key used for screen and download)
  var CHOICES = [['sans','Arial'],['serif','Times New Roman'],['calibri','Calibri'],['cambria','Cambria'],['georgia','Georgia'],['mono','Courier New'],
    ['roboto','Roboto'],['opensans','Open Sans'],['lato','Lato'],['montserrat','Montserrat'],['poppins','Poppins'],['merriweather','Merriweather'],
    ['playfair','Playfair Display'],['impact','Impact']];
  var RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  var bytesCache = {}, faceCache = {}, scriptPromise = {};

  function loadScript(src) {
    if (scriptPromise[src]) return scriptPromise[src];
    scriptPromise[src] = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = function () { delete scriptPromise[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
    return scriptPromise[src];
  }
  // which open font looks and measures like the original font name
  function familyFor(info) {
    if (info && info.choice && FAMS[info.choice]) return info.choice;
    var name = String(info && info.name || '').toLowerCase(), fam = String(info && info.family || '').toLowerCase();
    function byName(n) {
      if (!n) return null;
      if (/nasta|jameel|alvi|nafees|mehr/.test(n)) return 'nastaliq';
      if (/naskh/.test(n)) return 'naskh';
      if (/roboto/.test(n)) return 'roboto';
      if (/open ?sans|opensans/.test(n)) return 'opensans';
      if (/\blato|^lato|lato-/.test(n)) return 'lato';
      if (/montserrat/.test(n)) return 'montserrat';
      if (/poppins/.test(n)) return 'poppins';
      if (/merriweather/.test(n)) return 'merriweather';
      if (/playfair/.test(n)) return 'playfair';
      if (/georgia|gelasio/.test(n)) return 'georgia';
      if (/impact|anton/.test(n)) return 'impact';
      if (/calibri|carlito/.test(n)) return 'calibri';
      if (/cambria|caladea/.test(n)) return 'cambria';
      if (/courier|mono|consol|lucidaconsole|lucida console|cousine/.test(n)) return 'mono';
      if (/sans|arial|helv|verdana|tahoma|segoe|trebuchet|calibri|liberationsans|arimo|roboto|open ?sans|gothic|futura|frutiger|myriad|dejavusans|noto ?sans|inter\b/.test(n)) return 'sans';
      if (/times|roman|nimbusrom|romno|sfrm|lmroman|cmr\d|georgia|garamond|bookman|book ?antiqua|minion|tinos|palatino|utopia|charter|serif|liberationserif|freeserif|century|baskerville/.test(n)) return 'serif';
      return null;
    }
    // the font's own name decides first; the generic family pdf.js reports is only a hint
    var f = byName(name);
    if (f) return f;
    if (info && info.mono) return 'mono';
    if (info && info.serif) return 'serif';
    return byName(fam) === 'serif' && !/sans/.test(fam) ? 'serif' : (byName(fam) || 'sans');
  }
  function variant(bold, italic) { return bold && italic ? 'bi' : bold ? 'b' : italic ? 'i' : 'r'; }
  function url(fam, v) { var F = FAMS[fam], k = F.f[v] ? v : (F.f[v[0]] ? v[0] : 'r'); if (k === 'i' && !F.f.i) k = 'r'; return CDN + F.pkg + '/' + F.f[k] + '.ttf'; }
  function fontBytes(fam, v) {
    var u = url(fam, v);
    if (!bytesCache[u]) bytesCache[u] = fetch(u, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); }).catch(function (e) { delete bytesCache[u]; throw e; });
    return bytesCache[u];
  }
  // the same font on screen, so what you type looks like what you download
  function cssFace(fam, bold, italic) {
    var v = variant(bold, italic), key = fam + v;
    if (!faceCache[key]) faceCache[key] = fontBytes(fam, v).then(function (buf) {
      var face = new FontFace(FAMS[fam].css, buf, { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
      document.fonts.add(face); return face.load();
    }).catch(function () { return null; });
    return faceCache[key].then(function () { return "'" + FAMS[fam].css + "'"; });
  }
  function cssStack(fam) { if (!FAMS[fam]) fam = 'sans'; return "'" + FAMS[fam].css + "', " + (/^(serif|cambria|georgia|merriweather|playfair)$/.test(fam) ? 'Georgia, serif' : fam === 'mono' ? 'monospace' : 'Arial, sans-serif'); }
  function needsScript(text) {
    if (RTL.test(text)) return 'rtl';
    for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); if (c > 0x24F && !(c >= 0x2000 && c <= 0x206F) && !(c >= 0x20A0 && c <= 0x20CF)) return 'symbols'; }
    return '';
  }
  // embed a font for this text into a pdf-lib document (cached per document)
  async function embedFor(doc, text, info) {
    if (!doc.__pdFk) { doc.registerFontkit(await getFontkit()); doc.__pdFk = {}; }
    var fam = familyFor(info), sc = needsScript(text);
    if (sc === 'symbols' && fam !== 'symbols') fam = 'symbols';
    if (sc === 'rtl' && fam !== 'nastaliq') fam = 'naskh';
    var v = variant(info && info.bold, info && info.italic), key = fam + v;
    if (!doc.__pdFk[key]) doc.__pdFk[key] = fontBytes(fam, v).then(function (b) { return doc.embedFont(b, { subset: true }); });
    return doc.__pdFk[key];
  }

  /* ---------------- content stream rewriting ---------------- */
  var WS = { 0: 1, 9: 1, 10: 1, 12: 1, 13: 1, 32: 1 }, DELIM = { 40: 1, 41: 1, 60: 1, 62: 1, 91: 1, 93: 1, 123: 1, 125: 1, 47: 1, 37: 1 };
  function Lexer(b) { this.b = b; this.i = 0; }
  Lexer.prototype.skip = function () { var b = this.b; while (this.i < b.length) { var c = b[this.i]; if (WS[c]) this.i++; else if (c === 37) { while (this.i < b.length && b[this.i] !== 10 && b[this.i] !== 13) this.i++; } else break; } };
  Lexer.prototype.next = function () {
    this.skip(); var b = this.b, s = this.i; if (s >= b.length) return null;
    var c = b[s];
    if (c === 40) { // (literal)
      var depth = 1, out = [], i = s + 1;
      while (i < b.length && depth) {
        var ch = b[i];
        if (ch === 92) { var n = b[i + 1]; i += 2;
          if (n === 110) out.push(10); else if (n === 114) out.push(13); else if (n === 116) out.push(9); else if (n === 98) out.push(8); else if (n === 102) out.push(12);
          else if (n >= 48 && n <= 55) { var o = n - 48, k = 0; while (k < 2 && b[i] >= 48 && b[i] <= 55) { o = o * 8 + b[i] - 48; i++; k++; } out.push(o & 255); }
          else if (n === 13) { if (b[i] === 10) i++; } else if (n === 10) { } else out.push(n);
          continue; }
        if (ch === 40) depth++; else if (ch === 41) { depth--; if (!depth) { i++; break; } }
        out.push(ch); i++;
      }
      this.i = i; return { t: 'str', v: out, s: s, e: i };
    }
    if (c === 60) {
      if (b[s + 1] === 60) { this.i = s + 2; return { t: 'dict<', s: s, e: s + 2 }; }
      var j = s + 1, hex = ''; while (j < b.length && b[j] !== 62) { if (!WS[b[j]]) hex += String.fromCharCode(b[j]); j++; }
      if (hex.length % 2) hex += '0'; var arr = []; for (var h = 0; h < hex.length; h += 2) arr.push(parseInt(hex.substr(h, 2), 16));
      this.i = j + 1; return { t: 'str', v: arr, s: s, e: j + 1 };
    }
    if (c === 62 && b[s + 1] === 62) { this.i = s + 2; return { t: 'dict>', s: s, e: s + 2 }; }
    if (c === 91) { this.i = s + 1; return { t: '[', s: s, e: s + 1 }; }
    if (c === 93) { this.i = s + 1; return { t: ']', s: s, e: s + 1 }; }
    if (c === 123 || c === 125) { this.i = s + 1; return { t: 'brace', s: s, e: s + 1 }; }
    if (c === 47) { var e = s + 1; while (e < b.length && !WS[b[e]] && !DELIM[b[e]]) e++; this.i = e; return { t: 'name', v: String.fromCharCode.apply(null, b.subarray(s + 1, e)), s: s, e: e }; }
    var e2 = s; while (e2 < b.length && !WS[b[e2]] && !DELIM[b[e2]]) e2++; if (e2 === s) e2 = s + 1;
    this.i = e2; var word = String.fromCharCode.apply(null, b.subarray(s, e2));
    if (/^[+\-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word), s: s, e: e2 };
    return { t: 'op', v: word, s: s, e: e2 };
  };
  function mul(m, n) { return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]]; }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  function lk(PL, d, key, T) { try { var v = d && d.lookup(PL.PDFName.of(key)); return v instanceof T ? v : undefined; } catch (e) { return undefined; } }
  function fontMetrics(PL, doc, resources, name) {
    var out = { two: false, w: function () { return 500; } };
    try {
      var fonts = resources && lk(PL, resources, 'Font', PL.PDFDict); if (!fonts) return out;
      var f = lk(PL, fonts, name, PL.PDFDict); if (!f) return out;
      var sub = f.lookup(PL.PDFName.of('Subtype')); sub = sub ? sub.toString() : '';
      if (sub === '/Type0') {
        out.two = true;
        var df = lk(PL, f, 'DescendantFonts', PL.PDFArray); df = df && df.lookup(0); if (!(df instanceof PL.PDFDict)) df = null;
        var dw = df && df.lookup(PL.PDFName.of('DW')); dw = dw ? dw.asNumber() : 1000;
        var W = df && lk(PL, df, 'W', PL.PDFArray), map = {};
        if (W) { var i = 0, n = W.size(); while (i < n) { var first = W.lookup(i).asNumber(), nx = W.lookup(i + 1);
          if (nx instanceof PL.PDFArray) { for (var k = 0; k < nx.size(); k++) map[first + k] = nx.lookup(k).asNumber(); i += 2; }
          else { var last = nx.asNumber(), wv = W.lookup(i + 2).asNumber(); for (var c = first; c <= last && c - first < 70000; c++) map[c] = wv; i += 3; } } }
        out.w = function (code) { return map[code] !== undefined ? map[code] : dw; };
      } else {
        var fc = f.lookup(PL.PDFName.of('FirstChar')), ws = lk(PL, f, 'Widths', PL.PDFArray), fd = lk(PL, f, 'FontDescriptor', PL.PDFDict);
        var miss = fd && fd.lookup(PL.PDFName.of('MissingWidth')); miss = miss ? miss.asNumber() : 500;
        var first0 = fc ? fc.asNumber() : 0, list = []; if (ws) for (var q = 0; q < ws.size(); q++) list.push(ws.lookup(q).asNumber());
        out.w = function (code) { var v = list[code - first0]; return v !== undefined ? v : miss; };
        if (sub === '/Type3') out.type3 = true;
      }
    } catch (e) { }
    return out;
  }

  function streamBytes(PL, st) {
    if (!st) return null;
    if (st instanceof PL.PDFRawStream) return PL.decodePDFRawStream(st).decode();
    return st.getContents ? st.getContents() : null;
  }
  // remove the text drawn inside the given boxes (PDF user space, y up) on one pdf-lib page,
  // including text kept inside reusable blocks (form XObjects), which many report generators use
  function removeText(PL, doc, page, boxes) {
    var res = { removed: 0, partial: 0, forms: 0 };
    if (!boxes.length) return res;
    var node = page.node, contents = node.Contents(); if (!contents) return res;
    var streams = contents instanceof PL.PDFArray ? contents.asArray().map(function (r) { return doc.context.lookup(r); }) : [contents];
    var parts = [], total = 0;
    for (var si = 0; si < streams.length; si++) { var data = streamBytes(PL, streams[si]); if (!data) return res; parts.push(data); total += data.length + 1; }
    var bytes = new Uint8Array(total), off = 0; parts.forEach(function (p) { bytes.set(p, off); off += p.length; bytes[off++] = 10; });
    var out = run(bytes, node.Resources(), [1, 0, 0, 1, 0, 0], 0);
    if (out) node.set(PL.PDFName.of('Contents'), doc.context.register(doc.context.flateStream(out)));
    if (window.PD_DEBUG) console.log('PDREMOVE', JSON.stringify(res), boxes.length);
    return res;

    function run(bytes, resources, baseCtm, depth) {
      var lx = new Lexer(bytes), operands = [], arr = null, edits = [];
      var gs = { ctm: baseCtm.slice(), fontName: null, fs: 1, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0, met: null }, gsStack = [];
      var Tm = [1, 0, 0, 1, 0, 0], Tlm = [1, 0, 0, 1, 0, 0], metCache = {};
      function startOf(t) { return operands.length ? operands[0].s : t.s; }
      function inBox(x, y, h, slack) { for (var i = 0; i < boxes.length; i++) { var b = boxes[i], fsb = (b.y1 - b.y0) / 1.15; if (x >= b.x0 - Math.max(1.5, fsb * 0.35) && x <= b.x1 + (slack || 1.5) && y >= b.y0 - h * 0.15 && y <= b.y1) return b; } return null; }
      function advanceOf(codes) {
        var m = gs.met || { two: false, w: function () { return 500; } }, adv = 0, step = m.two ? 2 : 1;
        for (var i = 0; i + step - 1 < codes.length; i += step) {
          var code = m.two ? (codes[i] << 8) | codes[i + 1] : codes[i];
          adv += m.w(code) / 1000 * gs.fs + gs.Tc + (!m.two && code === 32 ? gs.Tw : 0);
        }
        return adv;
      }
      function show(t, items, opStart, prefixOps) {
        var T = mul(Tm, gs.ctm), sy = Math.hypot(T[2], T[3]) * gs.fs || gs.fs, startPt = apply(T, 0, gs.Ts);
        var adv = 0; items.forEach(function (it) { adv += typeof it === 'number' ? -it / 1000 * gs.fs : advanceOf(it); });
        adv *= gs.Th;
        var endPt = apply(mul(mul([1, 0, 0, 1, adv, 0], Tm), gs.ctm), 0, gs.Ts);
        var hasText = items.some(function (it) { return typeof it !== 'number' && it.length; });
        // the end may run a little past the measured line (width tables differ slightly between programs)
        var b1 = hasText && inBox(startPt[0], startPt[1], sy), b2 = hasText && inBox(Math.max(startPt[0], endPt[0]) - 0.5, endPt[1], sy, Math.max(2, sy * 1.2));
        if (b1 && b2) {
          var n = -(adv / gs.Th) / gs.fs * 1000;           // keep the pen moving exactly as before, just draw nothing
          edits.push({ s: opStart, e: t.e, text: (prefixOps || '') + '[' + (Math.round(n * 1000) / 1000) + '] TJ' });
          res.removed++;
        } else if (b1 || b2) res.partial++;
        Tm = mul([1, 0, 0, 1, adv, 0], Tm);
      }
      var tok, guard = 0;
      while ((tok = lx.next()) && guard++ < 5e6) {
        if (tok.t === '[') { arr = { s: tok.s, items: [] }; continue; }
        if (tok.t === ']') { if (arr) { operands.push({ t: 'arr', v: arr.items, s: arr.s, e: tok.e }); arr = null; } continue; }
        if (arr) { if (tok.t === 'num') arr.items.push(tok.v); else if (tok.t === 'str') arr.items.push(tok.v); continue; }
        if (tok.t === 'dict<') { var d = 1, ds = tok.s; while (d && (tok = lx.next())) { if (tok.t === 'dict<') d++; else if (tok.t === 'dict>') d--; } operands.push({ t: 'dict', s: ds, e: tok ? tok.e : ds }); continue; }
        if (tok.t !== 'op') { operands.push(tok); continue; }
        var op = tok.v, a = operands, os = startOf(tok);
        switch (op) {
          case 'q': gsStack.push({ ctm: gs.ctm.slice(), fontName: gs.fontName, fs: gs.fs, Tc: gs.Tc, Tw: gs.Tw, Th: gs.Th, TL: gs.TL, Ts: gs.Ts, met: gs.met }); break;
          case 'Q': if (gsStack.length) gs = gsStack.pop(); break;
          case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(-6).map(function (x) { return x.v; }), gs.ctm); break;
          case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm.slice(); break;
          case 'Tf': if (a.length >= 2) { gs.fontName = a[a.length - 2].v; gs.fs = a[a.length - 1].v; gs.met = metCache[gs.fontName] || (metCache[gs.fontName] = fontMetrics(PL, doc, resources, gs.fontName)); } break;
          case 'Tc': gs.Tc = a.length ? a[a.length - 1].v : 0; break;
          case 'Tw': gs.Tw = a.length ? a[a.length - 1].v : 0; break;
          case 'Tz': gs.Th = (a.length ? a[a.length - 1].v : 100) / 100; break;
          case 'TL': gs.TL = a.length ? a[a.length - 1].v : 0; break;
          case 'Ts': gs.Ts = a.length ? a[a.length - 1].v : 0; break;
          case 'Td': if (a.length >= 2) { Tlm = mul([1, 0, 0, 1, a[a.length - 2].v, a[a.length - 1].v], Tlm); Tm = Tlm.slice(); } break;
          case 'TD': if (a.length >= 2) { gs.TL = -a[a.length - 1].v; Tlm = mul([1, 0, 0, 1, a[a.length - 2].v, a[a.length - 1].v], Tlm); Tm = Tlm.slice(); } break;
          case 'Tm': if (a.length >= 6) { Tlm = a.slice(-6).map(function (x) { return x.v; }); Tm = Tlm.slice(); } break;
          case 'T*': Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); break;
          case 'Tj': if (a.length && a[a.length - 1].t === 'str') show(tok, [a[a.length - 1].v], os); break;
          case 'TJ': if (a.length && a[a.length - 1].t === 'arr') show(tok, a[a.length - 1].v, os); break;
          case "'": Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); if (a.length && a[a.length - 1].t === 'str') show(tok, [a[a.length - 1].v], os, 'T* '); break;
          case '"': if (a.length >= 3) { gs.Tw = a[a.length - 3].v; gs.Tc = a[a.length - 2].v; Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); show(tok, [a[a.length - 1].v], os, gs.Tw + ' Tw ' + gs.Tc + ' Tc T* '); } break;
          case 'Do':
            if (depth < 6 && a.length && a[a.length - 1].t === 'name') {
              try {
                var xd = resources && lk(PL, resources, 'XObject', PL.PDFDict), nm = a[a.length - 1].v;
                var xs = xd && xd.lookup(PL.PDFName.of(nm));
                if (xs && xs.dict && String(xs.dict.lookup(PL.PDFName.of('Subtype'))) === '/Form') {
                  var mx = xs.dict.lookup(PL.PDFName.of('Matrix')), M = [1, 0, 0, 1, 0, 0]; if (!(mx instanceof PL.PDFArray)) mx = null;
                  if (mx) M = [0, 1, 2, 3, 4, 5].map(function (k) { return mx.lookup(k).asNumber(); });
                  var fres = xs.dict.lookup(PL.PDFName.of('Resources')); if (!(fres instanceof PL.PDFDict)) fres = resources;
                  var fb = streamBytes(PL, xs);
                  var changed = fb && run(fb, fres, mul(M, gs.ctm), depth + 1);
                  if (changed) {
                    // a changed copy of the block, used only here (other pages keep the original)
                    var ns = doc.context.flateStream(changed);
                    xs.dict.entries().forEach(function (en) { var k = en[0].toString(); if (k !== '/Filter' && k !== '/Length' && k !== '/DecodeParms') ns.dict.set(en[0], en[1]); });
                    var newName = 'PDe' + Math.random().toString(36).slice(2, 8);
                    xd.set(PL.PDFName.of(newName), doc.context.register(ns));
                    var nt = a[a.length - 1];
                    edits.push({ s: nt.s, e: nt.e, text: '/' + newName });
                    res.forms++;
                  }
                }
              } catch (err) { }
            }
            break;
          case 'BI':
            var j = lx.i; while (j < bytes.length - 2 && !(bytes[j] === 73 && bytes[j + 1] === 68 && WS[bytes[j + 2]] && WS[bytes[j - 1]])) j++;
            j += 3; while (j < bytes.length - 2 && !(WS[bytes[j - 1]] && bytes[j] === 69 && bytes[j + 1] === 73 && (j + 2 >= bytes.length || WS[bytes[j + 2]]))) j++;
            lx.i = j + 2; break;
        }
        operands = [];
      }
      if (!edits.length) return null;
      edits.sort(function (x, y) { return x.s - y.s; });
      var chunks = [], pos = 0, enc = new TextEncoder();
      edits.forEach(function (e) { if (e.s < pos) return; chunks.push(bytes.subarray(pos, e.s)); chunks.push(enc.encode(e.text)); pos = e.e; });
      chunks.push(bytes.subarray(pos));
      var len = chunks.reduce(function (s2, c) { return s2 + c.length; }, 0), outB = new Uint8Array(len), o2 = 0;
      chunks.forEach(function (c) { outB.set(c, o2); o2 += c.length; });
      return outB;
    }
  }

  // text colour of a word, read from the rendered page (darkest pixels that differ from the paper)
  function sampleTextColor(canvas, x, y, w, h, bg) {
    try {
      var ctx = canvas.getContext('2d'), d = ctx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
      var b = (bg || 'rgb(255,255,255)').match(/\d+/g).map(Number), best = null, bestD = 0, sum = [0, 0, 0], n = 0;
      for (var i = 0; i < d.length; i += 4) {
        var dd = Math.abs(d[i] - b[0]) + Math.abs(d[i + 1] - b[1]) + Math.abs(d[i + 2] - b[2]);
        if (dd > bestD) { bestD = dd; best = [d[i], d[i + 1], d[i + 2]]; }
      }
      if (!best || bestD < 60) return null;
      for (var j = 0; j < d.length; j += 4) {
        var e = Math.abs(d[j] - best[0]) + Math.abs(d[j + 1] - best[1]) + Math.abs(d[j + 2] - best[2]);
        if (e < 60) { sum[0] += d[j]; sum[1] += d[j + 1]; sum[2] += d[j + 2]; n++; }
      }
      var c = n ? sum.map(function (v) { return Math.round(v / n); }) : best;
      return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    } catch (e) { return null; }
  }

  function firstDir(t) { var m = /[A-Za-z\u00C0-\u024F]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.exec(t); return m && RTL.test(m[0]) ? 'rtl' : 'ltr'; }
  // right-to-left or complex text drawn as a sharp picture (the browser shapes it correctly)
  function textImage(text, opts) {
    var scale = 4, fs = opts.size * scale, fam = cssStack(opts.fam || 'naskh');
    var c = document.createElement('canvas'), g = c.getContext('2d');
    var font = (opts.italic ? 'italic ' : '') + (opts.bold ? 'bold ' : '') + fs + 'px ' + fam;
    g.font = font; var w = Math.ceil(g.measureText(text).width) + fs * 0.2, h = Math.ceil(fs * (opts.fam === 'nastaliq' ? 2.2 : 1.6));
    c.width = Math.max(2, w); c.height = Math.max(2, h); g = c.getContext('2d'); g.font = font; g.direction = firstDir(text);
    g.textAlign = g.direction === 'rtl' ? 'right' : 'left'; g.fillStyle = opts.color || '#000'; g.textBaseline = 'alphabetic';
    var base = Math.round(h * (opts.fam === 'nastaliq' ? 0.62 : 0.74));
    g.fillText(text, g.direction === 'rtl' ? c.width - fs * 0.1 : fs * 0.1, base);
    return { url: c.toDataURL('image/png'), w: c.width / scale, h: c.height / scale, base: base / scale, rtl: g.direction === 'rtl' };
  }

  window.PDEditCore = { CHOICES: CHOICES,
    familyFor: familyFor, cssFace: cssFace, cssStack: cssStack, embedFor: embedFor, needsScript: needsScript, RTL: RTL,
    removeText: removeText, firstDir: firstDir, sampleTextColor: sampleTextColor, textImage: textImage, loadFontkit: getFontkit
  };
})();
