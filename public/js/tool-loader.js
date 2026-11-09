/* PDFdukan: branded full-screen loader used by the tools (same look as the scanner) */
(function () {
  'use strict';
  var el = null;
  var SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="36" height="36" aria-hidden="true"><defs><linearGradient id="tlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6333"/><stop offset="100%" stop-color="#ff9055"/></linearGradient></defs><rect width="40" height="40" rx="10" fill="url(#tlg)"/><path d="M6 12L6 6L12 6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 12L34 6L28 6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="12" y="10" width="12" height="16" rx="2" fill="white" fill-opacity="0.95"/><path d="M21 10L24 13L21 13Z" fill="#ff6333" fill-opacity="0.55"/><rect x="14" y="16" width="7" height="1.4" rx="0.7" fill="#ff6333" fill-opacity="0.75"/><rect x="14" y="19" width="9" height="1.4" rx="0.7" fill="#ff6333" fill-opacity="0.75"/><rect x="14" y="22" width="5" height="1.4" rx="0.7" fill="#ff6333" fill-opacity="0.75"/></svg>';
  function make() {
    if (el) return el;
    el = document.getElementById('brandLoader');
    if (!el) {
      el = document.createElement('div');
      el.className = 'brand-loader-overlay'; el.id = 'brandLoader'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<div class="brand-loader-ring"><div class="brand-loader-glow"></div><div class="brand-loader-icon">' + SVG + '</div></div><div class="brand-loader-text">Processing…</div><div class="brand-loader-sub">Please wait</div><button type="button" class="pd-loader-cancel" hidden>Cancel</button>';
      document.body.appendChild(el);
    }
    return el;
  }
  window.PDLoader = {
    show: function (text, sub, onCancel) {
      var e = make();
      e.querySelector('.brand-loader-text').textContent = text || 'Processing…';
      e.querySelector('.brand-loader-sub').textContent = sub || 'Please wait';
      var c = e.querySelector('.pd-loader-cancel');
      if (c) { c.hidden = !onCancel; c.onclick = onCancel || null; }
      e.classList.add('show');
    },
    update: function (text, sub) {
      var e = make();
      if (text != null) e.querySelector('.brand-loader-text').textContent = text;
      if (sub != null) e.querySelector('.brand-loader-sub').textContent = sub;
    },
    hide: function () { if (el) el.classList.remove('show'); }
  };
})();
