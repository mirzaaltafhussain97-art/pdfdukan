/* ================================================================
   CamMaster by PDFdukan — Core App Module
   Theme · Toast · Auth · Navigation · Recent Docs · Settings
   Notifications · Storage UI · Pending File Transfer
================================================================ */

/* ── LAZY SCRIPT LOADER ──────────────────────────────────────────
   Loads a <script src> once, on demand, and resolves when ready.
   Lets heavy CDN libraries (Tesseract, onnxruntime, …) download
   only when a tool is actually used instead of on every page load. */
window.loadScriptOnce = (function () {
  const _cache = {};
  return function loadScriptOnce(url) {
    if (_cache[url]) return _cache[url];
    _cache[url] = new Promise((resolve, reject) => {
      // Already present on the page? resolve immediately.
      const existing = document.querySelector('script[src="' + url + '"]');
      if (existing && existing.dataset.loaded === '1') { resolve(); return; }
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload  = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => { delete _cache[url]; reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
    return _cache[url];
  };
})();

/* ── STATE ───────────────────────────────────────────────────── */
/* Auto theme by local time-of-day: 6:00–17:59 = light (day), else dark (night).
   Used whenever the user hasn't manually picked a theme (mode = 'auto'). */
function autoThemeByTime() {
  const h = new Date().getHours();
  return (h >= 6 && h < 18) ? 'light' : 'dark';
}

const STATE = {
  /* Default = auto (time-based, light in daytime). A manual toggle locks it. */
  theme: (() => {
    const mode = localStorage.getItem('cm_theme_mode') || 'auto';
    if (mode === 'manual') {
      const saved = localStorage.getItem('cm_theme');
      if (saved) return saved;
    }
    return autoThemeByTime();
  })(),
  user: (() => { try { return JSON.parse(localStorage.getItem('cm_user')); } catch(e) { return null; } })(),
  recentDocs: (() => { try { return JSON.parse(localStorage.getItem('cm_recent')) || []; } catch(e) { return []; } })(),
};

/* ── SETTINGS ─────────────────────────────────────────────────── */
const SETTINGS = (() => {
  const defaults = { exportFormat: 'pdf', quality: 'balanced', scanFilter: 'enhance' };
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem('cm_settings')) || {}) }; }
  catch(e) { return { exportFormat: 'pdf', quality: 'balanced', scanFilter: 'enhance' }; }
})();

function saveSetting(key, val) {
  SETTINGS[key] = val;
  localStorage.setItem('cm_settings', JSON.stringify(SETTINGS));
}

/* ── OTP FLOW STATE ──────────────────────────────────────────── */
let _pendingSignup = null;  // { name, email, pass }
let _otpPurpose    = null;  // 'signup' | 'verify'
let _otpCountdown  = null;  // countdown setInterval ref

function _isOTPVerified(email) {
  if (!email) return false;
  try {
    const list = JSON.parse(localStorage.getItem('cm_otp_verified') || '[]');
    return list.includes(email.toLowerCase());
  } catch(e) { return false; }
}
function _markOTPVerified(email) {
  if (!email) return;
  try {
    const em = email.toLowerCase();
    const list = JSON.parse(localStorage.getItem('cm_otp_verified') || '[]');
    if (!list.includes(em)) { list.push(em); localStorage.setItem('cm_otp_verified', JSON.stringify(list)); }
  } catch(e) {}
}

/* ── NOTIFICATIONS ────────────────────────────────────────────── */
const NOTIFICATIONS_DATA = [
  { id: 1, icon: '🎉', title: 'Welcome to CamMaster!',       body: 'Scan, convert and manage documents — all free, all in your browser. No uploads, no sign-up required.',            date: '2026-05-20' },
  { id: 2, icon: '✨', title: 'New: Smart PDF Merge',         body: 'Select specific pages per file before merging. More control than ever — try it in the Merge PDF tool!',           date: '2026-05-22' },
  { id: 3, icon: '🔒', title: 'Browser-Based File Processing', body: 'Core document operations run in your browser. Check each tool page for its exact processing, third-party assets and limitations.', date: '2026-08-25' },
  { id: 4, icon: '📱', title: 'Mobile-Ready Scanner',         body: 'Use CamMaster from your smartphone browser. Auto-detect edges, enhance images, export PDFs instantly.',            date: '2026-05-25' },
];

function _getReadIds() {
  try { return JSON.parse(localStorage.getItem('cm_read_notifs')) || []; }
  catch(e) { return []; }
}
function getNotifications() {
  const read = _getReadIds();
  return NOTIFICATIONS_DATA.map(n => ({ ...n, read: read.includes(n.id) }));
}
function markAllRead() {
  localStorage.setItem('cm_read_notifs', JSON.stringify(NOTIFICATIONS_DATA.map(n => n.id)));
  renderNotificationBadge();
  document.querySelectorAll('.notif-item').forEach(el => el.classList.add('read'));
  const btn = document.getElementById('markAllReadBtn');
  if (btn) btn.style.display = 'none';
}
function toggleNotifications() {
  const overlay = document.getElementById('notifOverlay');
  if (!overlay) return;
  if (overlay.classList.contains('show')) {
    overlay.classList.remove('show');
    return;
  }
  renderNotifications();
  overlay.classList.add('show');
  setTimeout(() => {
    document.addEventListener('click', _closeNotifOutside, { once: true });
  }, 10);
}
function _closeNotifOutside(e) {
  const overlay = document.getElementById('notifOverlay');
  const btn = document.getElementById('notifBtn');
  if (overlay && !overlay.contains(e.target) && !btn?.contains(e.target)) {
    overlay.classList.remove('show');
  }
}
function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;
  const notifs = getNotifications();
  const unread = notifs.filter(n => !n.read).length;
  const markBtn = document.getElementById('markAllReadBtn');
  if (markBtn) markBtn.style.display = unread > 0 ? 'inline-block' : 'none';
  list.innerHTML = notifs.length
    ? notifs.map(n => `
        <div class="notif-item${n.read ? ' read' : ''}">
          <div class="ni-icon">${n.icon}</div>
          <div class="ni-body">
            <div class="ni-title">${n.title}</div>
            <div class="ni-text">${n.body}</div>
            <div class="ni-date">${n.date}</div>
          </div>
        </div>`).join('')
    : '<div class="notif-empty">No notifications</div>';
}
function renderNotificationBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const unread = getNotifications().filter(n => !n.read).length;
  badge.textContent = unread;
  badge.style.display = unread > 0 ? 'flex' : 'none';
}

/* ── PENDING FILE TRANSFER ────────────────────────────────────── */
// Store files as data URLs in sessionStorage for cross-page handoff
async function storePendingFiles(files) {
  const arr = [];
  for (const f of files) {
    try {
      const dataURL = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });
      arr.push({ name: f.name, type: f.type, size: f.size, dataURL });
    } catch(e) { /* skip file on error */ }
  }
  try {
    sessionStorage.setItem('cm_pending_files', JSON.stringify(arr));
    return true;
  } catch(e) {
    // Quota exceeded for large files — redirect without pre-load
    console.warn('storePendingFiles: storage quota exceeded', e);
    return false;
  }
}

// Reconstruct File objects from sessionStorage and clear the entry
function consumePendingFiles() {
  try {
    const raw = sessionStorage.getItem('cm_pending_files');
    if (!raw) return null;
    sessionStorage.removeItem('cm_pending_files');
    const arr = JSON.parse(raw);
    if (!arr || !arr.length) return null;
    return arr.map(item => {
      const byteString = atob(item.dataURL.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      return new File([ab], item.name, { type: item.type });
    });
  } catch(e) {
    console.error('consumePendingFiles failed', e);
    return null;
  }
}

/* ── STORAGE UI ───────────────────────────────────────────────── */
function _fmtStorageBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}
function updateStorageUI() {
  const card = document.getElementById('storageCard');
  const driveReady = localStorage.getItem('pdfdukan_drive_setup_done') === 'true';

  if (card) {
    if (STATE.user && driveReady) {
      // ── DRIVE CONNECTED view ──────────────────────────────────────────
      card.innerHTML =
        '<div class="sc-label">' +
          '<span style="display:flex;align-items:center;gap:5px">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34a853" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
            '☁️ Google Drive' +
          '</span>' +
          '<span style="color:#34a853;font-size:11px;font-weight:700">Connected</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:7px;margin:8px 0 4px">' +
          '<span style="font-size:15px">📁</span>' +
          '<span style="font-size:12px;color:var(--text-2);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            'PDFdukan — CamMaster Files' +
          '</span>' +
        '</div>' +
        '<div class="sc-bar"><div class="sc-fill" style="width:5%;background:linear-gradient(90deg,#34a853,#4caf50)"></div></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px">' +
          '<span style="font-size:11px;color:var(--text-3)">Up to 5 GB available</span>' +
          '<a href="https://drive.google.com" target="_blank" rel="noopener" ' +
            'style="font-size:11px;color:var(--primary);text-decoration:none;font-weight:700;flex-shrink:0">' +
            'Open Drive →' +
          '</a>' +
        '</div>';
      return;
    }
    if (STATE.user && !driveReady) {
      // ── SIGNED IN, Drive not set up yet ─────────────────────────────
      card.innerHTML =
        '<div class="sc-label"><span>Storage</span><span id="storageUsage">Local</span></div>' +
        '<div class="sc-bar"><div class="sc-fill" id="storageBar" style="width:2%"></div></div>' +
        '<p class="sc-hint" id="storageHint" style="color:var(--primary);font-size:11px;cursor:pointer" ' +
          'onclick="_initGDriveStorage(_gdriveToken())">☁️ Connect Google Drive →</p>';
      return;
    }
    // ── NOT SIGNED IN ───────────────────────────────────────────────────
    card.innerHTML =
      '<div class="sc-label"><span>Storage</span><span id="storageUsage">Local</span></div>' +
      '<div class="sc-bar"><div class="sc-fill" id="storageBar" style="width:2%"></div></div>' +
      '<p class="sc-hint" id="storageHint">☁️ Sign in to connect Google Drive</p>';
    return;
  }

  // ── Fallback: update individual elements (for pages without storageCard) ──
  let totalBytes = 0;
  try {
    Object.keys(localStorage).forEach(key => {
      totalBytes += (localStorage.getItem(key) || '').length * 2; // UTF-16
    });
  } catch(e) {}
  const MAX = 5 * 1024 * 1024; // ~5 MB localStorage estimate
  const pct = Math.min(100, Math.round((totalBytes / MAX) * 100));
  const bar    = document.getElementById('storageBar');
  const usage  = document.getElementById('storageUsage');
  const hint   = document.getElementById('storageHint');
  if (bar)   bar.style.width  = Math.max(2, pct) + '%';
  if (usage) usage.textContent = _fmtStorageBytes(totalBytes);
  if (hint) {
    const count = STATE.recentDocs.length;
    if (STATE.user) {
      hint.textContent = `${count} document${count !== 1 ? 's' : ''} in local history`;
    } else {
      hint.textContent = '☁️ Sign in to connect Google Drive';
    }
  }
}

/* ── THEME ────────────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  STATE.theme = theme;
  localStorage.setItem('cm_theme', theme);
}
function toggleTheme() {
  /* Manual override — stop following the clock from now on. */
  localStorage.setItem('cm_theme_mode', 'manual');
  applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
}

/* While in auto mode, re-check the clock periodically so the theme flips
   on its own when day turns to night (and vice-versa). */
function refreshAutoTheme() {
  if ((localStorage.getItem('cm_theme_mode') || 'auto') !== 'auto') return;
  const t = autoThemeByTime();
  if (t !== STATE.theme) applyTheme(t);
}
setInterval(refreshAutoTheme, 5 * 60 * 1000);

/* ── TOAST ────────────────────────────────────────────────────── */
let _toastTimer;
function toast(msg, type = '', duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ── BRANDED DOWNLOAD NAMES: "file012 - PDFDukan.pdf" ─────────── */
function brand(name) {
  name = String(name || 'download');
  var i = name.lastIndexOf('.'), base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : '';
  if (/ - PDFDukan$/i.test(base)) return name;
  return base + ' - PDFDukan' + ext;
}
window.CMBrandName = brand;

/* ── FILENAME CUSTOMIZATION MODAL ─────────────────────────────── */
const CMFilename = (() => {
  let _modal = null, _input = null, _ext = '', _resolve = null;

  function _ensureModal() {
    if (_modal) return;
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="cm-fname-backdrop" id="cmFnameModal">' +
        '<div class="cm-fname-panel">' +
          '<div class="cm-fname-header">' +
            '<span class="cm-fname-icon">📝</span>' +
            '<span class="cm-fname-title">Save As</span>' +
            '<button class="cm-fname-x" id="cmFnameCancel" aria-label="Close">&#10005;</button>' +
          '</div>' +
          '<label class="cm-fname-label">File name</label>' +
          '<div class="cm-fname-row">' +
            '<input type="text" class="cm-fname-input" id="cmFnameInput" spellcheck="false" autocomplete="off">' +
            '<span class="cm-fname-ext" id="cmFnameExt">.pdf</span>' +
          '</div>' +
          '<div class="cm-fname-actions">' +
            '<button class="cm-fname-btn cm-fname-dl" id="cmFnameDl">Download</button>' +
            '<button class="cm-fname-btn cm-fname-cancel" id="cmFnameCancelBtn">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    _modal = document.getElementById('cmFnameModal');
    _input = document.getElementById('cmFnameInput');

    /* Inject styles once */
    const style = document.createElement('style');
    style.textContent =
      '.cm-fname-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;animation:cmfFadeIn .15s ease}' +
      '.cm-fname-backdrop.open{display:flex}' +
      '@keyframes cmfFadeIn{from{opacity:0}to{opacity:1}}' +
      '.cm-fname-panel{background:var(--card,#1e1e2e);border:1px solid var(--border,#333);border-radius:14px;width:420px;max-width:92vw;padding:24px 28px;box-shadow:0 8px 40px rgba(0,0,0,.45)}' +
      '.cm-fname-header{display:flex;align-items:center;gap:8px;margin-bottom:18px}' +
      '.cm-fname-icon{font-size:22px}' +
      '.cm-fname-title{font-size:16px;font-weight:800;color:var(--text,#eee);flex:1}' +
      '.cm-fname-x{background:none;border:none;color:var(--text-muted,#888);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px}' +
      '.cm-fname-x:hover{background:var(--border,#333)}' +
      '.cm-fname-label{display:block;font-size:12px;font-weight:700;color:var(--text-muted,#999);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}' +
      '.cm-fname-row{display:flex;align-items:center;gap:0;margin-bottom:20px}' +
      '.cm-fname-input{flex:1;padding:10px 12px;border:1px solid var(--border,#444);border-right:none;border-radius:8px 0 0 8px;background:var(--card-2,#f2f2f5);color:var(--text,#111);font-size:14px;font-weight:600;outline:none;transition:border-color .15s}' +
      '.cm-fname-input:focus{border-color:var(--primary,#ff6333)}' +
      '.cm-fname-ext{padding:10px 14px;background:var(--border,#333);color:var(--text-muted,#aaa);font-size:14px;font-weight:700;border-radius:0 8px 8px 0;white-space:nowrap;border:1px solid var(--border,#444);border-left:none}' +
      '.cm-fname-actions{display:flex;gap:10px}' +
      '.cm-fname-btn{flex:1;padding:11px 16px;border-radius:8px;border:none;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s}' +
      '.cm-fname-btn:hover{opacity:.85}' +
      '.cm-fname-dl{background:var(--primary,#ff6333);color:#fff}' +
      '.cm-fname-cancel{background:var(--card-2,#252535);color:var(--text,#eee);border:1px solid var(--border,#444)}';
    document.head.appendChild(style);

    /* Events */
    document.getElementById('cmFnameDl').addEventListener('click', _confirm);
    document.getElementById('cmFnameCancel').addEventListener('click', _dismiss);
    document.getElementById('cmFnameCancelBtn').addEventListener('click', _dismiss);
    _input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') _confirm();
      if (e.key === 'Escape') _dismiss();
    });
    _modal.addEventListener('mousedown', function(e) {
      if (e.target === _modal) _dismiss();
    });
  }

  function _confirm() {
    var name = (_input.value || '').trim();
    if (!name) { _input.focus(); return; }
    _modal.classList.remove('open');
    window.__cmfOpen = false; window.__cmfRecent = Date.now();
    if (_resolve) { _resolve(name + _ext); _resolve = null; }
  }

  function _dismiss() {
    _modal.classList.remove('open');
    window.__cmfOpen = false; window.__cmfRecent = Date.now();
    if (_resolve) { _resolve(null); _resolve = null; }
  }

  /**
   * Show the filename customization modal.
   * @param {string} defaultName - Full default filename e.g. "document.pdf"
   * @returns {Promise<string|null>} - Chosen filename or null if cancelled
   */
  function prompt(defaultName) {
    _ensureModal();
    defaultName = brand(defaultName);
    var dotIdx = defaultName.lastIndexOf('.');
    var baseName, extPart;
    if (dotIdx > 0) {
      baseName = defaultName.slice(0, dotIdx);
      extPart = defaultName.slice(dotIdx);
    } else {
      baseName = defaultName;
      extPart = '';
    }
    _ext = extPart;
    _input.value = baseName;
    document.getElementById('cmFnameExt').textContent = extPart;
    _modal.classList.add('open');
    window.__cmfOpen = true;
    setTimeout(function() { _input.focus(); _input.select(); }, 60);
    return new Promise(function(resolve) { _resolve = resolve; });
  }

  return { prompt: prompt };
})();
window.CMFilename = CMFilename;

/* ── GLOBAL SAVE-AS ─────────────────────────────────────────────
   Adds the "Save As / rename" popup to EVERY generated-file download
   across all tools, in one place. Catches clicks on <a download> that
   point to a blob:/data: URL, shows the filename popup, then downloads
   with the chosen name. Tools that already call CMFilename are skipped
   (via __cmfRecent) to avoid a double popup. */
(function _globalSaveAs() {
  /* Keep blob URLs alive while the rename popup is open (tools often
     revokeObjectURL right after click, which would break the deferred
     download). */
  try {
    var _origRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (u) {
      if (window.__cmfOpen) { setTimeout(function () { _origRevoke(u); }, 10000); }
      else { _origRevoke(u); }
    };
  } catch (e) {}

  document.addEventListener('click', function (e) {
    var a = (e.target && e.target.closest) ? e.target.closest('a[download]') : null;
    if (!a) return;
    if (a.dataset && a.dataset.cmf === '1') return;                 // already renamed
    var href = a.getAttribute('href') || '';
    if (href.indexOf('blob:') !== 0 && href.indexOf('data:') !== 0) return; // only generated files
    if ((window.__cmfRecent && (Date.now() - window.__cmfRecent) < 4000) || !window.CMFilename) { // tool already popped
      a.setAttribute('download', brand(a.getAttribute('download') || 'download'));
      return;
    }

    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var fname = a.getAttribute('download') || 'download';
    CMFilename.prompt(fname).then(function (name) {
      if (!name) return;
      var dl = document.createElement('a');
      dl.href = href; dl.download = name; dl.dataset.cmf = '1';
      document.body.appendChild(dl); dl.click(); document.body.removeChild(dl);
    });
  }, true);
})();

/* ── CSV TRANSACTION LOG ─────────────────────────────────────── */
const CMLogs = (() => {
  var STORAGE_KEY = 'cm_transaction_log';
  var MAX_ENTRIES = 500;

  function _getLog() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch(e) { return []; }
  }

  function _saveLog(log) {
    if (log.length > MAX_ENTRIES) log = log.slice(-MAX_ENTRIES);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); }
    catch(e) { /* storage full — silently drop oldest */ log = log.slice(-100); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); } catch(e2){} }
  }

  /**
   * Log a tool transaction.
   * @param {object} entry
   * @param {string} entry.tool     - Tool name e.g. "PDF Editor", "Image to PDF"
   * @param {string} entry.action   - Action e.g. "convert", "merge", "compress", "edit", "export"
   * @param {string} [entry.input]  - Input filename
   * @param {string} entry.output   - Output filename
   * @param {number} [entry.size]   - Output file size in bytes
   * @param {number} [entry.pages]  - Number of pages processed
   * @param {string} [entry.notes]  - Additional notes
   */
  function log(entry) {
    var log = _getLog();
    log.push({
      timestamp: new Date().toISOString(),
      tool:   entry.tool   || '',
      action: entry.action || '',
      input:  entry.input  || '',
      output: entry.output || '',
      size:   entry.size   || 0,
      pages:  entry.pages  || 0,
      notes:  entry.notes  || ''
    });
    _saveLog(log);
  }

  /**
   * Download the full transaction log as CSV.
   */
  function downloadCSV() {
    var log = _getLog();
    if (!log.length) { toast('No transactions logged yet.', 'info'); return; }

    var headers = ['Timestamp', 'Tool', 'Action', 'Input File', 'Output File', 'Size (bytes)', 'Pages', 'Notes'];
    var rows = [headers.join(',')];
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      rows.push([
        '"' + (e.timestamp || '') + '"',
        '"' + (e.tool || '').replace(/"/g, '""') + '"',
        '"' + (e.action || '').replace(/"/g, '""') + '"',
        '"' + (e.input || '').replace(/"/g, '""') + '"',
        '"' + (e.output || '').replace(/"/g, '""') + '"',
        e.size || 0,
        e.pages || 0,
        '"' + (e.notes || '').replace(/"/g, '""') + '"'
      ].join(','));
    }

    var csvContent = rows.join('\r\n');
    var blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'PDFdukan.com_Transaction_Log_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
    toast('Transaction log exported!', 'success');
  }

  /**
   * Clear all logged transactions.
   */
  function clearLog() {
    localStorage.removeItem(STORAGE_KEY);
    toast('Transaction log cleared.', 'success');
  }

  /**
   * Get total transaction count.
   */
  function count() {
    return _getLog().length;
  }

  /**
   * Get the raw log array.
   */
  function getAll() {
    return _getLog();
  }

  return { log: log, downloadCSV: downloadCSV, clearLog: clearLog, count: count, getAll: getAll };
})();
window.CMLogs = CMLogs;

/* ── AUTH (Firebase) ──────────────────────────────────────────
   Real accounts via Firebase Authentication (loaded from CDN as ESM via
   dynamic import, so this classic script can stay as-is). Provides:
   • login that fails for unregistered emails / wrong passwords
   • signup that sends a verification email
   • Google sign-in
   • a profile dropdown
   • a site-wide feature-gate (browse free, sign in to USE a tool)
   The web apiKey below is NOT a secret — it only identifies the project. */
const firebaseConfig = {
  apiKey: "AIzaSyDizEh7VZo10_pkvfcV6SQJLX7N2GG0uTI",
  authDomain: "pdfdukan.firebaseapp.com",
  projectId: "pdfdukan",
  storageBucket: "pdfdukan.firebasestorage.app",
  messagingSenderId: "233358066910",
  appId: "1:233358066910:web:076f8e34d54a408a292e4f",
  measurementId: "G-RM7DDQ4WSC"
};

let _auth = null, _fb = null, _googleProvider = null;
const _FB_SDK = 'https://www.gstatic.com/firebasejs/12.14.0/';

/* Lazy Firebase loader — runs once on first call, memoises the promise.
   Anonymous visitors never trigger it, saving ~90 KB from the initial load. */
let _firebaseReadyPromise = null;
function _firebaseReady() {
  if (_firebaseReadyPromise) return _firebaseReadyPromise;
  _firebaseReadyPromise = (async function () {
    try {
      const [{ initializeApp }, authMod] = await Promise.all([
        import(_FB_SDK + 'firebase-app.js'),
        import(_FB_SDK + 'firebase-auth.js'),
      ]);
      const fbApp = initializeApp(firebaseConfig);
      _fb = authMod;
      _auth = authMod.getAuth(fbApp);
      _googleProvider = new authMod.GoogleAuthProvider();
      authMod.onAuthStateChanged(_auth, _onAuthChanged);
      return true;
    } catch (e) {
      console.error('Firebase init failed:', e);
      return false;
    }
  })();
  return _firebaseReadyPromise;
}

/* Pre-load Firebase for returning signed-in users so their avatar appears
   without delay. Anonymous visitors: Firebase stays unloaded. */
if (STATE.user) {
  document.addEventListener('DOMContentLoaded', _firebaseReady);
}

/* Firebase calls this whenever the user logs in/out (and on page load). */
function _onAuthChanged(user) {
  if (user) {
    STATE.user = {
      name:  user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
      email: user.email,
      emailVerified: user.emailVerified || _isOTPVerified(user.email),
      uid:   user.uid,
      photoURL: user.photoURL || null,
    };
  } else {
    STATE.user = null;
  }
  try {
    if (STATE.user) localStorage.setItem('cm_user', JSON.stringify(STATE.user));
    else            localStorage.removeItem('cm_user');
  } catch (e) {}
  updateAuthUI();
  if (typeof updateStorageUI === 'function') updateStorageUI();
}

function openAuth(tab) {
  if (STATE.user) { openProfilePanel(); return; }
  const el = document.getElementById('authModal');
  if (el) el.classList.add('show');
  switchAuthTab(tab || 'signin');
}
function closeAuth() {
  const el = document.getElementById('authModal');
  if (el) el.classList.remove('show');
  _closePanelOTP();
}
function switchAuthTab(tab) {
  const panelIn  = document.getElementById('panelSignIn');
  const panelUp  = document.getElementById('panelSignUp');
  const tabIn    = document.getElementById('tabSignIn');
  const tabUp    = document.getElementById('tabSignUp');
  if (!panelIn || !panelUp) return;
  if (tab === 'signin') {
    panelIn.style.display  = '';
    panelUp.style.display  = 'none';
    if (tabIn) tabIn.classList.add('active');
    if (tabUp) tabUp.classList.remove('active');
  } else {
    panelIn.style.display  = 'none';
    panelUp.style.display  = '';
    if (tabIn) tabIn.classList.remove('active');
    if (tabUp) tabUp.classList.add('active');
  }
}

async function signInWithGoogle() {
  toast('Opening Google sign-in…', 'info');
  if (!(await _firebaseReady()) || !_auth) { toast('Auth not ready — please retry', 'error'); return; }
  // Request Google Drive file access alongside sign-in
  _googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
  try {
    const result = await _fb.signInWithPopup(_auth, _googleProvider);
    // Capture Google access token for Drive API
    const credential = _fb.GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      const expiry = Date.now() + 3600_000; // 1 hour
      try {
        localStorage.setItem('cm_gdrive_token', credential.accessToken);
        localStorage.setItem('cm_gdrive_token_expiry', String(expiry));
      } catch(_) {}
      // Silently set up Drive folder on first sign-in
      _initGDriveStorage(credential.accessToken).catch(() => {});
    }
    closeAuth();
    toast('Signed in with Google ✓', 'success');
  } catch (e) { toast(_authErr(e), 'error'); }
}

/* ── GOOGLE DRIVE INTEGRATION ────────────────────────────────────
   drive.file scope: only accesses files PDFdukan itself creates. */

const GDRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const GDRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const GDRIVE_FOLDER_NAME = 'PDFdukan — CamMaster Files';

function _gdriveToken() {
  try {
    const token = localStorage.getItem('cm_gdrive_token');
    const expiry = parseInt(localStorage.getItem('cm_gdrive_token_expiry') || '0', 10);
    if (token && expiry > Date.now() + 60_000) return token; // valid with 1-min buffer
    return null; // expired or missing
  } catch(e) { return null; }
}

async function _initGDriveStorage(token) {
  if (!token) return;
  if (localStorage.getItem('pdfdukan_drive_setup_done') === 'true') {
    updateStorageUI(); return;
  }
  try {
    // Create the PDFdukan folder in user's Drive
    const res = await fetch(GDRIVE_API, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: GDRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!res.ok) { console.warn('[GDrive] Folder create failed:', await res.text()); return; }
    const data = await res.json();
    try {
      localStorage.setItem('pdfdukan_drive_folder_id', data.id);
      localStorage.setItem('pdfdukan_drive_setup_done', 'true');
    } catch(e) {}
    updateStorageUI();
    toast('☁️ Google Drive connected — files save to "' + GDRIVE_FOLDER_NAME + '"', 'success', 5000);
  } catch(e) {
    console.warn('[GDrive] Setup error:', e);
  }
}

/**
 * Save a Blob to the user's PDFdukan Drive folder.
 * @param {Blob} blob - the file data
 * @param {string} filename - desired filename
 * @returns {Promise<{id:string, webViewLink:string}|null>}
 */
async function gDriveSave(blob, filename) {
  const token = _gdriveToken();
  if (!token) {
    toast('Your Google session has expired — please sign in again.', 'info');
    openAuth('signin');
    return null;
  }
  const folderId = (() => { try { return localStorage.getItem('pdfdukan_drive_folder_id'); } catch(e) { return null; } })();
  const meta = { name: filename };
  if (folderId) meta.parents = [folderId];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);

  try {
    const res = await fetch(GDRIVE_UPLOAD + '&fields=id,webViewLink', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        // Token expired — clear and prompt re-auth
        try { localStorage.removeItem('cm_gdrive_token'); localStorage.removeItem('cm_gdrive_token_expiry'); } catch(e) {}
        toast('Google session expired — please sign in again to save to Drive.', 'info', 5000);
        return null;
      }
      throw new Error(err);
    }
    const data = await res.json();
    toast('☁️ Saved to Google Drive! <a href="' + data.webViewLink + '" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">Open in Drive →</a>', 'success', 6000);
    return data;
  } catch(e) {
    console.error('[GDrive] Upload error:', e);
    toast('Could not save to Drive — please try again.', 'error');
    return null;
  }
}
window.gDriveSave = gDriveSave;

/**
 * Show a "Save to Google Drive" button next to a download button.
 * Call this after a tool finishes processing.
 * @param {string} containerId - ID of element to append button to
 * @param {Function} getBlobFn - function that returns the Blob (or a Promise<Blob>)
 * @param {string} filename - desired filename in Drive
 */
function gDriveShowSaveBtn(containerId, getBlobFn, filename) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const existing = container.querySelector('.gdrive-save-btn');
  if (existing) existing.remove();
  if (!STATE.user) return; // not signed in — don't show
  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary btn-sm gdrive-save-btn';
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:8px';
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>Save to Drive';
  btn.onclick = async () => {
    if (!STATE.user) { openAuth('signin'); return; }
    const token = _gdriveToken();
    if (!token) { toast('Please sign in with Google to use Drive sync.', 'info'); openAuth('signin'); return; }
    btn.disabled = true; btn.innerHTML = '⏳ Saving…';
    try {
      const blob = await Promise.resolve(getBlobFn());
      if (blob) { await gDriveSave(blob, filename); }
    } catch(e) { toast('Save failed — please try again.', 'error'); }
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>Save to Drive';
  };
  container.appendChild(btn);
}
window.gDriveShowSaveBtn = gDriveShowSaveBtn;

async function signInEmail() {
  const email = document.getElementById('siEmail')?.value.trim();
  const pass  = document.getElementById('siPass')?.value;
  if (!email || !pass) { toast('Please fill in all fields', 'error'); return; }
  if (!_validEmail(email)) { toast('Enter a valid email address', 'error'); return; }
  if (!(await _firebaseReady()) || !_auth) { toast('Auth not ready — please retry', 'error'); return; }
  try {
    const cred = await _fb.signInWithEmailAndPassword(_auth, email, pass);
    closeAuth();
    if (cred.user && !cred.user.emailVerified) {
      toast('Signed in. Please verify your email — check your inbox.', 'info');
    } else {
      toast('Welcome back! ✓', 'success');
    }
  } catch (e) { toast(_authErr(e), 'error'); }
}

async function signUpEmail() {
  const name     = document.getElementById('suName')?.value.trim();
  const email    = document.getElementById('suEmail')?.value.trim();
  const pass     = document.getElementById('suPass')?.value;
  const passConf = document.getElementById('suPassConf')?.value;

  // Validate required fields (Full Name, Email, Password, Confirm)
  if (!name)                { toast('Please enter your full name', 'error'); return; }
  if (!email)               { toast('Please enter your email address', 'error'); return; }
  if (!_validEmail(email))  { toast('Enter a valid email address', 'error'); return; }
  if (!pass)                { toast('Please choose a password', 'error'); return; }
  if (pass.length < 8)      { toast('Password must be at least 8 characters', 'error'); return; }
  if (pass !== passConf)    { toast('Passwords do not match', 'error'); return; }

  // Store form data and send OTP — account is created only after OTP verified
  _pendingSignup = { name, email, pass };
  _otpPurpose = 'signup';
  await _sendSignupOTP(email);
}

/* ── OTP PANEL FUNCTIONS ──────────────────────────────────────── */
async function _sendSignupOTP(email) {
  const btn = document.querySelector('#panelSignUp .auth-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending code…'; }
  try {
    const res  = await fetch('/api/auth/send-signup-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!data.success) {
      toast(data.message || 'Failed to send code', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
      return;
    }
    _showOTPPanel(email, data.expiresInMinutes || 10);
    toast('Code sent! Check your inbox and spam/junk folder.', 'success', 6000);
  } catch(e) {
    toast('Network error — please check your connection.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

function _showOTPPanel(email, expiryMinutes) {
  ['panelSignIn', 'panelSignUp'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const pOTP = document.getElementById('panelOTP');
  if (pOTP) pOTP.style.display = '';

  const hint = document.getElementById('otpEmailHint');
  if (hint) hint.textContent = email;

  const inp = document.getElementById('otpCode');
  if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 120); }

  const tabs = document.querySelector('#authModal .auth-tabs');
  if (tabs) tabs.style.visibility = 'hidden';

  const modal = document.getElementById('authModal');
  if (modal && !modal.classList.contains('show')) modal.classList.add('show');

  const submitBtn = document.getElementById('otpSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = _otpPurpose === 'verify' ? 'Verify Email' : 'Verify & Create Account';
  }

  // Countdown timer
  clearInterval(_otpCountdown);
  const timerEl = document.getElementById('otpTimerEl');
  let secs = expiryMinutes * 60;
  function _tick() {
    if (!timerEl) return;
    if (secs <= 0) {
      clearInterval(_otpCountdown);
      timerEl.textContent = 'Code expired — request a new one below.';
      timerEl.style.color = 'var(--error,#ef4444)';
      const sb = document.getElementById('otpSubmitBtn');
      if (sb) sb.disabled = true;
      return;
    }
    const m = Math.floor(secs / 60); const s = secs % 60;
    timerEl.textContent = 'Code expires in ' + m + ':' + String(s).padStart(2, '0');
    timerEl.style.color = secs < 60 ? 'var(--error,#ef4444)' : 'var(--text-3,#888)';
    secs--;
  }
  _tick();
  _otpCountdown = setInterval(_tick, 1000);
}

function _closePanelOTP() {
  clearInterval(_otpCountdown);
  const pOTP = document.getElementById('panelOTP');
  if (pOTP) pOTP.style.display = 'none';
  const tabs = document.querySelector('#authModal .auth-tabs');
  if (tabs) tabs.style.visibility = '';
}

async function submitOTPCode() {
  const email = _otpPurpose === 'verify'
    ? (STATE.user && STATE.user.email || '')
    : (_pendingSignup && _pendingSignup.email || '');
  const code = (document.getElementById('otpCode') ? document.getElementById('otpCode').value : '').trim().replace(/\s/g, '');

  if (!email) { toast('Session lost — please start over.', 'error'); return; }
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    toast('Enter the 6-digit numeric code from your email.', 'error'); return;
  }

  const btn = document.getElementById('otpSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  try {
    const res  = await fetch('/api/auth/verify-signup-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();

    if (!data.success) {
      toast(data.message || 'Wrong code — try again.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = _otpPurpose === 'verify' ? 'Verify Email' : 'Verify & Create Account'; }
      return;
    }

    clearInterval(_otpCountdown);
    _markOTPVerified(email);

    if (_otpPurpose === 'signup') {
      await _createAccountAfterOTP();
    } else {
      if (STATE.user) {
        STATE.user.emailVerified = true;
        try { localStorage.setItem('cm_user', JSON.stringify(STATE.user)); } catch(e) {}
      }
      _closePanelOTP();
      closeAuth();
      toast('Email verified! ✓ You can now use all tools.', 'success', 5000);
      updateAuthUI();
      setTimeout(() => { closeProfilePanel(); setTimeout(openProfilePanel, 50); }, 300);
    }
  } catch(e) {
    toast('Network error — please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = _otpPurpose === 'verify' ? 'Verify Email' : 'Verify & Create Account'; }
  }
}

async function _createAccountAfterOTP() {
  if (!_pendingSignup) { toast('Signup data lost — please start again.', 'error'); return; }
  const { name, email, pass } = _pendingSignup;
  if (!(await _firebaseReady()) || !_auth) { toast('Auth not ready', 'error'); return; }
  try {
    const cred = await _fb.createUserWithEmailAndPassword(_auth, email, pass);
    try { await _fb.updateProfile(cred.user, { displayName: name }); } catch(e) {}
    if (STATE.user) {
      STATE.user.emailVerified = true;
      STATE.user.name = name;
      try { localStorage.setItem('cm_user', JSON.stringify(STATE.user)); } catch(e) {}
    }
    _pendingSignup = null;
    _closePanelOTP();
    closeAuth();
    toast('Account created! Welcome to PDFdukan ✓', 'success');
  } catch(e) { toast(_authErr(e), 'error'); }
}

async function resendOTPCode() {
  const email = _otpPurpose === 'verify'
    ? (STATE.user && STATE.user.email || '')
    : (_pendingSignup && _pendingSignup.email || '');
  if (!email) return;
  const lnk = document.getElementById('otpResendA');
  if (lnk) { lnk.style.pointerEvents = 'none'; lnk.style.opacity = '0.45'; }
  try {
    const res  = await fetch('/api/auth/send-signup-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!data.success) toast(data.message || 'Failed to resend', 'error');
    else {
      _showOTPPanel(email, data.expiresInMinutes || 10);
      toast('New code sent! Check inbox and spam/junk folder.', 'success', 5000);
    }
  } catch(e) { toast('Network error', 'error'); }
  setTimeout(() => { if (lnk) { lnk.style.pointerEvents = ''; lnk.style.opacity = ''; } }, 30000);
}

async function signOut() {
  if (await _firebaseReady() && _auth) { try { await _fb.signOut(_auth); } catch (e) {} }
  STATE.user = null;
  try { localStorage.removeItem('cm_user'); } catch (e) {}
  updateAuthUI();
  if (typeof updateStorageUI === 'function') updateStorageUI();
  hideProfileMenu();
  toast('Signed out');
}

/* Re-send the verification email for the current user. */
async function resendVerification() {
  if (!(await _firebaseReady()) || !_auth || !_auth.currentUser) return;
  try { await _fb.sendEmailVerification(_auth.currentUser); toast('Verification email re-sent ✓', 'success'); }
  catch (e) { toast(_authErr(e), 'error'); }
}

/* Map Firebase error codes to friendly messages. */
function _authErr(e) {
  switch ((e && e.code) || '') {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':       return 'No account found with these details, or the password is wrong.';
    case 'auth/email-already-in-use': return 'This email is already registered — please sign in instead.';
    case 'auth/weak-password':        return 'Password is too weak.';
    case 'auth/invalid-email':        return 'Enter a valid email address.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'Google sign-in was cancelled.';
    case 'auth/popup-blocked':        return 'Popup blocked — allow popups and retry.';
    case 'auth/too-many-requests':    return 'Too many attempts. Please wait and try again.';
    case 'auth/network-request-failed': return 'Network error — check your connection.';
    case 'auth/operation-not-allowed': return 'This sign-in method is not enabled in Firebase.';
    case 'auth/unauthorized-domain':  return 'This domain is not authorized in Firebase Auth settings.';
    default: return 'Authentication error: ' + ((e && e.message) || 'unknown');
  }
}

function _validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function updateAuthUI() {
  const label  = document.getElementById('authLabel');
  const avatar = document.getElementById('userAvatar');
  if (!label || !avatar) return;
  if (STATE.user) {
    const nm = STATE.user.name || 'User';
    label.textContent = nm.split(' ')[0];
    const photo = (() => { try { return localStorage.getItem('cm_profile_photo'); } catch(e) { return null; } })() || STATE.user.photoURL;
    if (photo) {
      avatar.innerHTML = '<img src="' + _esc(photo) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer">';
    } else {
      avatar.textContent = nm[0].toUpperCase();
    }
  } else {
    label.textContent  = 'Sign In';
    avatar.textContent = 'U';
  }
}

/* ── PROFILE PANEL ─────────────────────────────────────────────
   Full slide-in profile panel. Replaces the old small dropdown. */
let _ppEl = null;

function _ppEnsure() {
  if (_ppEl) return;
  const outer = document.createElement('div');
  outer.id = 'cmPP';
  outer.innerHTML =
    '<div class="cpp-bg" id="cppBg"></div>' +
    '<div class="cpp-panel" role="dialog" aria-label="Your Profile">' +
      '<div class="cpp-head">' +
        '<div class="cpp-av-wrap">' +
          '<div class="cpp-av" id="cppAv">U</div>' +
          '<label class="cpp-av-btn" for="cppAvIn" title="Change photo">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
          '</label>' +
          '<input type="file" id="cppAvIn" accept="image/*" style="display:none">' +
        '</div>' +
        '<div class="cpp-meta">' +
          '<div class="cpp-uname" id="cppUname">User</div>' +
          '<div class="cpp-uemail" id="cppUemail"></div>' +
          '<span class="cpp-vbadge" id="cppVbadge"></span>' +
        '</div>' +
        '<button class="cpp-x" id="cppX" aria-label="Close">&#10005;</button>' +
      '</div>' +
      '<div class="cpp-body">' +
        '<div class="cpp-sec">' +
          '<div class="cpp-sec-hd">Edit Profile</div>' +
          '<label class="cpp-lbl">Display Name</label>' +
          '<div class="cpp-rowf">' +
            '<input type="text" class="cpp-inp" id="cppNm" placeholder="Your name">' +
            '<button class="btn btn-primary btn-sm" id="cppSvNm">Save</button>' +
          '</div>' +
        '</div>' +
        '<div class="cpp-sec" id="cppVerSec">' +
          '<div class="cpp-sec-hd">Email Verification</div>' +
          '<div class="cpp-warnbox">&#9888; Your email is not verified. Verify now to use all tools.</div>' +
          '<button class="btn btn-primary btn-sm" id="cppSendOtp" style="width:100%;margin-top:10px">Send Verification Code (OTP)</button>' +
          '<div id="cppOtpWrap" style="display:none;margin-top:12px">' +
            '<label class="cpp-lbl">Enter 6-digit code from your email</label>' +
            '<div class="cpp-rowf">' +
              '<input type="text" class="cpp-inp" id="cppOtpIn" placeholder="000000" maxlength="6" inputmode="numeric" ' +
                     'style="text-align:center;font-size:20px;letter-spacing:6px;font-weight:700">' +
              '<button class="btn btn-primary btn-sm" id="cppOtpBtn">Confirm</button>' +
            '</div>' +
            '<p class="cpp-hint">Check inbox AND spam/junk folder. Code valid 10 min.</p>' +
          '</div>' +
        '</div>' +
        '<div class="cpp-sec">' +
          '<div class="cpp-sec-hd">Security</div>' +
          '<button class="btn btn-secondary btn-sm" id="cppRsPw" style="width:100%">Send Password Reset Email</button>' +
          '<p class="cpp-hint">A password reset link will be sent to your registered email address.</p>' +
        '</div>' +
        '<div class="cpp-sec">' +
          '<div class="cpp-sec-hd">Recent Activity</div>' +
          '<div id="cppHist" class="cpp-hist"></div>' +
        '</div>' +
        '<div class="cpp-sec" id="cppDriveSec" style="display:none">' +
          '<div class="cpp-sec-hd">Google Drive</div>' +
          '<div id="cppDriveStatus" class="cpp-warnbox" style="background:rgba(66,133,244,.08);border-color:rgba(66,133,244,.25);color:#4285f4">' +
            '&#128196; Google Drive connected — your files can be saved to Drive.' +
          '</div>' +
        '</div>' +
        '<div class="cpp-sec cpp-logout-sec">' +
          '<button class="btn btn-sm" id="cppOut" style="width:100%;border:1px solid var(--error,#ef4444);color:var(--error,#ef4444);background:transparent">Sign Out</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(outer);
  _ppEl = outer;

  const st = document.createElement('style');
  st.textContent =
    '#cmPP{position:fixed;inset:0;z-index:9998;pointer-events:none}' +
    '#cmPP.open{pointer-events:all}' +
    '.cpp-bg{position:absolute;inset:0;background:rgba(0,0,0,0);transition:background .25s ease}' +
    '#cmPP.open .cpp-bg{background:rgba(0,0,0,.5)}' +
    '.cpp-panel{position:absolute;top:0;right:0;bottom:0;width:340px;max-width:100vw;background:var(--card);' +
      'border-left:1px solid var(--border);transform:translateX(100%);transition:transform .27s cubic-bezier(.4,0,.2,1);' +
      'display:flex;flex-direction:column;overflow:hidden}' +
    '#cmPP.open .cpp-panel{transform:translateX(0)}' +
    '.cpp-head{display:flex;align-items:center;gap:12px;padding:18px 14px;border-bottom:1px solid var(--border);flex-shrink:0}' +
    '.cpp-av-wrap{position:relative;flex-shrink:0}' +
    '.cpp-av{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#ff6333,#ff9055);' +
      'display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;overflow:hidden}' +
    '.cpp-av img{width:100%;height:100%;object-fit:cover;border-radius:50%}' +
    '.cpp-av-btn{position:absolute;bottom:-1px;right:-1px;width:20px;height:20px;border-radius:50%;' +
      'background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'border:2px solid var(--card)}' +
    '.cpp-meta{flex:1;min-width:0}' +
    '.cpp-uname{font-weight:700;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cpp-uemail{font-size:11px;color:var(--text-2,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}' +
    '.cpp-vbadge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-top:4px}' +
    '.cpp-vbadge.ok{background:rgba(67,160,71,.15);color:#66bb6a}' +
    '.cpp-vbadge.no{background:rgba(251,140,0,.15);color:#ffa726}' +
    '.cpp-x{background:none;border:none;color:var(--text-3,#888);font-size:16px;cursor:pointer;padding:6px 8px;border-radius:6px;flex-shrink:0}' +
    '.cpp-x:hover{background:var(--border)}' +
    '.cpp-body{flex:1;overflow-y:auto;padding-bottom:20px}' +
    '.cpp-sec{padding:16px 14px;border-bottom:1px solid var(--border)}' +
    '.cpp-logout-sec{border-bottom:none;padding-top:20px}' +
    '.cpp-sec-hd{font-size:10px;font-weight:700;color:var(--text-3,#888);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}' +
    '.cpp-lbl{display:block;font-size:12px;color:var(--text-2);font-weight:600;margin-bottom:6px}' +
    '.cpp-rowf{display:flex;gap:8px;align-items:center}' +
    '.cpp-inp{flex:1;padding:8px 10px;background:var(--surface,#161625);border:1px solid var(--border);border-radius:7px;' +
      'color:var(--text);font-size:13px;outline:none;transition:border-color .15s}' +
    '.cpp-inp:focus{border-color:var(--primary)}' +
    '.cpp-hint{font-size:11px;color:var(--text-3,#888);margin:7px 0 0;line-height:1.5}' +
    '.cpp-warnbox{padding:9px 11px;background:rgba(251,140,0,.08);border:1px solid rgba(251,140,0,.25);' +
      'border-radius:7px;font-size:12px;color:#ffa726;line-height:1.5}' +
    '.cpp-hist{display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto;margin-top:2px}' +
    '.cpp-hi{display:flex;align-items:center;gap:8px;padding:7px 8px;background:var(--surface,#161625);border-radius:7px;font-size:12px}' +
    '.cpp-hi-ico{font-size:15px;flex-shrink:0}' +
    '.cpp-hi-nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}' +
    '.cpp-hi-dt{color:var(--text-3,#888);font-size:11px;white-space:nowrap}' +
    '.cpp-hi-empty{color:var(--text-3,#888);font-size:12px;padding:4px 0}' +
    '@media(max-width:480px){.cpp-panel{width:100vw;border-left:none}}';
  document.head.appendChild(st);

  document.getElementById('cppX').onclick       = closeProfilePanel;
  document.getElementById('cppBg').onclick      = closeProfilePanel;
  document.getElementById('cppSvNm').onclick    = _ppSaveName;
  document.getElementById('cppNm').onkeydown    = e => { if (e.key === 'Enter') _ppSaveName(); };
  document.getElementById('cppRsPw').onclick    = _ppResetPass;
  document.getElementById('cppOut').onclick     = () => { closeProfilePanel(); signOut(); };
  document.getElementById('cppSendOtp').onclick = _ppSendOTP;
  document.getElementById('cppOtpBtn').onclick  = _ppConfirmOTP;
  document.getElementById('cppOtpIn').onkeydown = e => { if (e.key === 'Enter') _ppConfirmOTP(); };
  document.getElementById('cppAvIn').onchange   = _ppPhotoChange;
}

function _ppRender() {
  const u = STATE.user;
  if (!u) return;
  const savedPhoto = (() => { try { return localStorage.getItem('cm_profile_photo'); } catch(e) { return null; } })();
  const photo = savedPhoto || u.photoURL;
  const init = (u.name || 'U')[0].toUpperCase();

  const avEl = document.getElementById('cppAv');
  if (avEl) avEl.innerHTML = photo ? '<img src="' + _esc(photo) + '" referrerpolicy="no-referrer">' : init;

  const unEl = document.getElementById('cppUname');  if (unEl) unEl.textContent = u.name || 'User';
  const emEl = document.getElementById('cppUemail'); if (emEl) emEl.textContent = u.email || '';
  const vbEl = document.getElementById('cppVbadge');
  if (vbEl) {
    vbEl.textContent = u.emailVerified ? '✓ Verified' : '⚠ Not verified';
    vbEl.className   = 'cpp-vbadge ' + (u.emailVerified ? 'ok' : 'no');
  }
  const nmIn = document.getElementById('cppNm');    if (nmIn) nmIn.value = u.name || '';
  const vs   = document.getElementById('cppVerSec'); if (vs) vs.style.display = u.emailVerified ? 'none' : 'block';

  // Google Drive section — show only when Drive token available
  const driveToken = (() => { try { return localStorage.getItem('cm_gdrive_token'); } catch(e) { return null; } })();
  const ds = document.getElementById('cppDriveSec'); if (ds) ds.style.display = driveToken ? 'block' : 'none';

  const hist = document.getElementById('cppHist');
  if (hist) {
    const docs = STATE.recentDocs || [];
    hist.innerHTML = docs.length
      ? docs.slice(0, 10).map(d =>
          '<div class="cpp-hi">' +
          '<span class="cpp-hi-ico">' + (d.type === 'PDF' ? '📄' : '🖼️') + '</span>' +
          '<span class="cpp-hi-nm">' + _esc(d.name) + '</span>' +
          '<span class="cpp-hi-dt">' + _esc(d.date || '') + '</span>' +
          '</div>').join('')
      : '<div class="cpp-hi-empty">No recent activity yet</div>';
  }
}

async function _ppSaveName() {
  const inp = document.getElementById('cppNm');
  const name = (inp ? inp.value : '').trim();
  if (!name) { toast('Enter a name', 'error'); return; }
  if (!(await _firebaseReady()) || !_auth || !_auth.currentUser) { toast('Not connected', 'error'); return; }
  try {
    await _fb.updateProfile(_auth.currentUser, { displayName: name });
    STATE.user.name = name;
    try { localStorage.setItem('cm_user', JSON.stringify(STATE.user)); } catch(e) {}
    const unEl = document.getElementById('cppUname'); if (unEl) unEl.textContent = name;
    const al   = document.getElementById('authLabel'); if (al)   al.textContent  = name.split(' ')[0];
    toast('Name updated ✓', 'success');
  } catch (e) { toast('Failed to update name', 'error'); }
}

async function _ppResetPass() {
  if (!(await _firebaseReady()) || !_auth) { toast('Auth not ready', 'error'); return; }
  const email = STATE.user && STATE.user.email;
  if (!email) { toast('No email on file', 'error'); return; }
  try {
    await _fb.sendPasswordResetEmail(_auth, email);
    toast('Password reset email sent ✓ — check inbox and spam.', 'success');
  } catch (e) { toast(_authErr(e), 'error'); }
}

function _ppPhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = async () => {
    URL.revokeObjectURL(url);
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
    const dataURL = c.toDataURL('image/jpeg', 0.85);
    try { localStorage.setItem('cm_profile_photo', dataURL); } catch(_) {}
    if (_auth && _auth.currentUser) {
      try { await _fb.updateProfile(_auth.currentUser, { photoURL: dataURL }); } catch(_) {}
    }
    _ppRender();
    updateAuthUI();
    toast('Profile photo updated ✓', 'success');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Failed to load image', 'error'); };
  img.src = url;
}

async function _ppSendOTP() {
  const email = STATE.user && STATE.user.email;
  if (!email) return;
  const btn = document.getElementById('cppSendOtp');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const res  = await fetch('/api/auth/send-signup-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!data.success) {
      toast(data.message || 'Failed to send code', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Send Verification Code (OTP)'; }
      return;
    }
    const wrap = document.getElementById('cppOtpWrap');
    if (wrap) wrap.style.display = 'block';
    const inp = document.getElementById('cppOtpIn');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 100); }
    if (btn) { btn.disabled = false; btn.textContent = 'Resend Code'; }
    toast('Code sent! Check inbox and spam/junk folder.', 'success', 6000);
  } catch(e) {
    toast('Network error', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Send Verification Code (OTP)'; }
  }
}

async function _ppConfirmOTP() {
  const email = STATE.user && STATE.user.email;
  const code  = (document.getElementById('cppOtpIn') ? document.getElementById('cppOtpIn').value : '').trim();
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    toast('Enter the 6-digit code from your email.', 'error'); return;
  }
  const btn = document.getElementById('cppOtpBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res  = await fetch('/api/auth/verify-signup-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    if (!data.success) {
      toast(data.message || 'Wrong code', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm'; }
      return;
    }
    _markOTPVerified(email);
    if (STATE.user) {
      STATE.user.emailVerified = true;
      try { localStorage.setItem('cm_user', JSON.stringify(STATE.user)); } catch(e) {}
    }
    toast('Email verified! ✓ You can now use all tools.', 'success', 5000);
    _ppRender();
  } catch(e) {
    toast('Network error', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm'; }
  }
}

function openProfilePanel() {
  if (!STATE.user) return;
  _ppEnsure();
  _ppRender();
  _ppEl.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeProfilePanel() {
  if (_ppEl) _ppEl.classList.remove('open');
  document.body.style.overflow = '';
}

function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ── FEATURE GATE ─────────────────────────────────────────────────
   Visitors can browse the whole site freely, but USING a tool (selecting
   or dropping a file) requires being signed in WITH a verified email.
   Google sign-in users are always considered verified. */
function isLoggedIn() {
  return !!(STATE.user && (STATE.user.emailVerified || _isOTPVerified(STATE.user.email)));
}
function _gatePrompt() {
  if (STATE.user && !STATE.user.emailVerified) {
    toast('Please verify your email first — check your inbox or resend below.', 'info', 5000);
    toggleProfileMenu();
  } else {
    toast('Please sign in to use this tool', 'info');
    openAuth('signin');
  }
}
function _initFeatureGate() {
  // Signup is OPTIONAL. Every tool works without an account — we no longer
  // block file selection or drag-and-drop for logged-out visitors. Sign-in
  // stays available (for Drive storage / sync) but is never required.
  // (Intentionally a no-op; kept so existing init call sites don't break.)
}

/* ── RECENT DOCS ─────────────────────────────────────────────── */
function addToRecent(doc) {
  STATE.recentDocs = STATE.recentDocs.filter(d => d.id !== doc.id);
  STATE.recentDocs.unshift({ ...doc, date: new Date().toLocaleDateString() });
  if (STATE.recentDocs.length > 20) STATE.recentDocs = STATE.recentDocs.slice(0, 20);
  localStorage.setItem('cm_recent', JSON.stringify(STATE.recentDocs));
  updateStorageUI();
}
function renderRecent(filter = '') {
  const grid = document.getElementById('recentGrid');
  if (!grid) return;
  const docs = filter
    ? STATE.recentDocs.filter(d => d.name.toLowerCase().includes(filter.toLowerCase()))
    : STATE.recentDocs;
  if (!docs.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">${filter ? '🔍' : '📂'}</div>
        <p>${filter ? `No results for "${filter}"` : 'No recent documents yet'}</p>
        <p class="es-hint">${filter ? 'Try a different search term' : 'Scan or upload a document to get started'}</p>
      </div>`;
    return;
  }
  grid.innerHTML = docs.slice(0, 8).map(doc => `
    <article class="doc-card" onclick="openRecentDoc('${doc.id}')">
      <div class="doc-thumb">
        ${doc.thumb ? `<img src="${doc.thumb}" alt="${doc.name}" loading="lazy">` : '<span>📄</span>'}
        <span class="doc-badge">${doc.pages || 1} page${(doc.pages||1) > 1 ? 's' : ''}</span>
      </div>
      <div class="doc-info">
        <div class="doc-name" title="${doc.name}">${doc.name}</div>
        <div class="doc-meta">${doc.date} · ${doc.type || 'PDF'}</div>
      </div>
    </article>`).join('');
}
function openRecentDoc(id) {
  const doc = STATE.recentDocs.find(d => d.id === id);
  if (doc) toast(`Opening ${doc.name}…`);
}

/* ── SIDEBAR NAV ─────────────────────────────────────────────── */
function initSidebarNav() {
  document.querySelectorAll('.sb-item').forEach(btn => {
    btn.addEventListener('click', function () {
      const tool = this.dataset.tool;
      const nav  = this.dataset.nav;
      if (tool) { openTool(tool); return; }
      document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      if (nav) handleNavClick(nav);
    });
  });
}
function handleNavClick(nav) {
  const isInTools = window.location.pathname.includes('/tools/');
  const isOnHome  = !isInTools && (
    window.location.pathname === '/' ||
    window.location.pathname.includes('index.html') ||
    window.location.pathname === ''
  );
  const prefix = isInTools ? '../' : '';
  const routes = {
    home:      '/',
    docs:      function() {
      // "My Documents" — scroll to recent docs on homepage, or go home if elsewhere
      if (isOnHome) {
        const grid = document.getElementById('recentGrid');
        if (grid) {
          grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Flash the section so user notices it
          grid.style.transition = 'box-shadow 0.3s';
          grid.style.boxShadow  = '0 0 0 3px var(--primary)';
          setTimeout(() => { grid.style.boxShadow = ''; }, 1500);
        } else {
          toast('No documents yet — scan or upload a file to get started', 'info');
        }
      } else {
        window.location.href = '/';
      }
    },
    tools:     prefix + 'tools.html',
    settings:  prefix + 'settings.html',
    help:      prefix + 'help.html',
    favorites: prefix + 'tools.html#favorites',
    recent:    function() {
      const grid = document.getElementById('recentGrid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else toast('Recent docs below ↓');
    },
  };
  const target = routes[nav];
  if (!target) return;
  if (typeof target === 'function') { target(); return; }
  window.location.href = target;
}

/* ── TOOL NAVIGATION ─────────────────────────────────────────── */
const TOOL_PAGES = {
  'scan':          'scanner.html',
  'import-img':    'scanner.html',
  'import-pdf':    'scanner.html',
  'img-to-pdf':    'tools/image-to-pdf-converter.html',
  'pdf-to-img':    'tools/pdf-to-image-converter.html',
  'crop-pdf':      'tools/crop-pdf-online.html',
  'merge':         'tools/merge-pdf.html',
  'split':         'tools/extract-pdf-pages.html',
  'compress':      'tools/image-compress-resize.html',
  'img-compress':  'tools/image-compress-resize.html',
  'ocr':           'tools/ocr-image-to-text.html',
  'pdf-to-word':   'tools/pdf-to-word-converter.html',
  'word-to-pdf':   'tools/word-to-pdf-converter.html',
  /* ── New tools ── */
  'compress-pdf':  'tools/compress-pdf-reduce-file-size.html',
  'fill-sign':     'tools/fill-sign.html',
  'watermark':     'tools/add-watermark-to-pdf-online.html',
  'page-numbers':  'tools/add-page-numbers-to-pdf-online.html',
  'delete-pages':  'tools/organize-pdf-pages-online.html',
  'html-to-pdf':   'tools/html-to-pdf-converter-online.html',
  'pdf-editor':    'tools/pdf-editor.html',
  'word-counter':  'tools/word-character-counter.html',
  /* ── PDF utilities & generators (Part 5) ── */
  'rotate-pdf':         'tools/organize-pdf-pages-online.html',
  'reorder-pdf':        'tools/organize-pdf-pages-online.html',
  'unlock-pdf':         'tools/unlock-pdf-without-password.html',
  'pdf-restriction-check': 'tools/pdf-restriction-compatibility-check.html',
  'pdf-metadata':       'tools/pdf-metadata.html',
  'pdf-text-extractor': 'tools/pdf-text-extractor.html',
  'searchable-pdf':     'tools/searchable-pdf.html',
};
function openTool(toolId) {
  const isInTools = window.location.pathname.includes('/tools/');
  const prefix = isInTools ? '../' : '';
  const page = TOOL_PAGES[toolId];
  if (page) window.location.href = prefix + page;
  else console.warn('openTool: unknown tool id:', toolId);
}

/* ── DRAG & DROP UPLOAD BOX ──────────────────────────────────── */
function initUploadBox(boxId, fileInputId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  ['dragenter', 'dragover'].forEach(ev =>
    box.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); box.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(ev =>
    box.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); box.classList.remove('drag-over'); })
  );
  box.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files];
    if (files.length) {
      const input = document.getElementById(fileInputId);
      if (input && typeof input.onchange === 'function') {
        Object.defineProperty(input, 'files', { value: e.dataTransfer.files, writable: false });
        input.onchange({ target: input });
      }
    }
  });
}

/* ── GLOBAL TOOL SEARCH INDEX ─────────────────────────────────── */
const TOOL_SEARCH_INDEX = [
  { id:'scan',         name:'Smart Scan',          desc:'AI document scanner with auto edge detection', icon:'📷', category:'Scanner',     keywords:['scan','camera','photo','capture','edge','crop','opencv'] },
  { id:'img-to-pdf',   name:'Image to PDF',         desc:'Convert JPG, PNG, WEBP images to PDF',         icon:'📑', category:'PDF Tools',   keywords:['image','jpg','png','webp','convert','picture','photo'] },
  { id:'pdf-to-img',   name:'PDF to Image',          desc:'PDF pages to JPG, PNG or WebP, up to 600 DPI', icon:'🖼️', category:'PDF Tools',   keywords:['pdf to jpg','pdf to png','pdf to image','extract images','jpg','jpeg','png','webp','image','page'] },
  { id:'crop-pdf',     name:'Crop PDF',              desc:'Remove white margins or crop an area to image', icon:'✂️', category:'PDF Tools',   keywords:['crop','crop pdf','trim','margins','white margins','region','cut','area','map','image','rotate'] },
  { id:'merge',        name:'Merge PDF',             desc:'Combine multiple PDF files into one',          icon:'🔗', category:'PDF Tools',   keywords:['merge','combine','join','unite','two','multiple'] },
  { id:'split',        name:'Split PDF',             desc:'Divide PDF into separate files by page range', icon:'✂️', category:'PDF Tools',   keywords:['split','divide','separate','range','pages','cut'] },
  { id:'compress',     name:'Compress Image',        desc:'Reduce image file size — JPG, PNG, WEBP',      icon:'🗜️', category:'Image Tools', keywords:['compress','reduce','optimize','image','size','quality','jpg'] },
  { id:'compress-pdf', name:'Compress PDF',          desc:'Shrink PDFs, keep text, or set a max size',     icon:'📉', category:'PDF Tools',   keywords:['compress','reduce','pdf','size','optimize','shrink','smaller'] },
  { id:'ocr',          name:'OCR Text',              desc:'Image, screenshot or scanned PDF to text',     icon:'🔤', category:'PDF Tools',   keywords:['ocr','image to text','screenshot to text','jpg to text','text','extract','recognize','scan','urdu','pdf'] },
  { id:'pdf-to-word',  name:'PDF to Word',           desc:'Digital or scanned PDF to editable .docx',         icon:'📝', category:'PDF Tools',   keywords:['word','doc','docx','convert','editable','text','ocr','scanned','urdu'] },
  { id:'word-to-pdf',  name:'Word to PDF',           desc:'DOCX, DOC, ODT or RTF to PDF',               icon:'📄', category:'PDF Tools',   keywords:['word','docx','doc','convert','microsoft'] },
  { id:'fill-sign',    name:'Fill & Sign PDF',       desc:'Add text blocks and signatures to any PDF',    icon:'✍️', category:'PDF Tools',   keywords:['sign','signature','fill','form','annotate','draw','ink'] },
  { id:'watermark',    name:'Watermark PDF',         desc:'Text or logo watermark, any angle, chosen pages',  icon:'💧', category:'PDF Tools',   keywords:['watermark','stamp','brand','overlay','logo','copyright'] },
  { id:'page-numbers', name:'Add Page Numbers',      desc:'Number pages: Page 1 of 10, i/ii, skip cover',    icon:'🔢', category:'PDF Tools',   keywords:['page numbers','numbering','header','footer','pagination'] },
  { id:'pdf-organizer', name:'PDF Organizer',         desc:'Reorder, rotate, delete or add PDF pages',          icon:'🗂️', category:'PDF Tools',   keywords:['delete','remove','rotate','reorder','organize','pages'] },
  { id:'html-to-pdf',  name:'HTML to PDF',           desc:'Paste HTML or upload a page and get a paginated PDF',    icon:'🌐', category:'PDF Tools',   keywords:['html','url','web','page','convert','website','css'] },
  { id:'pdf-editor',   name:'PDF Editor',            desc:'Edit PDF text, sign, fill forms and add links free',    icon:'✏️', category:'PDF Tools',   keywords:['edit','text','modify','annotate','interactive','editor'] },
  { id:'word-counter', name:'Word & Character Counter', desc:'Count words, characters, sentences and reading time', icon:'🔢', category:'Text Tools', keywords:['word','words','word count','word counter','character','characters','character count','character counter','letter','letters','count','counter','text','essay','sentence','paragraph','reading time','limit'] },
];

/* ── SEARCH ──────────────────────────────────────────────────── */
function initSearch() {
  const input = document.querySelector('.search-input');
  if (!input) return;

  /* Inject results overlay into search-wrap */
  const wrap = input.closest('.search-wrap') || input.parentElement;
  if (wrap && !document.getElementById('searchResultsOverlay')) {
    const ol = document.createElement('div');
    ol.id = 'searchResultsOverlay';
    ol.className = 'search-results-overlay';
    ol.style.display = 'none';
    wrap.appendChild(ol);
  }

  let timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    const q = this.value.trim().toLowerCase();
    if (!q) { hideSearchResults(); renderRecent(''); return; }
    timer = setTimeout(() => _showSearchResults(q), 180);
  });
  input.addEventListener('focus', function() {
    if (this.value.trim()) _showSearchResults(this.value.trim().toLowerCase());
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.search-wrap')) hideSearchResults();
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { hideSearchResults(); this.value = ''; renderRecent(''); this.blur(); }
    if (e.key === 'Enter') {
      const first = document.querySelector('.sr-item');
      if (first) first.click();
    }
  });
}

function _showSearchResults(q) {
  const overlay = document.getElementById('searchResultsOverlay');
  if (!overlay) return;
  const results = TOOL_SEARCH_INDEX.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.desc.toLowerCase().includes(q) ||
    t.keywords.some(k => k.includes(q)) ||
    t.category.toLowerCase().includes(q)
  ).slice(0, 12);

  if (!results.length) {
    overlay.innerHTML = `<div class="sr-empty">No tools match "<strong>${q}</strong>"<br><small>Try 'compress', 'sign', 'merge'…</small></div>`;
  } else {
    overlay.innerHTML = `
      <div class="sr-header">🔍 ${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"</div>
      ${results.map(t => `
        <div class="sr-item" onclick="openTool('${t.id}');hideSearchResults();document.querySelector('.search-input').value=''">
          <span class="sr-icon">${t.icon}</span>
          <div class="sr-body">
            <div class="sr-name">${t.name}</div>
            <div class="sr-desc">${t.desc}</div>
          </div>
          <span class="sr-cat">${t.category}</span>
        </div>`).join('')}
    `;
  }
  overlay.style.display = 'block';
}

function hideSearchResults() {
  const overlay = document.getElementById('searchResultsOverlay');
  if (overlay) overlay.style.display = 'none';
}

/* ── FAQ ─────────────────────────────────────────────────────── */
function toggleFAQ(btn) {
  const item   = btn.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(i => {
    i.classList.remove('open');
    i.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
  });
  if (!isOpen) {
    item.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
}

/* ── BRAND LOADER ────────────────────────────────────────────── */
function showBrandLoader(msg, sub) {
  const overlay = document.getElementById('brandLoader');
  if (!overlay) return;
  const textEl = overlay.querySelector('.brand-loader-text');
  const subEl  = overlay.querySelector('.brand-loader-sub');
  if (textEl) textEl.textContent = msg || 'Processing…';
  if (subEl)  subEl.textContent  = sub || '';
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function hideBrandLoader() {
  const overlay = document.getElementById('brandLoader');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

/* ── PASSWORD STRENGTH ────────────────────────────────────────── */
function _checkPwStrength(pass) {
  let score = 0;
  if (pass.length >= 8)  score++;
  if (pass.length >= 12) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  return score; // 0-5
}
function updatePwStrength(val) {
  const bar = document.getElementById('pwStrengthBar');
  if (!bar) return;
  const score = _checkPwStrength(val);
  const pct   = Math.round((score / 5) * 100);
  const colors = ['#ef4444','#f59e0b','#f59e0b','#10b981','#10b981','#059669'];
  bar.style.width      = pct + '%';
  bar.style.background = colors[score] || '#10b981';
}

/* ── MOBILE NAV DRAWER ────────────────────────────────────────── */
function toggleMobileNav() {
  const drawer = document.getElementById('mobileNavDrawer');
  if (!drawer) return;
  const btn = document.getElementById('hamburgerBtn');
  const isOpen = drawer.classList.contains('open');
  drawer.classList.toggle('open', !isOpen);
  drawer.setAttribute('aria-hidden', String(isOpen));
  btn?.setAttribute('aria-expanded', String(!isOpen));
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener('click', _closeMobileNavOutside, { once: true });
    }, 10);
  }
}
function _closeMobileNavOutside(e) {
  const drawer = document.getElementById('mobileNavDrawer');
  const btn    = document.getElementById('hamburgerBtn');
  if (drawer && !drawer.contains(e.target) && !btn?.contains(e.target)) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    btn?.setAttribute('aria-expanded', 'false');
  }
}

/* ── MODAL ───────────────────────────────────────────────────── */
function initModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;

  // Inject "Forgot password?" link into the sign-in panel
  const panelIn = document.getElementById('panelSignIn');
  if (panelIn && !document.getElementById('cmForgotLink')) {
    const fp = document.createElement('p');
    fp.className = 'auth-switch';
    fp.id = 'cmForgotLink';
    fp.style.marginTop = '6px';
    fp.innerHTML = '<a href="/forgot-password">Forgot password?</a>';
    const submitBtn = panelIn.querySelector('.auth-submit');
    if (submitBtn) submitBtn.insertAdjacentElement('afterend', fp);
  }

  // Inject OTP panel if not already present
  if (!document.getElementById('panelOTP')) {
    const pOTP = document.createElement('div');
    pOTP.id = 'panelOTP';
    pOTP.style.display = 'none';
    pOTP.innerHTML =
      '<div style="text-align:center;margin-bottom:20px">' +
        '<div style="font-size:36px;margin-bottom:10px">📧</div>' +
        '<h2 style="margin-bottom:6px;font-size:20px">Check your email</h2>' +
        '<p style="color:var(--text-2);font-size:13px;line-height:1.5">Enter the 6-digit code sent to<br>' +
        '<strong id="otpEmailHint" style="color:var(--text)"></strong></p>' +
      '</div>' +
      '<div class="auth-field">' +
        '<label>Verification Code</label>' +
        '<input type="text" id="otpCode" placeholder="0  0  0  0  0  0" maxlength="6" ' +
               'inputmode="numeric" autocomplete="one-time-code" ' +
               'onkeydown="if(event.key===\'Enter\')submitOTPCode()" ' +
               'style="text-align:center;font-size:26px;letter-spacing:8px;font-weight:700;padding:14px">' +
      '</div>' +
      '<button class="auth-submit" id="otpSubmitBtn" onclick="submitOTPCode()">Verify &amp; Create Account</button>' +
      '<p id="otpTimerEl" style="text-align:center;font-size:12px;color:var(--text-3);margin-top:10px;min-height:18px"></p>' +
      '<p class="auth-switch" style="margin-top:8px">' +
        '<a href="#" id="otpResendA" onclick="resendOTPCode();return false">Resend code</a>' +
        '&nbsp;·&nbsp;' +
        '<a href="#" onclick="_closePanelOTP();switchAuthTab(\'signup\');return false">&#8592; Back</a>' +
      '</p>';
    const inner = modal.querySelector('.auth-modal');
    if (inner) inner.appendChild(pOTP);
  }

  modal.addEventListener('click', e => { if (e.target === modal) closeAuth(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAuth();
      closeProfilePanel();
      const no = document.getElementById('notifOverlay');
      if (no) no.classList.remove('show');
    }
  });
}

/* ── KEYBOARD SHORTCUTS ──────────────────────────────────────── */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const search = document.querySelector('.search-input');
      if (search) search.focus();
    }
  });
}

/* ── LANGUAGE SELECTOR — defers to i18n.js if loaded ─────────── */
/* i18n.js (loaded separately) provides the full 8-language engine.
   These shims ensure backward-compat if i18n.js hasn't loaded yet.  */

function initLangSelector() {
  if (window.I18N) {
    window.I18N.initLangSelector();
    return;
  }
  /* Minimal fallback (4-lang) when i18n.js is absent */
  const _LANGS = [
    { code:'en', name:'English',  native:'English',  flag:'🇺🇸', dir:'ltr' },
    { code:'ur', name:'Urdu',     native:'اردو',     flag:'🇵🇰', dir:'rtl' },
    { code:'ar', name:'Arabic',   native:'العربية',  flag:'🇸🇦', dir:'rtl' },
    { code:'es', name:'Spanish',  native:'Español',  flag:'🇪🇸', dir:'ltr' },
    { code:'fr', name:'French',   native:'Français', flag:'🇫🇷', dir:'ltr' },
    { code:'de', name:'German',   native:'Deutsch',  flag:'🇩🇪', dir:'ltr' },
    { code:'hi', name:'Hindi',    native:'हिन्दी',   flag:'🇮🇳', dir:'ltr' },
    { code:'tr', name:'Turkish',  native:'Türkçe',   flag:'🇹🇷', dir:'ltr' },
  ];
  const _active = localStorage.getItem('cm_lang') || 'en';
  const _cur    = _LANGS.find(l => l.code === _active) || _LANGS[0];
  document.querySelectorAll('.lang-btn').forEach(btn => {
    const flagEl  = btn.querySelector('.lang-flag-current');
    const labelEl = btn.querySelector('.lang-label');
    if (flagEl)  flagEl.textContent  = _cur.flag;
    if (labelEl) labelEl.textContent = _active.toUpperCase();
  });
  document.querySelectorAll('.lang-dropdown').forEach(drop => {
    drop.innerHTML = `<span class="lang-dropdown-header">🌐 Select Language</span>` +
      _LANGS.map(l => `
        <div class="lang-option${_active === l.code ? ' active' : ''}" onclick="setLanguage('${l.code}')">
          <span class="lang-flag">${l.flag}</span>
          <div class="lang-opt-body">
            <div class="lang-opt-name">${l.name}</div>
            <div class="lang-opt-native">${l.native}</div>
          </div>
          ${_active === l.code ? '<span class="lang-check">✓</span>' : ''}
        </div>`).join('');
  });
  if (_cur.dir === 'rtl') document.documentElement.setAttribute('dir', 'rtl');
  else document.documentElement.removeAttribute('dir');
  document.documentElement.setAttribute('lang', _active);
}

/* Global setLanguage — i18n.js will override this if loaded */
let _i18nLoadPromise = null;

function loadI18nOnDemand() {
  if (window.I18N) return Promise.resolve(window.I18N);
  if (_i18nLoadPromise) return _i18nLoadPromise;

  const appRef = document.querySelector('script[src*="app.js"]');
  const url = appRef ? appRef.src.replace('app.js', 'i18n.js') : 'js/i18n.js';
  _i18nLoadPromise = (window.loadScriptOnce
    ? window.loadScriptOnce(url)
    : new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      })
  ).then(() => {
    if (!window.I18N) throw new Error('Language engine could not initialize');
    return window.I18N;
  }).catch(error => {
    _i18nLoadPromise = null;
    throw error;
  });
  return _i18nLoadPromise;
}

if (!window.setLanguage) {
  window.setLanguage = function(code) {
    if (window.I18N) { window.I18N.setLanguage(code); return; }
    localStorage.setItem('cm_lang', code);
    initLangSelector();
    loadI18nOnDemand()
      .then(engine => engine.setLanguage(code))
      .catch(() => toast('Language files could not load. Please try again.', 'error'));
  };
}

/* ── COOKIE CONSENT BANNER ────────────────────────────────────── */
/* ── ANALYTICS TOOL-USAGE TRACKING (Part 8.2) ──────────────────
   Fires a GA4 'tool_used' event (once per page) when the user clicks
   a primary action button. Label = current page name. Works on every
   tool page without editing each file. */
function trackToolUse(label) {
  if (typeof gtag === 'undefined') return;
  gtag('event', 'tool_used', { event_category: 'Tools', event_label: label || location.pathname });
}
window.trackToolUse = trackToolUse;

/* Load analytics only after the initial page load and only after the visitor
   has accepted the cookie notice. The old per-page <head> tags competed with
   critical CSS/tool assets and made slow connections look like a stuck page. */
let _analyticsLoadPromise = null;
function loadAnalyticsOnIdle() {
  if (localStorage.getItem('cm_cookie_consent') !== '1') return Promise.resolve(false);
  if (_analyticsLoadPromise) return _analyticsLoadPromise;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'G-0RWPHD8MHR', {
    anonymize_ip: true,
    cookie_flags: 'SameSite=None;Secure',
  });

  _analyticsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
    if (existing) { resolve(true); return; }
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-0RWPHD8MHR';
    script.onload = () => resolve(true);
    script.onerror = () => { _analyticsLoadPromise = null; reject(new Error('Analytics could not load')); };
    document.head.appendChild(script);
  });
  return _analyticsLoadPromise;
}

function scheduleAnalytics() {
  if (localStorage.getItem('cm_cookie_consent') !== '1') return;
  const start = () => {
    const run = () => loadAnalyticsOnIdle().catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1500);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
(function _autoTrackTool() {
  let fired = false;
  document.addEventListener('click', e => {
    if (fired) return;
    const btn = e.target.closest('button, .btn, a.cta-btn, .ptw-btn');
    if (!btn) return;
    const sig = ((btn.id || '') + ' ' + (btn.className || '') + ' ' + (btn.getAttribute('onclick') || '')).toLowerCase();
    if (/download|convert|process|merge|split|compress|scan|generate|extract|apply|export|summari|rotate|protect|unlock/.test(sig)) {
      const page = (location.pathname.split('/').pop() || 'home').replace('.html', '');
      trackToolUse(page);
      fired = true;
    }
  }, true);
})();

/* ── XSS SANITIZER (Part 0.1) ──────────────────────────────────
   Escape user-typed text before inserting it into the DOM. */
function sanitizeInput(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str == null ? '' : str)));
  return div.innerHTML;
}
window.sanitizeInput = sanitizeInput;

/* ── GLOBAL ERROR HANDLER (Part 0.6) ───────────────────────────
   Injects a hidden #global-error banner on every page and shows a
   friendly message on unhandled promise rejections / runtime errors. */
function _initGlobalError() {
  let box = document.getElementById('global-error');
  if (!box) {
    box = document.createElement('div');
    box.id = 'global-error';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'display:none;color:#b91c1c;padding:10px 14px;background:#fff5f5;' +
      'border:1px solid #fecaca;border-radius:8px;margin:10px;position:fixed;top:70px;' +
      'left:50%;transform:translateX(-50%);z-index:99998;max-width:90%;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.12)';
    document.body.appendChild(box);
  }
  const show = () => {
    box.textContent = 'Something went wrong. Please refresh the page and try again.';
    box.style.display = 'block';
    clearTimeout(box._t);
    box._t = setTimeout(() => { box.style.display = 'none'; }, 6000);
  };
  window.addEventListener('unhandledrejection', e => { console.error('Unhandled rejection:', e.reason); show(); });
  window.addEventListener('error', e => { console.error('Runtime error:', e.message); });
}

function _initCookieBanner() {
  if (localStorage.getItem('cm_cookie_consent') === '1') return;
  const p = window.location.pathname;
  const base = p.split('/').filter(Boolean).length > 1 ? '../' : '';
  const banner = document.createElement('div');
  banner.id = 'cmCookieBanner';
  banner.innerHTML =
    '<span class="ccb-text">PDFdukan uses browser storage for preferences, and Google Analytics may use cookies or similar identifiers. ' +
    'Read our <a href="' + base + 'cookies.html">Cookies and Local Storage Policy</a>.</span>' +
    '<div class="ccb-btns">' +
      '<a href="' + base + 'cookies.html" class="ccb-more" aria-label="Learn more about our cookie policy">Details</a>' +
      '<button class="ccb-accept" onclick="_acceptCookies()">Got it</button>' +
    '</div>';
  const st = document.createElement('style');
  st.textContent =
    '#cmCookieBanner{position:fixed;bottom:0;left:0;right:0;z-index:8888;background:var(--card,#1a1a2e);' +
    'border-top:1px solid var(--border,#2a2a3e);padding:14px 24px;display:flex;align-items:center;' +
    'justify-content:space-between;gap:16px;flex-wrap:wrap;box-shadow:0 -4px 20px rgba(0,0,0,.3);' +
    'animation:ccbUp .3s ease}' +
    '@keyframes ccbUp{from{transform:translateY(100%)}to{transform:translateY(0)}}' +
    '.ccb-text{font-size:13px;color:var(--text-2,#ccc);flex:1;min-width:200px;line-height:1.5}' +
    '.ccb-text a{color:var(--primary,#ff6333);text-decoration:underline}' +
    '.ccb-btns{display:flex;gap:10px;align-items:center;flex-shrink:0}' +
    '.ccb-more{font-size:13px;color:var(--text-2,#ccc);padding:8px 14px;border-radius:7px;' +
    'text-decoration:none;border:1px solid var(--border,#333);background:transparent;white-space:nowrap}' +
    '.ccb-accept{font-size:13px;font-weight:700;color:#fff;background:#ff6333;border:none;' +
    'padding:9px 22px;border-radius:7px;cursor:pointer;white-space:nowrap}' +
    '.ccb-accept:hover{opacity:.85}' +
    '@media(max-width:540px){#cmCookieBanner{flex-direction:column;align-items:flex-start}}';
  document.head.appendChild(st);
  document.body.appendChild(banner);
}
function _acceptCookies() {
  try { localStorage.setItem('cm_cookie_consent', '1'); } catch(e) {}
  const b = document.getElementById('cmCookieBanner'); if (b) b.remove();
  scheduleAnalytics();
}
window._acceptCookies = _acceptCookies;

/* ── SEARCH / AI TRUST SIGNALS ──────────────────────────────── */
function _initSearchTrustSignals() {
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href.split('#')[0];
  const description = document.querySelector('meta[name="description"]')?.content || '';
  const title = document.querySelector('h1')?.textContent?.trim() || document.title.split('|')[0].trim();
  const toolId = document.body.dataset.tool;
  const featureMap = {
    'compress-pdf':['Keep text mode re-saves photos and keeps text, links and forms','Pages as images mode with a max size (KB/MB)','Keeps your original when the result is not smaller'],
    'compress':['JPG, PNG and WEBP compression','Quality controls','Client-side image processing'],
    'crop-pdf':['Remove white margins automatically, text stays sharp','Crop all pages, one page or a range','Crop an area to JPG, PNG or WebP'],
    'fill-sign':['Draw, type or upload a signature','Add movable text fields','Export a signed PDF'],
    'html-to-pdf':['Smart page breaks, clickable links','Upload HTML with CSS, images, fonts','A4, Letter, Legal; no sign-up'],
    'img-to-pdf':['JPG, PNG and WEBP input','Page size and orientation controls','Multi-image PDF export'],
    'merge-pdf':['Reorder and combine PDFs','Multiple file support','Client-side merge'],
    'ocr':['JPG, PNG, WebP, GIF, BMP or scanned PDF','Paste a screenshot or add up to 20 images','37 languages, TXT and Word download'],
    'page-numbers':['Skip cover, Roman front pages','Page 1 of 10, custom text, Bates zeros','Mirrored corners for double-sided print'],
    'pdf-editor':['Retype existing text in a matching font','Sign, fill forms and add clickable links','Rotate, move, delete or add pages'],
    'pdf-metadata':['View and edit title, author, subject and keywords','Output bytes are reopened and metadata values checked','PDF rewrite may affect signatures or unsupported interactive structures'],
    'pdf-organizer':['Drag to reorder pages','Rotate, duplicate or delete pages','Add blank pages or another PDF'],
    'pdf-text-extractor':['Text in reading order, columns and right-to-left lines','Scanned pages read with OCR in 13 languages','Copy, UTF-8 TXT or Word .docx'],
    'pdf-to-img':['Pages to JPG, PNG or WebP at 72–600 DPI','Save the photos inside a PDF','Opens password-protected PDFs in your browser'],
    'pdf-to-word':['Digital and scanned PDFs, OCR in 37 languages','Columns, paragraphs, headings, tables, images and links','Password-protected PDFs open in your browser'],
    'searchable-pdf':['JPG or PNG input with a searchable OCR text layer','Selectable OCR language','Manual review before downloading the generated PDF'],
    'split-pdf':['Custom page ranges','Split every page','ZIP download for multiple outputs'],
    'unlock-pdf':['Removes print, copy and edit restrictions without a password','Removes the open password when you enter it','Up to 20 PDFs, 100 MB each, in the browser'],
    'pdf-restriction-check':['Open password, 8 permission flags and encryption type','Signatures, form fields, PDF/A and accessibility basics','Read-only: does not remove passwords or restrictions'],
    'watermark':['Text in any script or a logo image','9 positions or tiled, any angle, behind or over content','All, odd, even or chosen pages; up to 20 PDFs at once'],
    'word-to-pdf':['DOCX, DOC, ODT, RTF and TXT input','LibreOffice office engine in the browser, no upload','Up to 10 files, ZIP or one combined PDF']
  };

  if (toolId) {
    const features = featureMap[toolId] || ['Free browser-based utility','Client-side processing where stated'];
    const schema = {
      '@context':'https://schema.org', '@type':'WebApplication', name:title, url:canonical,
      description:description, applicationCategory:'UtilitiesApplication', operatingSystem:'Any',
      browserRequirements:'Requires a modern browser with JavaScript enabled',
      offers:{'@type':'Offer',price:'0',priceCurrency:'USD'}, featureList:features,
      publisher:{'@type':'Organization',name:'PDFdukan',url:'https://pdfdukan.com/'},
      dateModified:'2026-08-25'
    };
    const hasAppSchema = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(el => {
      try {
        const data = JSON.parse(el.textContent);
        const records = data['@graph'] || [data];
        return records.some(record => record && ['WebApplication','SoftwareApplication'].includes(record['@type']));
      } catch (e) { return false; }
    });
    if (!hasAppSchema) {
      const schemaEl = document.createElement('script');
      schemaEl.type = 'application/ld+json';
      schemaEl.dataset.generated = 'tool-application';
      schemaEl.textContent = JSON.stringify(schema);
      document.head.appendChild(schemaEl);
    }

    const seo = document.querySelector('.seo-section');
    if (seo && !document.querySelector('.cm-review-note')) {
      const note = document.createElement('aside');
      note.className = 'cm-review-note';
      note.setAttribute('aria-label','Tool review information');
      note.innerHTML = '<strong>PDFdukan product review</strong><span>Page and feature claims reviewed 25 August 2026</span><span>Free to use · No fake ratings · Limitations are stated on this page</span>';
      seo.insertBefore(note, seo.firstChild);
    }
  }

  if (location.pathname.includes('/blog/') && !location.pathname.endsWith('/blog/') && !location.pathname.endsWith('/blog/index.html')) {
    const article = document.querySelector('article, .blog-post, .post-content, main');
    if (article && !document.querySelector('.cm-article-byline')) {
      const byline = document.createElement('div');
      byline.className = 'cm-article-byline';
      byline.textContent = 'Written by the PDFdukan Editorial Team · Updated 25 August 2026';
      const firstHeading = article.querySelector('h1');
      if (firstHeading) firstHeading.insertAdjacentElement('afterend', byline);
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const data = JSON.parse(el.textContent);
        const records = data['@graph'] || [data];
        records.forEach(record => {
          if (record && (record['@type'] === 'Article' || record['@type'] === 'BlogPosting')) {
            if (!record.author) record.author = {'@type':'Organization','name':'PDFdukan Editorial Team','url':'https://pdfdukan.com/about.html'};
            if (!record.publisher) record.publisher = {'@type':'Organization','name':'PDFdukan','url':'https://pdfdukan.com/'};
            record.dateModified = '2026-08-25';
          }
        });
        el.textContent = JSON.stringify(data);
      } catch (e) {}
    });
  }
}

/* ── HOMEPAGE AMBIENT DOT GLOBE ────────────────────────────────
   Decorative only: contained in the hero, pauses off-screen, becomes static
   on touch/reduced-motion devices, and never intercepts input. */
function initAmbientGlobe() {
  const homePath = location.pathname === '/' || /\/site-root-internal\.html$/.test(location.pathname);
  const hero = document.querySelector('.hero-section');
  if (!homePath || !hero || document.getElementById('ambientGlobe')) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'ambientGlobe';
  canvas.className = 'ambient-globe';
  canvas.setAttribute('aria-hidden', 'true');
  hero.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { canvas.remove(); return; }

  const points = [];
  for (let lat = -75; lat <= 75; lat += 25) {
    for (let lon = 0; lon < 360; lon += 30) {
      points.push({ lat: lat * Math.PI / 180, lon: lon * Math.PI / 180 });
    }
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(hover: none), (pointer: coarse)').matches;
  const compact = matchMedia('(max-width: 700px)').matches;
  let width = 1, height = 1, dpr = 1, angle = 0, shiftX = 0, shiftY = 0;
  let targetX = 0, targetY = 0, visible = true, frame = 0, last = performance.now();

  function resize() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    draw();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const light = document.documentElement.dataset.theme === 'light';
    const rgb = light ? '201,71,36' : '255,128,85';
    const cx = width * (width < 700 ? 0.72 : 0.67) + shiftX;
    const cy = height * (width < 700 ? 0.22 : 0.25) + shiftY;
    const radius = Math.min(width * (width < 700 ? 0.32 : 0.23), height * 0.25, 205);
    points.forEach(point => {
      const cosLat = Math.cos(point.lat);
      const x3 = cosLat * Math.cos(point.lon + angle);
      const y3 = Math.sin(point.lat);
      const z3 = cosLat * Math.sin(point.lon + angle);
      const depth = (z3 + 1) / 2;
      const perspective = 0.78 + depth * 0.22;
      const x = cx + x3 * radius * perspective;
      const y = cy + y3 * radius;
      const dot = 0.7 + depth * 1.8;
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + rgb + ',' + (0.045 + depth * (light ? 0.13 : 0.18)) + ')';
      ctx.fill();
    });
  }

  function loop(now) {
    if (!visible || document.hidden) { frame = requestAnimationFrame(loop); last = now; return; }
    const dt = Math.min(32, now - last); last = now;
    angle += dt * 0.00006;
    shiftX += (targetX - shiftX) * 0.035;
    shiftY += (targetY - shiftY) * 0.035;
    draw();
    frame = requestAnimationFrame(loop);
  }

  if (!reduced && !coarse && !compact) {
    hero.addEventListener('pointermove', event => {
      const rect = hero.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 24;
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 16;
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; }, { passive: true });
    frame = requestAnimationFrame(loop);
  }
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting !== false; }, { rootMargin: '100px' }) : null;
  observer?.observe(hero);
  const resizer = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  resizer?.observe(hero);
  if (!resizer) window.addEventListener('resize', resize, { passive: true });
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  resize();
}

/* ── INIT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(STATE.theme);
  updateAuthUI();
  _initFeatureGate();
  renderRecent();
  initSidebarNav();
  initSearch();
  initModal();
  initKeyboardShortcuts();
  renderNotificationBadge();
  updateStorageUI();
  /* English is already present in the HTML, so do not download/parse the
     70 KB translation dictionary on every page view. Persisted non-English
     preferences still load immediately; a new language loads on selection. */
  const savedLanguage = localStorage.getItem('cm_lang') || 'en';
  if (!window.I18N && savedLanguage !== 'en') {
    loadI18nOnDemand()
      .then(engine => engine.initLangSelector())
      .catch(error => console.warn('Language files could not load:', error));
  }
  initLangSelector();

  // Lazy load images
  if ('loading' in HTMLImageElement.prototype) {
    document.querySelectorAll('img:not([loading])').forEach(img => img.setAttribute('loading', 'lazy'));
  }

  _initCookieBanner();
  scheduleAnalytics();
  _initGlobalError();
  _initSearchTrustSignals();
  initAmbientGlobe();
  console.log('%c CamMaster by PDFdukan ', 'background:#ff6333;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;');
});

/* ── PDFdukan tool icons (SVG, one style) ───────────────────────── */
(function _toolIcons() {
  var G = {
    'image-to-pdf':   '<rect x="4.5" y="5.5" width="9" height="7" rx="1"/><path d="M5 12l2.5-3 2 2 1.5-1.5 2.5 2.5"/>',
    'pdf-to-jpg':     '<rect x="4.5" y="5" width="9" height="8" rx="1"/><circle cx="7.5" cy="7.8" r="1"/><path d="M5 12.5l3-3 2 2 1.2-1 2.3 2"/>',
    'pdf-to-word':    '<path d="M4.5 5.5l1.6 7 2.4-6 2.4 6 1.6-7"/>',
    'word-to-pdf':    '<path d="M4 9h7M8.5 6l3 3-3 3"/><path d="M13.5 5v8"/>',
    'html-to-pdf':    '<path d="M7 5.5L4 9l3 3.5M11 5.5L14 9l-3 3.5"/>',
    'merge':          '<path d="M4.5 4.5L9 9l4.5-4.5M9 9v4.5"/><path d="M6.8 11.5L9 13.7l2.2-2.2"/>',
    'split':          '<path d="M9 4.5v9" stroke-dasharray="1.6 1.6"/><path d="M6.5 7L4 9l2.5 2M11.5 7L14 9l-2.5 2"/>',
    'compress':       '<path d="M9 4v4M7 6l2 2 2-2M9 14v-4M7 12l2-2 2 2M5 9h8"/>',
    'organize':       '<path d="M13 8.5A4 4 0 1 0 12 12"/><path d="M13.5 5.5V9H10"/>',
    'crop':           '<path d="M6.5 4v8.5H15M4 6.5h8.5V15"/>',
    'edit':           '<path d="M5 13l.6-2.6 6.2-6.2 2 2-6.2 6.2z"/><path d="M10.6 5.4l2 2"/>',
    'fill-sign':      '<path d="M4 12c1.5-4 2.5-6 3.5-5s-1.5 5 0 5 2-3 3-3 1 2 2 2 1.5-1 2.5-1"/>',
    'watermark':      '<path d="M9 4.5c2 2.6 3.5 4.4 3.5 6.1a3.5 3.5 0 0 1-7 0C5.5 8.9 7 7.1 9 4.5z"/>',
    'page-numbers':   '<path d="M5 6.5l1.5-1v7M10 6.5a1.6 1.6 0 1 1 2.6 1.4L10 12.5h3.4"/>',
    'unlock':         '<rect x="5" y="8.5" width="8" height="5.5" rx="1.2"/><path d="M7 8.5V7a2.5 2.5 0 0 1 4.8-1"/>',
    'restriction':    '<path d="M9 4l4.5 1.8v3.4c0 2.6-2 4.3-4.5 5-2.5-.7-4.5-2.4-4.5-5V5.8z"/><path d="M7 9.2l1.5 1.5L11.2 8"/>',
    'metadata':       '<path d="M4.5 9.5V5h4.5l5 5-4.5 4.5z"/><circle cx="7" cy="7.2" r=".9"/>',
    'scan':           '<path d="M4 7V5h2M12 5h2v2M14 11v2h-2M6 13H4v-2"/><rect x="6.5" y="7" width="5" height="4" rx=".8"/>',
    'ocr':            '<path d="M4 6V4.5h1.5M12.5 4.5H14V6M14 12v1.5h-1.5M5.5 13.5H4V12"/><path d="M6.5 7h5M9 7v4.5"/>',
    'text-extract':   '<path d="M4.5 6h6M4.5 9h6M4.5 12h4"/><path d="M11.5 10.5l2 2 2-2M13.5 7v5.5"/>',
    'searchable':     '<circle cx="8" cy="8" r="3.2"/><path d="M10.4 10.4L13.5 13.5"/>',
    'img-compress':   '<rect x="4.5" y="5" width="9" height="8" rx="1"/><path d="M7 7.3l2 1.7 2-1.7M7 10.7l2-1.7 2 1.7"/>',
    'word-counter':   '<path d="M4.5 6.5l1.4-1v7M8 6.5a1.4 1.4 0 1 1 2.3 1.2L8 12.5h3M12.5 5.5h2l-1.3 2.2a1.6 1.6 0 1 1-1 2.8"/>'
  };
  var MAP = {
    '/tools/image-to-pdf-converter.html': 'image-to-pdf', '/tools/pdf-to-image-converter.html': 'pdf-to-jpg',
    '/tools/pdf-to-word-converter.html': 'pdf-to-word', '/tools/word-to-pdf-converter.html': 'word-to-pdf',
    '/tools/html-to-pdf-converter-online.html': 'html-to-pdf', '/tools/merge-pdf.html': 'merge',
    '/tools/extract-pdf-pages.html': 'split', '/tools/compress-pdf-reduce-file-size.html': 'compress',
    '/tools/organize-pdf-pages-online.html': 'organize', '/tools/crop-pdf-online.html': 'crop',
    '/tools/pdf-editor.html': 'edit', '/tools/fill-sign.html': 'fill-sign',
    '/tools/add-watermark-to-pdf-online.html': 'watermark', '/tools/add-page-numbers-to-pdf-online.html': 'page-numbers',
    '/tools/unlock-pdf-without-password.html': 'unlock', '/tools/pdf-restriction-compatibility-check.html': 'restriction',
    '/tools/pdf-metadata.html': 'metadata', '/scanner.html': 'scan', '/tools/ocr-image-to-text.html': 'ocr',
    '/tools/pdf-text-extractor.html': 'text-extract', '/tools/searchable-pdf.html': 'searchable',
    '/tools/image-compress-resize.html': 'img-compress', '/tools/word-character-counter.html': 'word-counter'
  };
  /* A page with folded corner; the tool glyph sits on an orange badge. */
  function svg(key) {
    return '<svg class="pd-ico" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
      '<path class="pd-ico-page" d="M11 4h17.5L38 13.5V41a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/>' +
      '<path class="pd-ico-fold" d="M28.5 4v7a2.5 2.5 0 0 0 2.5 2.5h7"/>' +
      '<path class="pd-ico-lines" d="M13.5 15h10M13.5 20h13M13.5 25h8"/>' +
      '<g transform="translate(17 18)"><rect class="pd-ico-badge" width="29" height="29" rx="8"/>' +
      '<g class="pd-ico-glyph" transform="translate(2.6 2.6) scale(1.33)">' + G[key] + '</g></g></svg>';
  }
  function keyOf(href) { try { return MAP[new URL(href, location.href).pathname]; } catch (e) { return null; } }
  function apply(root) {
    (root || document).querySelectorAll('a.tool-card, a.big-tool-card, a.related-tool-card').forEach(function (a) {
      var k = keyOf(a.getAttribute('href')); if (!k) return;
      var box = a.querySelector('.tool-icon-wrap, .btc-icon, .rtc-icon');
      if (!box || box.querySelector('.pd-ico')) return;
      box.innerHTML = svg(k); box.classList.add('has-pd-ico');
    });
    var k = MAP[location.pathname], hero = document.querySelector('.tool-hero-icon');
    if (k && hero && !hero.querySelector('.pd-ico')) { hero.innerHTML = svg(k); hero.classList.add('has-pd-ico'); }
  }
  window.PDIcons = { apply: apply, svg: svg, MAP: MAP };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); }); else apply();
})();

/* ── FAVORITE TOOLS (star on every tool card + tool page) ─────────
   Saved in this browser only (localStorage "pd-favs-v1"). */
(function _favorites() {
  var KEY = 'pd-favs-v1';
  var TOOLS = {"/tools/image-to-pdf-converter.html": ["Image to PDF", "📑"], "/tools/pdf-to-image-converter.html": ["PDF to JPG", "🖼️"], "/tools/pdf-to-word-converter.html": ["PDF to Word", "📝"], "/tools/word-to-pdf-converter.html": ["Word to PDF", "📄"], "/tools/html-to-pdf-converter-online.html": ["HTML to PDF", "🌐"], "/tools/merge-pdf.html": ["Merge PDF", "🔗"], "/tools/extract-pdf-pages.html": ["Split PDF", "✂️"], "/tools/compress-pdf-reduce-file-size.html": ["Compress PDF", "📉"], "/tools/organize-pdf-pages-online.html": ["Organize PDF", "🔄"], "/tools/crop-pdf-online.html": ["Crop PDF", "🔲"], "/tools/pdf-editor.html": ["Edit PDF", "✏️"], "/tools/fill-sign.html": ["Fill & Sign", "🖊️"], "/tools/add-watermark-to-pdf-online.html": ["Add Watermark", "💧"], "/tools/add-page-numbers-to-pdf-online.html": ["Page Numbers", "🔢"], "/tools/unlock-pdf-without-password.html": ["Unlock PDF", "🔓"], "/tools/pdf-restriction-compatibility-check.html": ["Restriction Check", "🛡️"], "/tools/pdf-metadata.html": ["PDF Metadata", "🏷️"], "/scanner.html": ["Smart Scan", "📷"], "/tools/ocr-image-to-text.html": ["Image to Text (OCR)", "🔤"], "/tools/pdf-text-extractor.html": ["PDF Text Extractor", "📃"], "/tools/searchable-pdf.html": ["Searchable PDF", "🔍"], "/tools/image-compress-resize.html": ["Image Compressor", "🗜️"], "/tools/word-character-counter.html": ["Word Counter", "🧮"]};
  var STAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';
  function load() { try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(function (p) { return TOOLS[p]; }) : []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function pathOf(href) { try { var p = new URL(href, location.href).pathname; return p.replace(/\/index\.html$/, '/'); } catch (e) { return ''; } }
  function isFav(p) { return load().indexOf(p) >= 0; }
  function makeStar(p, cls) {
    var b = document.createElement(cls === 'fav-star-hero' ? 'button' : 'span');
    b.className = 'fav-star ' + (cls || '');
    if (b.tagName === 'BUTTON') b.type = 'button'; else { b.setAttribute('role', 'button'); b.tabIndex = 0; }
    b.dataset.favPath = p; b.innerHTML = STAR;
    paint(b);
    return b;
  }
  function paint(b) {
    var p = b.dataset.favPath, on = isFav(p), n = TOOLS[p][0];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + n + (on ? ' from favorites' : ' to favorites'));
    b.removeAttribute('title'); b.dataset.tip = on ? 'Remove from favorites' : 'Add to favorites';
    if (b.classList.contains('fav-star-hero')) b.innerHTML = STAR + '<span>' + (on ? 'Saved to favorites' : 'Add to favorites') + '</span>';
  }
  function toggle(p) {
    var a = load(), i = a.indexOf(p);
    if (i >= 0) a.splice(i, 1); else a.unshift(p);
    save(a);
    document.querySelectorAll('.fav-star').forEach(function (b) { if (b.dataset.favPath === p) paint(b); });
    renderBox();
    if (typeof toast === 'function') toast(i >= 0 ? TOOLS[p][0] + ' removed from favorites' : '⭐ ' + TOOLS[p][0] + ' added to favorites', i >= 0 ? '' : 'success', 1800);
  }
  function onAct(e) {
    var b = e.target.closest && e.target.closest('.fav-star'); if (!b) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    toggle(b.dataset.favPath);
  }
  function decorate(root) {
    (root || document).querySelectorAll('a.tool-card, a.big-tool-card, a.related-tool-card').forEach(function (a) {
      if (a.querySelector('.fav-star')) return;
      var p = pathOf(a.getAttribute('href')); if (!TOOLS[p]) return;
      a.classList.add('has-fav');
      a.appendChild(makeStar(p, a.classList.contains('related-tool-card') ? 'fav-star-sm' : ''));
    });
  }
  function decorateHero() {
    var p = pathOf(location.href); if (!TOOLS[p] || document.querySelector('.fav-star-hero')) return;
    var h1 = document.querySelector('.tool-hero h1, .tool-hero-copy h1, main h1, h1'); if (!h1) return;
    var b = makeStar(p, 'fav-star-hero');
    h1.insertAdjacentElement('afterend', b);
  }
  function card(p) {
    var t = TOOLS[p];
    var a = document.createElement('a'); a.className = 'tool-card'; a.href = p;
    a.innerHTML = '<div class="tool-icon-wrap">' + t[1] + '</div><div class="tc-name"></div>';
    a.querySelector('.tc-name').textContent = t[0];
    return a;
  }
  function renderBox() {
    var anchor = document.getElementById('all-tools') || document.getElementById('cat-scanner');
    if (!anchor) return;
    var box = document.getElementById('favorites'), favs = load();
    var want = favs.length || /#favorites/.test(location.hash);
    if (!want) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('section'); box.id = 'favorites'; box.className = 'fav-box';
      box.setAttribute('aria-labelledby', 'favHead');
      anchor.parentNode.insertBefore(box, anchor);
    }
    box.innerHTML = '<div class="section-header"><h2 class="section-title" id="favHead"><span class="st-icon">⭐</span> Your Favorite Tools</h2></div>';
    if (!favs.length) { box.insertAdjacentHTML('beforeend', '<p class="fav-empty">Tap the ☆ star on any tool to keep it here. Favorites are saved in this browser.</p>'); return; }
    var g = document.createElement('div'); g.className = 'tools-grid fav-grid';
    favs.forEach(function (p) { g.appendChild(card(p)); });
    box.appendChild(g); if (window.PDIcons) PDIcons.apply(box); decorate(box);
  }
  function init() {
    decorate(); decorateHero(); renderBox();
    if (/#favorites/.test(location.hash)) { var b = document.getElementById('favorites'); if (b) setTimeout(function () { b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200); }
  }
  document.addEventListener('click', onAct, true);
  document.addEventListener('keydown', onAct, true);
  window.addEventListener('storage', function (e) { if (e.key === KEY) { document.querySelectorAll('.fav-star').forEach(paint); renderBox(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PDFavorites = { load: load, toggle: toggle, decorate: decorate };
})();
/* ── OPEN FILES FROM GOOGLE DRIVE / DROPBOX ───────────────────────
   Buttons appear only when the keys below are filled in. Picked files are
   downloaded straight into the browser and handed to the tool's own file
   input, so processing stays on the device. */
var PD_CLOUD = {
  googleApiKey: '',            /* Google Cloud API key with "Google Picker API" enabled */
  googleAppId: '233358066910', /* Google Cloud project number (Firebase messagingSenderId) */
  dropboxAppKey: ''            /* Dropbox app key (Chooser, domain pdfdukan.com) */
};
(function _cloudPick() {
  var INPUTS = {
    '/tools/merge-pdf.html': 'fileInput', '/tools/extract-pdf-pages.html': 'fileInput',
    '/tools/compress-pdf-reduce-file-size.html': 'fileInput', '/tools/organize-pdf-pages-online.html': 'orgFileInput',
    '/tools/crop-pdf-online.html': 'crFileInput', '/tools/pdf-editor.html': 'file-input-hidden',
    '/tools/fill-sign.html': 'fileInput', '/tools/add-watermark-to-pdf-online.html': 'wmFileInput',
    '/tools/add-page-numbers-to-pdf-online.html': 'pnFileInput', '/tools/unlock-pdf-without-password.html': 'ulFileInput',
    '/tools/pdf-restriction-compatibility-check.html': 'rcFileInput', '/tools/pdf-metadata.html': 'fileInput',
    '/tools/pdf-to-word-converter.html': 'fileInput', '/tools/pdf-to-image-converter.html': 'fileInput',
    '/tools/image-to-pdf-converter.html': 'fileInput', '/tools/word-to-pdf-converter.html': 'fileInput',
    '/tools/ocr-image-to-text.html': 'fileInput', '/tools/pdf-text-extractor.html': 'txFileInput',
    '/tools/searchable-pdf.html': 'fileInput', '/tools/image-compress-resize.html': 'fileInput'
  };
  var MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
  function exts(input) {
    var a = (input.getAttribute('accept') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }), out = [];
    a.forEach(function (s) {
      if (s.charAt(0) === '.') out.push(s.slice(1));
      else if (s === 'image/*') out.push('jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp');
      else Object.keys(MIME).forEach(function (k) { if (MIME[k] === s) out.push(k); });
    });
    return out.filter(function (v, i) { return out.indexOf(v) === i; });
  }
  function loadScript(src, attrs) {
    return new Promise(function (res, rej) {
      if (attrs && attrs.id && document.getElementById(attrs.id)) return res();
      var s = document.createElement('script'); s.src = src; s.async = true;
      Object.keys(attrs || {}).forEach(function (k) { s.setAttribute(k, attrs[k]); });
      s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function say(m, t) { if (typeof toast === 'function') toast(m, t || 'info', 3500); }
  function hand(input, files) {
    if (!files.length) return;
    var dt = new DataTransfer(); files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function asFile(blob, name) { var e = (name.split('.').pop() || '').toLowerCase(); return new File([blob], name, { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : (MIME[e] || '') }); }

  /* Dropbox Chooser */
  async function fromDropbox(input) {
    try { await loadScript('https://www.dropbox.com/static/api/2/dropins.js', { id: 'dropboxjs', 'data-app-key': PD_CLOUD.dropboxAppKey }); }
    catch (e) { say('Dropbox could not load. Check your connection and try again.', 'error'); return; }
    window.Dropbox.choose({
      linkType: 'direct', multiselect: !!input.multiple, extensions: exts(input).map(function (e) { return '.' + e; }),
      success: async function (items) {
        say('Opening ' + items.length + ' file' + (items.length > 1 ? 's' : '') + ' from Dropbox…');
        try {
          var files = [];
          for (var i = 0; i < items.length; i++) { var r = await fetch(items[i].link); if (!r.ok) throw new Error(r.status); files.push(asFile(await r.blob(), items[i].name)); }
          hand(input, files);
        } catch (e) { say('Could not download the file from Dropbox. Please try again.', 'error'); }
      }
    });
  }

  /* Google Drive Picker (drive.file scope: only files the user picks) */
  async function driveToken() {
    var t = typeof _gdriveToken === 'function' ? _gdriveToken() : null;
    if (t) return t;
    if (typeof signInWithGoogle === 'function') { await signInWithGoogle(); t = _gdriveToken(); }
    return t;
  }
  async function fromDrive(input) {
    var token = await driveToken();
    if (!token) { say('Sign in with Google to open files from Drive.', 'error'); return; }
    try { await loadScript('https://apis.google.com/js/api.js', { id: 'gapijs' }); await new Promise(function (r) { gapi.load('picker', r); }); }
    catch (e) { say('Google Drive could not load. Check your connection and try again.', 'error'); return; }
    var P = google.picker, mimes = exts(input).map(function (e) { return MIME[e]; }).filter(Boolean).join(',');
    var view = new P.DocsView(P.ViewId.DOCS).setMimeTypes(mimes).setIncludeFolders(true).setSelectFolderEnabled(false);
    var b = new P.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(PD_CLOUD.googleApiKey).setAppId(PD_CLOUD.googleAppId)
      .setOrigin(location.protocol + '//' + location.host)
      .setCallback(async function (d) {
        if (d.action !== P.Action.PICKED) return;
        say('Opening ' + d.docs.length + ' file' + (d.docs.length > 1 ? 's' : '') + ' from Google Drive…');
        try {
          var files = [];
          for (var i = 0; i < d.docs.length; i++) {
            var r = await fetch('https://www.googleapis.com/drive/v3/files/' + d.docs[i].id + '?alt=media', { headers: { Authorization: 'Bearer ' + token } });
            if (!r.ok) throw new Error(r.status);
            files.push(asFile(await r.blob(), d.docs[i].name));
          }
          hand(input, files);
        } catch (e) { say('Could not download the file from Google Drive. Please try again.', 'error'); }
      });
    if (input.multiple) b.enableFeature(P.Feature.MULTISELECT_ENABLED);
    b.build().setVisible(true);
  }

  var GD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0066da" d="M3.3 18.4l1 1.7c.2.4.5.6.8.8l3.6-6.2H1.5c0 .4.1.8.3 1.1z"/><path fill="#00ac47" d="M12 8.6L8.4 2.4c-.3.2-.6.5-.8.8L1.8 13.6c-.2.3-.3.7-.3 1.1h7.2z"/><path fill="#ea4335" d="M19.8 20.9c.3-.2.6-.5.8-.8l.4-.7 2-3.4c.2-.3.3-.7.3-1.1h-7.2l1.5 3z"/><path fill="#00832d" d="M12 8.6l3.6-6.2c-.4-.2-.8-.3-1.2-.3H9.6c-.4 0-.8.1-1.2.3z"/><path fill="#2684fc" d="M15.6 14.7H8.4l-3.6 6.2c.4.2.8.3 1.2.3h12.6c.4 0 .8-.1 1.2-.3z"/><path fill="#ffba00" d="M19.8 9l-3.3-5.8c-.2-.4-.5-.6-.8-.8L12 8.6l3.6 6.1h7.2c0-.4-.1-.8-.3-1.1z"/></svg>';
  var DB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0061ff" d="M6 2.5L0 6.3l6 3.9 6-3.9zm12 0l-6 3.8 6 3.9 6-3.9zM0 14l6 3.9 6-3.9-6-3.8zm18-3.8L12 14l6 3.9 6-3.9zM6 19.2l6 3.9 6-3.9-6-3.9z"/></svg>';
  var SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8 3.2v6c0 4.7-3.4 8.3-8 9.8-4.6-1.5-8-5.1-8-9.8v-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.3 12.2l2.5 2.5 4.9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var STAR5 = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';
  var RKEY = 'pd-rated-v1';
  function myVote(tool) { try { return (JSON.parse(localStorage.getItem(RKEY) || '{}'))[tool] || 0; } catch (e) { return 0; } }
  function saveVote(tool, v) { try { var o = JSON.parse(localStorage.getItem(RKEY) || '{}'); o[tool] = v; localStorage.setItem(RKEY, JSON.stringify(o)); } catch (e) {} }
  function ratingWidget(tool) {
    var w = document.createElement('div'); w.className = 'pdz-rate';
    w.innerHTML = '<span class="pdz-stars" role="radiogroup" aria-label="Rate this tool">' +
      [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="pdz-star" data-v="' + n + '" role="radio" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">' + STAR5 + '</button>'; }).join('') +
      '</span><span class="pdz-rate-txt">Rate this tool</span>';
    var stars = w.querySelectorAll('.pdz-star'), txt = w.querySelector('.pdz-rate-txt'), data = { avg: 0, count: 0 };
    function paint(n) { stars.forEach(function (b, i) { b.classList.toggle('on', i < n); b.setAttribute('aria-checked', String(i + 1 === myVote(tool))); }); }
    function show() {
      var mine = myVote(tool);
      paint(mine || Math.round(data.avg));
      txt.innerHTML = data.count ? '<b>' + data.avg.toFixed(1) + '</b> (' + data.count.toLocaleString() + ' vote' + (data.count > 1 ? 's' : '') + ')' + (mine ? ' · you gave ' + mine : '') : (mine ? 'You gave ' + mine + ' stars' : 'Be the first to rate');
    }
    w.addEventListener('mouseover', function (e) { var b = e.target.closest('.pdz-star'); if (b) paint(+b.dataset.v); });
    w.addEventListener('mouseleave', show);
    w.addEventListener('click', async function (e) {
      e.stopPropagation(); e.preventDefault();
      var b = e.target.closest('.pdz-star'); if (!b) return;
      var v = +b.dataset.v;
      try {
        var r = await fetch('/api/rating.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: tool, score: v }) });
        if (!r.ok) throw new Error(r.status);
        data = await r.json(); saveVote(tool, v); show(); say('Thanks for rating! ⭐', 'success');
      } catch (err) { say('Rating could not be saved right now. Please try again later.', 'error'); show(); }
    });
    fetch('/api/rating.php?tool=' + encodeURIComponent(tool), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.count === 'number') data = j; show(); }).catch(show);
    show();
    return w;
  }
  var EXTRA = { '/tools/html-to-pdf-converter-online.html': 'hpFileInput' };
  function init() {
    var path = location.pathname, id = INPUTS[path] || EXTRA[path]; if (!id) return;
    var input = document.getElementById(id); if (!input) return;
    var tool = path.split('/').pop().replace(/\.html$/, '');
    var after = path === '/tools/pdf-editor.html' ? document.querySelector('.dz-btn') : null;
    var zone = after ? after.parentNode : (input.closest('.drop-zone, .upload-zone, .dz, [class*="drop"]') || input.parentNode);
    if (zone.querySelector('.pdz-safe')) return;
    zone.classList.add('pd-zone');
    var safe = document.createElement('div'); safe.className = 'pdz-safe'; safe.innerHTML = SHIELD + '<span>Files stay on your device</span>';
    safe.title = 'Files are processed in your browser and not uploaded';
    zone.insertBefore(safe, zone.firstChild);
    var terms = document.createElement('p'); terms.className = 'pdz-terms';
    terms.innerHTML = 'By using this tool, you accept our <a href="/terms.html">terms of use</a>';
    terms.addEventListener('click', function (e) { e.stopPropagation(); });
    var foot = document.createElement('div'); foot.className = 'pdz-foot';
    foot.appendChild(ratingWidget(tool));
    var g = !!(INPUTS[path] && PD_CLOUD.googleApiKey && PD_CLOUD.googleAppId), d = !!(INPUTS[path] && PD_CLOUD.dropboxAppKey);
    var row = document.createElement('div'); row.className = 'cloud-pick';
    row.innerHTML = (g ? '<button type="button" class="cloud-btn" data-src="drive" data-tip="Google Drive" aria-label="Open a file from Google Drive">' + GD + '</button>' : '') +
      (d ? '<button type="button" class="cloud-btn" data-src="dropbox" data-tip="Dropbox" aria-label="Open a file from Dropbox">' + DB + '</button>' : '');
    row.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      var b = e.target.closest('.cloud-btn'); if (!b) return;
      if (b.dataset.src === 'drive') fromDrive(input); else fromDropbox(input);
    });
    if (g || d) foot.appendChild(row);
    foot.addEventListener('keydown', function (e) { e.stopPropagation(); });
    zone.appendChild(terms); zone.appendChild(foot);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.PDCloud = { init: init, exts: exts };
})();
