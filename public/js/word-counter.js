/* Word & Character Counter — runs entirely in the browser. Nothing is stored or sent. */
(function () {
  'use strict';
  var READ_WPM = 238;   // average silent reading rate, non-fiction (Brysbaert, 2019)
  var SPEAK_WPM = 183;  // average reading-aloud rate (Brysbaert, 2019)
  var WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’.\-][\p{L}\p{M}\p{N}]+|[,:]\p{N}+)*/gu;
  var SENT_RE = /[^.!?…\n]*[\p{L}\p{N}][^.!?…\n]*(?:[.!?…]+|(?=\n)|$)/gu;
  var STOP = new Set(('a an and are as at be but by for from has have he her his i if in into is it its me my not of on or our she so that the their them they this to was we were what when which who will with you your').split(' '));
  var seg = null;
  try { if (window.Intl && Intl.Segmenter) seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } catch (e) { seg = null; }

  function graphemes(s) {
    if (!s) return 0;
    if (seg) { var n = 0; for (var _ of seg.segment(s)) n++; return n; }
    return Array.from(s).length;
  }
  // Common abbreviations should not end a sentence ("Dr. Smith", "U.S. office", "e.g. this").
  var ABBR_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|approx|dept|No|Inc|Ltd|Co|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.(?=\s+[\p{L}\p{N}])/gu;
  function noAbbr(s) {
    return s.replace(ABBR_RE, function (m) { return m.slice(0, -1); })
            .replace(/\b(?:\p{L}\.){2,}(?=\s+\p{Ll})/gu, function (m) { return m.replace(/\./g, ''); })
            .replace(/\b(?:\p{L}\.){2,}/gu, function (m) { return m.slice(0, -1).replace(/\./g, '') + '.'; })
            .replace(/\b(?:e\.g|i\.e|a\.m|p\.m)\.(?=\s+\p{Ll})/giu, function (m) { return m.replace(/\./g, ''); });
  }
  function words(s) { return s.match(WORD_RE) || []; }
  function stats(s) {
    var w = words(s);
    // a word is any run of text between spaces or line breaks (the usual word-processor rule)
    var tokens = s.split(/\s+/).filter(function (x) { return x.length; });
    var sentences = (noAbbr(s).match(SENT_RE) || []).filter(function (x) { return /[\p{L}\p{N}]/u.test(x); }).length;
    var paragraphs = s.split(/\n/).filter(function (l) { return l.trim(); }).length;
    return {
      words: tokens.length,
      // line breaks are not characters you can see, so they are left out
      chars: graphemes(s.replace(/[\r\n]+/g, '')),
      charsNs: graphemes(s.replace(/\s+/g, '')),
      sentences: sentences,
      paragraphs: paragraphs,
      unique: new Set(w.map(function (x) { return x.toLocaleLowerCase(); })).size,
      list: w
    };
  }
  function fmtTime(nWords, wpm) {
    var sec = Math.round(nWords / wpm * 60);
    if (sec < 60) return sec + ' sec';
    var m = Math.floor(sec / 60), r = sec % 60;
    if (m >= 60) { var h = Math.floor(m / 60); return h + ' hr ' + (m % 60) + ' min'; }
    return m + ' min' + (r ? ' ' + r + ' sec' : '');
  }
  var nf = new Intl.NumberFormat('en-US');
  function $(id) { return document.getElementById(id); }

  function limit(count, inputId, fillId, msgId, unit) {
    var lim = parseInt($(inputId).value, 10), fill = $(fillId), msg = $(msgId);
    if (!lim || lim < 1) { fill.style.width = '0'; fill.classList.remove('over'); msg.classList.remove('over'); msg.textContent = 'Enter a number to track it.'; return; }
    var pct = Math.min(100, count / lim * 100);
    fill.style.width = pct + '%';
    var over = count > lim;
    fill.classList.toggle('over', over); msg.classList.toggle('over', over);
    msg.textContent = over
      ? nf.format(count - lim) + ' ' + unit + (count - lim === 1 ? '' : 's') + ' over the limit'
      : nf.format(lim - count) + ' ' + unit + (lim - count === 1 ? '' : 's') + ' left (' + Math.round(count / lim * 100) + '% used)';
  }

  function topWords(list) {
    var skip = $('wcSkipCommon').checked, freq = new Map();
    list.forEach(function (w) {
      var k = w.toLocaleLowerCase();
      if (skip && (STOP.has(k) || /^[\p{N},:.]+$/u.test(k))) return;
      freq.set(k, (freq.get(k) || 0) + 1);
    });
    var total = list.length;
    var top = Array.from(freq.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }).slice(0, 10);
    var ol = $('wcTop');
    ol.textContent = '';
    if (!top.length) { var li = document.createElement('li'); li.className = 'wc-empty'; li.textContent = 'Your 10 most-used words will appear here.'; ol.appendChild(li); return; }
    top.forEach(function (t) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.className = 'w'; a.textContent = t[0];
      var b = document.createElement('span'); b.className = 'n'; b.textContent = t[1] + ' × · ' + (t[1] / total * 100).toFixed(1) + '%';
      li.appendChild(a); li.appendChild(b); ol.appendChild(li);
    });
  }

  function update() {
    var s = $('wcText').value, st = stats(s);
    $('stWords').textContent = nf.format(st.words);
    $('stChars').textContent = nf.format(st.chars);
    $('stCharsNs').textContent = nf.format(st.charsNs);
    $('stSent').textContent = nf.format(st.sentences);
    $('stPara').textContent = nf.format(st.paragraphs);
    $('stUniq').textContent = nf.format(st.unique);
    $('stRead').textContent = fmtTime(st.words, READ_WPM);
    $('stSpeak').textContent = fmtTime(st.words, SPEAK_WPM);
    limit(st.words, 'wcWordLimit', 'wcWordFill', 'wcWordMsg', 'word');
    limit(st.chars, 'wcCharLimit', 'wcCharFill', 'wcCharMsg', 'character');
    topWords(st.list);
    selection();
  }

  function selection() {
    var ta = $('wcText'), out = $('wcSelection');
    var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (!sel || ta.selectionStart === ta.selectionEnd) { out.textContent = ''; return; }
    var st = stats(sel);
    out.textContent = 'Selected: ' + nf.format(st.words) + ' word' + (st.words === 1 ? '' : 's') + ' · ' + nf.format(st.chars) + ' character' + (st.chars === 1 ? '' : 's');
  }

  var raf = 0;
  function schedule() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; update(); }); }

  var backup = '', undoTimer = 0;
  function init() {
    var ta = $('wcText');
    if (!ta) return;
    ta.addEventListener('input', schedule);
    ['select', 'keyup', 'mouseup', 'touchend'].forEach(function (ev) { ta.addEventListener(ev, selection); });
    document.addEventListener('selectionchange', function () { if (document.activeElement === ta) selection(); });
    ['wcWordLimit', 'wcCharLimit'].forEach(function (id) { $(id).addEventListener('input', schedule); });
    $('wcSkipCommon').addEventListener('change', schedule);
    $('wcCopy').addEventListener('click', function () {
      var t = ta.value;
      if (!t) { if (window.toast) toast('There is no text to copy yet', 'error'); return; }
      var done = function () { if (window.toast) toast('Text copied ✓', 'success'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done, function () { ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} });
      } else { ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} }
    });
    $('wcClear').addEventListener('click', function () {
      if (!ta.value) return;
      backup = ta.value; ta.value = ''; update(); ta.focus();
      var u = $('wcUndo'); u.hidden = false;
      clearTimeout(undoTimer); undoTimer = setTimeout(function () { u.hidden = true; backup = ''; }, 10000);
    });
    $('wcUndo').addEventListener('click', function () {
      if (!backup) return;
      ta.value = backup; backup = ''; this.hidden = true; clearTimeout(undoTimer); update(); ta.focus();
    });
    update();
  }
  window.WordCounter = { stats: stats };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
