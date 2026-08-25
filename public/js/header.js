/**
 * CamMaster Universal Header + Mobile Nav Injector
 * ─────────────────────────────────────────────────
 * Drop  <script src="js/header.js"></script>  (root)
 *  or   <script src="../js/header.js"></script> (tools/)
 * anywhere BEFORE </body>.  The script injects a <header> and the
 * mobile-nav-drawer immediately after <body>.  Path detection is
 * automatic via window.location.pathname.
 */
(function () {
  /* ── Path prefix ──────────────────────────────────────────────── */
  var p     = window.location.pathname;
  var depth = (p.match(/\//g) || []).length;
  /* / or /home.html → depth 1 → base = ""
     /tools/foo.html → depth 2 → base = "../"  */
  var base  = (depth >= 2 && p.indexOf('/tools/') !== -1) ? '../' : '';

  /* ── Logo SVG (shared) ─────────────────────────────────────────── */
  var SVG = '<svg class="logo-svg-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" role="img" aria-label="PDFdukan logo">'
    + '<defs><linearGradient id="cm-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6333"/><stop offset="100%" stop-color="#ff9055"/></linearGradient></defs>'
    + '<rect width="40" height="40" rx="10" fill="url(#cm-lg)"/>'
    + '<path d="M6 12L6 6L12 6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M34 12L34 6L28 6" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M6 28L6 34L12 34" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M34 28L34 34L28 34" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<rect x="12" y="10" width="12" height="16" rx="2" fill="white" fill-opacity="0.95"/>'
    + '<path d="M21 10L24 13L21 13Z" fill="#ff6333" fill-opacity="0.55"/>'
    + '<rect x="14" y="16" width="7" height="1.4" rx="0.7" fill="#ff6333" fill-opacity="0.75"/>'
    + '<rect x="14" y="19" width="9" height="1.4" rx="0.7" fill="#ff6333" fill-opacity="0.75"/>'
    + '<rect x="14" y="22" width="5" height="1.4" rx="0.7" fill="#ff6333" fill-opacity="0.75"/>'
    + '<circle cx="28.5" cy="29" r="7" fill="url(#cm-lg)"/>'
    + '<circle cx="28.5" cy="29" r="4.2" fill="none" stroke="white" stroke-width="1.4"/>'
    + '<circle cx="28.5" cy="29" r="1.8" fill="white"/>'
    + '<rect x="27.8" y="21.8" width="1.4" height="2.4" rx="0.7" fill="white"/>'
    + '<rect x="27.8" y="33.8" width="1.4" height="2.4" rx="0.7" fill="white"/>'
    + '<rect x="21.8" y="28.3" width="2.4" height="1.4" rx="0.7" fill="white"/>'
    + '<rect x="33.8" y="28.3" width="2.4" height="1.4" rx="0.7" fill="white"/>'
    + '</svg>';

  /* ── HEADER HTML ───────────────────────────────────────────────── */
  var headerHTML = '<header class="header" role="banner">'

    /* Brand */
    + '<a href="/" class="logo-svg-wrap" aria-label="PDFdukan — Home">'
    + SVG
    + '<div class="logo-text"><div class="brand">PDFdukan</div><div class="sub">CamMaster</div></div>'
    + '</a>'

    /* Navigation */
    + '<nav class="nav-links" aria-label="Site navigation">'

      + '<a href="/" class="nav-item">Home</a>'

      /* Tools mega-dropdown */
      + '<div class="nav-item has-dropdown" tabindex="0" role="button" aria-haspopup="true" aria-expanded="false">'
        + 'Tools <span class="nav-chevron">&#9662;</span>'
        + '<div class="nav-dropdown mega" role="menu">'

          /* Column 1 — PDF Tools */
          + '<div class="nd-col">'
            + '<span class="nd-section-head">&#128196; PDF Tools</span>'
            + '<a href="' + base + 'tools/img-to-pdf.html"    class="nd-link" role="menuitem"><span class="nd-link-icon">&#128209;</span><div class="nd-link-body"><div class="nd-link-name">Image &#8594; PDF</div><div class="nd-link-desc">JPG, PNG, WEBP to PDF</div></div></a>'
            + '<a href="' + base + 'tools/pdf-to-img.html"    class="nd-link" role="menuitem"><span class="nd-link-icon">&#128247;</span><div class="nd-link-body"><div class="nd-link-name">PDF &#8594; JPG</div><div class="nd-link-desc">Extract pages as images</div></div></a>'
            + '<a href="' + base + 'tools/crop-pdf.html"      class="nd-link" role="menuitem"><span class="nd-link-icon">&#9986;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">Crop PDF</div><div class="nd-link-desc">Cut a region to image</div></div></a>'
            + '<a href="' + base + 'tools/merge-pdf.html"     class="nd-link" role="menuitem"><span class="nd-link-icon">&#128279;</span><div class="nd-link-body"><div class="nd-link-name">Merge PDF</div><div class="nd-link-desc">Combine multiple PDFs</div></div></a>'
            + '<a href="' + base + 'tools/split-pdf.html"     class="nd-link" role="menuitem"><span class="nd-link-icon">&#9986;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">Split PDF</div><div class="nd-link-desc">Divide by page ranges</div></div></a>'
            + '<a href="' + base + 'tools/compress-pdf.html"  class="nd-link" role="menuitem"><span class="nd-link-icon">&#128201;</span><div class="nd-link-body"><div class="nd-link-name">Compress PDF</div><div class="nd-link-desc">Reduce file size</div></div></a>'
            + '<a href="' + base + 'tools/pdf-to-word.html"   class="nd-link" role="menuitem"><span class="nd-link-icon">&#128221;</span><div class="nd-link-body"><div class="nd-link-name">PDF &#8594; Word</div><div class="nd-link-desc">Extract text to .doc</div></div></a>'
            + '<a href="' + base + 'tools/word-to-pdf.html"   class="nd-link" role="menuitem"><span class="nd-link-icon">&#128196;</span><div class="nd-link-body"><div class="nd-link-name">Word &#8594; PDF</div><div class="nd-link-desc">Convert DOCX to PDF</div></div></a>'
            + '<a href="' + base + 'tools/pdf-to-ppt.html"    class="nd-link" role="menuitem"><span class="nd-link-icon">&#128202;</span><div class="nd-link-body"><div class="nd-link-name">PDF &#8594; PowerPoint</div><div class="nd-link-desc">Slides to PPTX</div></div></a>'
            + '<a href="' + base + 'tools/pdf-to-excel.html"  class="nd-link" role="menuitem"><span class="nd-link-icon">&#128203;</span><div class="nd-link-body"><div class="nd-link-name">PDF &#8594; Excel</div><div class="nd-link-desc">Tables to XLSX</div></div></a>'
            + '<a href="' + base + 'tools/html-to-pdf.html"   class="nd-link" role="menuitem"><span class="nd-link-icon">&#127760;</span><div class="nd-link-body"><div class="nd-link-name">HTML &#8594; PDF</div><div class="nd-link-desc">URL or HTML to PDF</div></div></a>'
          + '</div>'

          /* Column 2 — Edit & Sign + Image & Scan */
          + '<div class="nd-col">'
            + '<span class="nd-section-head">&#9999;&#65039; Edit &amp; Sign</span>'
            + '<a href="' + base + 'tools/pdf-editor.html"    class="nd-link" role="menuitem"><span class="nd-link-icon">&#9999;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">PDF Editor</div><div class="nd-link-desc">Edit text &amp; objects</div></div></a>'
            + '<a href="' + base + 'tools/fill-sign.html"     class="nd-link" role="menuitem"><span class="nd-link-icon">&#9997;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">Fill &amp; Sign</div><div class="nd-link-desc">Digital signatures</div></div></a>'
            + '<a href="' + base + 'tools/watermark.html"     class="nd-link" role="menuitem"><span class="nd-link-icon">&#128167;</span><div class="nd-link-body"><div class="nd-link-name">Watermark</div><div class="nd-link-desc">Stamp text or image</div></div></a>'
            + '<a href="' + base + 'tools/page-numbers.html"  class="nd-link" role="menuitem"><span class="nd-link-icon">&#128290;</span><div class="nd-link-body"><div class="nd-link-name">Page Numbers</div><div class="nd-link-desc">Auto-number all pages</div></div></a>'
            + '<a href="' + base + 'tools/pdf-organizer.html" class="nd-link" role="menuitem"><span class="nd-link-icon">&#128451;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">PDF Organizer</div><div class="nd-link-desc">Rotate, reorder &amp; delete</div></div></a>'
            + '<div class="nd-divider"></div>'
            + '<span class="nd-section-head">&#128247; Image &amp; Scan</span>'
            + '<a href="' + base + 'scanner.html"             class="nd-link" role="menuitem"><span class="nd-link-icon">&#128247;</span><div class="nd-link-body"><div class="nd-link-name">Smart Scan</div><div class="nd-link-desc">AI edge detection</div></div></a>'
            + '<a href="' + base + 'tools/compress.html"      class="nd-link" role="menuitem"><span class="nd-link-icon">&#128284;</span><div class="nd-link-body"><div class="nd-link-name">Image Compressor &amp; Resizer</div><div class="nd-link-desc">JPG, PNG, WebP optimizer</div></div></a>'
            + '<a href="' + base + 'tools/ocr.html"           class="nd-link" role="menuitem"><span class="nd-link-icon">&#128292;</span><div class="nd-link-body"><div class="nd-link-name">OCR Text</div><div class="nd-link-desc">Image to editable text</div></div></a>'
            + '<div class="nd-divider"></div>'
            + '<span class="nd-section-head">&#128295; Specialist Tool</span>'
            + '<a href="' + base + 'tools/inheritance-calc-advanced.html" class="nd-link" role="menuitem"><span class="nd-link-icon">&#9764;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">Islamic Inheritance</div><div class="nd-link-desc">Warasat Intikal calculator</div></div></a>'
          + '</div>'

        + '</div>' /* /.nav-dropdown.mega */
      + '</div>' /* /.nav-item.has-dropdown (Tools) */

      + '<a href="' + base + 'blog/index.html" class="nav-item">Blog</a>'

      /* Legal dropdown */
      + '<div class="nav-item has-dropdown" tabindex="0" role="button" aria-haspopup="true" aria-expanded="false">'
        + 'Legal <span class="nav-chevron">&#9662;</span>'
        + '<div class="nav-dropdown legal" role="menu">'
          + '<a href="' + base + 'about.html"   class="nd-link" role="menuitem"><span class="nd-link-icon">&#127970;</span><div class="nd-link-body"><div class="nd-link-name">About Us</div></div></a>'
          + '<a href="' + base + 'privacy.html" class="nd-link" role="menuitem"><span class="nd-link-icon">&#128274;</span><div class="nd-link-body"><div class="nd-link-name">Privacy Policy</div></div></a>'
          + '<a href="' + base + 'terms.html"   class="nd-link" role="menuitem"><span class="nd-link-icon">&#128203;</span><div class="nd-link-body"><div class="nd-link-name">Terms of Service</div></div></a>'
          + '<a href="' + base + 'cookies.html" class="nd-link" role="menuitem"><span class="nd-link-icon">&#127850;</span><div class="nd-link-body"><div class="nd-link-name">Cookie Policy</div></div></a>'
          + '<div class="nd-divider"></div>'
          + '<a href="' + base + 'sitemap.xml"  class="nd-link" role="menuitem"><span class="nd-link-icon">&#128506;&#65039;</span><div class="nd-link-body"><div class="nd-link-name">Sitemap</div></div></a>'
        + '</div>'
      + '</div>'

    + '</nav>' /* /.nav-links */

    /* Search */
    + '<div class="search-wrap" role="search">'
      + '<span class="search-icon" aria-hidden="true">'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      + '</span>'
      + '<input type="search" class="search-input" placeholder="Search tools… (Ctrl+K)" aria-label="Search">'
    + '</div>'

    /* Header actions */
    + '<div class="header-actions">'
      + '<button class="icon-btn" onclick="toggleTheme()" aria-label="Toggle theme" title="Toggle dark/light mode"><span id="themeIcon">&#127769;</span></button>'
      + '<button class="icon-btn notif-btn-wrap" id="notifBtn" onclick="toggleNotifications()" aria-label="Notifications" style="position:relative">'
        + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
        + '<span id="notifBadge" style="display:none;position:absolute;top:2px;right:2px;width:16px;height:16px;background:var(--error);color:#fff;border-radius:50%;font-size:10px;font-weight:700;align-items:center;justify-content:center;line-height:1">0</span>'
      + '</button>'
      + '<button class="hamburger-btn" id="hamburgerBtn" onclick="toggleMobileNav()" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>'
      + '<div class="lang-selector" aria-label="Language selector">'
        + '<button class="lang-btn" aria-haspopup="true" aria-expanded="false">'
          + '<svg class="lang-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
          + '<span class="lang-flag-current">&#127482;&#127480;</span>'
          + '<span class="lang-label">EN</span>'
        + '</button>'
        + '<div class="lang-dropdown" role="menu"></div>'
      + '</div>'
      + '<button class="auth-btn" onclick="openAuth()" id="authBtn" aria-label="Sign in or account">'
        + '<span class="avatar" id="userAvatar">U</span><span id="authLabel">Sign In</span>'
      + '</button>'
    + '</div>' /* /.header-actions */

  + '</header>'; /* /.header */

  /* ── MOBILE NAV DRAWER ─────────────────────────────────────────── */
  var mobileHTML = '<div class="mobile-nav-drawer" id="mobileNavDrawer" aria-label="Mobile menu" aria-hidden="true">'
    + '<a href="/" class="mnd-link">&#127968; Home</a>'
    + '<div class="mnd-section">&#128196; PDF Tools</div>'
    + '<a href="' + base + 'tools/img-to-pdf.html"    class="mnd-link">&#128209; Image to PDF</a>'
    + '<a href="' + base + 'tools/pdf-to-img.html"    class="mnd-link">&#128247; PDF to JPG</a>'
    + '<a href="' + base + 'tools/crop-pdf.html"      class="mnd-link">&#9986;&#65039; Crop PDF</a>'
    + '<a href="' + base + 'tools/merge-pdf.html"     class="mnd-link">&#128279; Merge PDF</a>'
    + '<a href="' + base + 'tools/split-pdf.html"     class="mnd-link">&#9986;&#65039; Split PDF</a>'
    + '<a href="' + base + 'tools/compress-pdf.html"  class="mnd-link">&#128201; Compress PDF</a>'
    + '<a href="' + base + 'tools/pdf-to-word.html"   class="mnd-link">&#128221; PDF to Word</a>'
    + '<a href="' + base + 'tools/word-to-pdf.html"   class="mnd-link">&#128196; Word to PDF</a>'
    + '<div class="mnd-section">&#9999;&#65039; Edit &amp; Sign</div>'
    + '<a href="' + base + 'tools/pdf-editor.html"    class="mnd-link">&#9999;&#65039; PDF Editor</a>'
    + '<a href="' + base + 'tools/fill-sign.html"     class="mnd-link">&#9997;&#65039; Fill &amp; Sign</a>'
    + '<a href="' + base + 'tools/watermark.html"     class="mnd-link">&#128167; Watermark</a>'
    + '<a href="' + base + 'tools/page-numbers.html"  class="mnd-link">&#128290; Page Numbers</a>'
    + '<a href="' + base + 'tools/pdf-organizer.html" class="mnd-link">&#128451;&#65039; PDF Organizer</a>'
    + '<div class="mnd-section">&#128247; Image &amp; Scan</div>'
    + '<a href="' + base + 'scanner.html"             class="mnd-link">&#128247; Smart Scan</a>'
    + '<a href="' + base + 'tools/compress.html"      class="mnd-link">&#128284; Image Compressor</a>'
    + '<a href="' + base + 'tools/ocr.html"           class="mnd-link">&#128292; OCR Text</a>'
    + '<div class="mnd-section">&#128295; Specialist Tool</div>'
    + '<a href="' + base + 'tools/inheritance-calc-advanced.html" class="mnd-link">&#9764;&#65039; Islamic Inheritance</a>'
    + '<a href="' + base + 'blog/index.html"          class="mnd-link">&#128203; Blog</a>'
    + '<a href="' + base + 'about.html"               class="mnd-link">&#127970; About</a>'
    + '<a href="' + base + 'privacy.html"             class="mnd-link">&#128274; Privacy</a>'
  + '</div>';

  /* ── Inject ────────────────────────────────────────────────────── */
  /* This script can be placed anywhere in <body>.  It removes any
     pre-existing hardcoded header + mobile drawer and injects the
     authoritative shared version at the very top of <body>.       */
  var body = document.body;

  /* Remove pre-existing static header (hardcoded in HTML) */
  var oldHeader = document.querySelector('header.header');
  if (oldHeader) oldHeader.remove();

  /* Remove pre-existing mobile nav drawer */
  var oldMND = document.getElementById('mobileNavDrawer');
  if (oldMND) oldMND.remove();

  /* Build fragment and prepend to body */
  var tmp = document.createElement('div');
  tmp.innerHTML = headerHTML + mobileHTML;
  var ref = body.firstChild;   /* particle canvas or first element */
  while (tmp.firstChild) {
    body.insertBefore(tmp.firstChild, ref);
  }

  /* ── Highlight active nav item ─────────────────────────────────── */
  var currentPath = window.location.pathname;
  document.querySelectorAll('.nav-item, .nd-link, .mnd-link').forEach(function (a) {
    if (a.tagName !== 'A') return;
    var href = a.getAttribute('href') || '';
    /* Match on the last segment of the path */
    var seg = href.replace(/^(\.\.\/)+/, '').replace(/^\//, '');
    if (seg && currentPath.indexOf(seg) !== -1) {
      a.classList.add('active');
    }
  });

})();
