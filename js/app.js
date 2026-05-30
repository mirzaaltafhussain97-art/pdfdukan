/* ================================================================
   CamMaster by PDFdukan — Core App Module
   Theme · Toast · Auth · Navigation · Recent Docs · Settings
   Notifications · Storage UI · Pending File Transfer
================================================================ */

/* ── STATE ───────────────────────────────────────────────────── */
const STATE = {
  theme: localStorage.getItem('cm_theme') || 'dark',
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

/* ── NOTIFICATIONS ────────────────────────────────────────────── */
const NOTIFICATIONS_DATA = [
  { id: 1, icon: '🎉', title: 'Welcome to CamMaster!',       body: 'Scan, convert and manage documents — all free, all in your browser. No uploads, no sign-up required.',            date: '2026-05-20' },
  { id: 2, icon: '✨', title: 'New: Smart PDF Merge',         body: 'Select specific pages per file before merging. More control than ever — try it in the Merge PDF tool!',           date: '2026-05-22' },
  { id: 3, icon: '🔒', title: '100% Private Processing',      body: 'All files stay on your device. Nothing is ever uploaded to our servers. Your documents are yours alone.',          date: '2026-05-24' },
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
    hint.textContent = STATE.user
      ? `${count} document${count !== 1 ? 's' : ''} in history`
      : `${count} local doc${count !== 1 ? 's' : ''} · Sign in to sync`;
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
  applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
}

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
      '.cm-fname-input{flex:1;padding:10px 12px;border:1px solid var(--border,#444);border-right:none;border-radius:8px 0 0 8px;background:var(--surface,#161625);color:var(--text,#eee);font-size:14px;font-weight:600;outline:none;transition:border-color .15s}' +
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
    if (_resolve) { _resolve(name + _ext); _resolve = null; }
  }

  function _dismiss() {
    _modal.classList.remove('open');
    if (_resolve) { _resolve(null); _resolve = null; }
  }

  /**
   * Show the filename customization modal.
   * @param {string} defaultName - Full default filename e.g. "document.pdf"
   * @returns {Promise<string|null>} - Chosen filename or null if cancelled
   */
  function prompt(defaultName) {
    _ensureModal();
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
    setTimeout(function() { _input.focus(); _input.select(); }, 60);
    return new Promise(function(resolve) { _resolve = resolve; });
  }

  return { prompt: prompt };
})();
window.CMFilename = CMFilename;

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
    a.download = 'CamMaster_Transaction_Log_' + new Date().toISOString().slice(0, 10) + '.csv';
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

/* ── AUTH ─────────────────────────────────────────────────────── */
function openAuth(tab) {
  if (STATE.user) {
    if (confirm(`Signed in as ${STATE.user.email}\n\nSign out?`)) signOut();
    return;
  }
  const el = document.getElementById('authModal');
  if (el) el.classList.add('show');
  if (tab) switchAuthTab(tab);
}
function closeAuth() {
  const el = document.getElementById('authModal');
  if (el) el.classList.remove('show');
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
function signInWithGoogle() {
  toast('Connecting with Google… please wait.', 'info');
  closeAuth();
}
function signInEmail() {
  const email = document.getElementById('siEmail')?.value.trim();
  const pass  = document.getElementById('siPass')?.value;
  if (!email || !pass) { toast('Please fill in all fields', 'error'); return; }
  if (!_validEmail(email)) { toast('Enter a valid email address', 'error'); return; }
  // Persist a mock session
  const name = email.split('@')[0];
  _saveSession({ name, email });
  toast(`Welcome back, ${name}! ✓`, 'success');
  closeAuth();
}
function signUpEmail() {
  const username = document.getElementById('suUsername')?.value.trim();
  const gender   = document.getElementById('suGender')?.value;
  const name     = document.getElementById('suName')?.value.trim();
  const email    = document.getElementById('suEmail')?.value.trim();
  const phone    = document.getElementById('suPhone')?.value.trim();   // optional
  const pass     = document.getElementById('suPass')?.value;
  const passConf = document.getElementById('suPassConf')?.value;

  // Validate required fields
  if (!username)            { toast('Please enter a username', 'error'); return; }
  if (username.length < 3)  { toast('Username must be at least 3 characters', 'error'); return; }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) { toast('Username may only contain letters, numbers, _ . -', 'error'); return; }
  if (!name)                { toast('Please enter your full name', 'error'); return; }
  if (!gender || gender === '') { toast('Please select your gender', 'error'); return; }
  if (!email)               { toast('Please enter your email address', 'error'); return; }
  if (!_validEmail(email))  { toast('Enter a valid email address', 'error'); return; }
  if (!pass)                { toast('Please choose a password', 'error'); return; }
  if (pass.length < 8)      { toast('Password must be at least 8 characters', 'error'); return; }
  if (pass !== passConf)    { toast('Passwords do not match', 'error'); return; }
  // Phone is optional — validate format only if provided
  if (phone && !/^[+\d\s\-().]{7,20}$/.test(phone)) {
    toast('Enter a valid phone number', 'error'); return;
  }

  _saveSession({ username, name, email, gender, phone: phone || null });
  toast(`Account created! Welcome, ${username} 🎉`, 'success');
  closeAuth();
}
function _validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function _saveSession(user) {
  STATE.user = user;
  try { localStorage.setItem('cm_user', JSON.stringify(user)); } catch(e) {}
  updateAuthUI();
  updateStorageUI();
}
function signOut() {
  localStorage.removeItem('cm_user');
  STATE.user = null;
  updateAuthUI();
  updateStorageUI();
  toast('Signed out');
}
function updateAuthUI() {
  const label  = document.getElementById('authLabel');
  const avatar = document.getElementById('userAvatar');
  if (!label || !avatar) return;
  if (STATE.user) {
    label.textContent  = STATE.user.name.split(' ')[0];
    avatar.textContent = STATE.user.name[0].toUpperCase();
  } else {
    label.textContent  = 'Sign In';
    avatar.textContent = 'U';
  }
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
  const prefix = isInTools ? '../' : '';
  const routes = {
    home:      prefix + 'index.html',
    docs:      prefix + 'scanner.html',
    tools:     prefix + 'tools.html',
    settings:  prefix + 'settings.html',
    help:      prefix + 'help.html',
    favorites: prefix + 'tools.html',
    recent:    () => toast('Recent docs below ↓'),
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
  'img-to-pdf':    'tools/img-to-pdf.html',
  'pdf-to-img':    'tools/pdf-to-img.html',
  'merge':         'tools/merge-pdf.html',
  'split':         'tools/split-pdf.html',
  'compress':      'tools/compress.html',
  'img-compress':  'tools/compress.html',
  'ocr':           'tools/ocr.html',
  'age':           'tools/age-calc.html',
  'bmi':           'tools/bmi-calc.html',
  'discount':      'tools/discount-calc.html',
  'pdf-to-word':   'tools/pdf-to-word.html',
  'word-to-pdf':   'tools/word-to-pdf.html',
  /* ── New tools ── */
  'compress-pdf':  'tools/compress-pdf.html',
  'fill-sign':     'tools/fill-sign.html',
  'watermark':     'tools/watermark.html',
  'page-numbers':  'tools/page-numbers.html',
  'delete-pages':  'tools/delete-pages.html',
  'html-to-pdf':   'tools/html-to-pdf.html',
  'pdf-editor':    'tools/pdf-editor.html',
  'pdf-to-ppt':    'tools/pdf-to-ppt.html',
  'ppt-to-pdf':    'tools/ppt-to-pdf.html',
  'pdf-to-excel':  'tools/pdf-to-excel.html',
  'excel-to-pdf':  'tools/excel-to-pdf.html',
  'ai-summarize':  'tools/ai-summarize.html',
  'inheritance':   'tools/inheritance-calc.html',
  'warasat':       'tools/inheritance-calc.html',
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
  { id:'pdf-to-img',   name:'PDF to JPG',            desc:'Extract PDF pages as image files',             icon:'🖼️', category:'PDF Tools',   keywords:['extract','jpg','jpeg','image','page'] },
  { id:'merge',        name:'Merge PDF',             desc:'Combine multiple PDF files into one',          icon:'🔗', category:'PDF Tools',   keywords:['merge','combine','join','unite','two','multiple'] },
  { id:'split',        name:'Split PDF',             desc:'Divide PDF into separate files by page range', icon:'✂️', category:'PDF Tools',   keywords:['split','divide','separate','range','pages','cut'] },
  { id:'compress',     name:'Compress Image',        desc:'Reduce image file size — JPG, PNG, WEBP',      icon:'🗜️', category:'Image Tools', keywords:['compress','reduce','optimize','image','size','quality','jpg'] },
  { id:'compress-pdf', name:'Compress PDF',          desc:'Shrink PDF file size with quality tiers',      icon:'📉', category:'PDF Tools',   keywords:['compress','reduce','pdf','size','optimize','shrink','smaller'] },
  { id:'ocr',          name:'OCR Text',              desc:'Extract text from scanned images',             icon:'🔤', category:'PDF Tools',   keywords:['ocr','text','extract','recognize','scan','tesseract'] },
  { id:'pdf-to-word',  name:'PDF to Word',           desc:'Convert PDF to editable .doc document',        icon:'📝', category:'PDF Tools',   keywords:['word','doc','docx','convert','editable','text'] },
  { id:'word-to-pdf',  name:'Word to PDF',           desc:'Convert DOCX/DOC to PDF format',               icon:'📄', category:'PDF Tools',   keywords:['word','docx','doc','convert','microsoft'] },
  { id:'fill-sign',    name:'Fill & Sign PDF',       desc:'Add text blocks and signatures to any PDF',    icon:'✍️', category:'PDF Tools',   keywords:['sign','signature','fill','form','annotate','draw','ink'] },
  { id:'watermark',    name:'Watermark PDF',         desc:'Stamp text or image watermarks on all pages',  icon:'💧', category:'PDF Tools',   keywords:['watermark','stamp','brand','overlay','logo','copyright'] },
  { id:'page-numbers', name:'Add Page Numbers',      desc:'Auto-number PDF pages at custom positions',    icon:'🔢', category:'PDF Tools',   keywords:['page numbers','numbering','header','footer','pagination'] },
  { id:'delete-pages', name:'Delete PDF Pages',      desc:'Remove specific pages from a PDF file',        icon:'🗑️', category:'PDF Tools',   keywords:['delete','remove','pages','trim','exclude','specific'] },
  { id:'html-to-pdf',  name:'HTML to PDF',           desc:'Convert URL or raw HTML/CSS to a PDF file',    icon:'🌐', category:'PDF Tools',   keywords:['html','url','web','page','convert','website','css'] },
  { id:'pdf-editor',   name:'PDF Editor',            desc:'Edit text, images and objects inside PDFs',    icon:'✏️', category:'PDF Tools',   keywords:['edit','text','modify','annotate','interactive','editor'] },
  { id:'pdf-to-ppt',   name:'PDF to PowerPoint',     desc:'Convert PDF pages to editable PPTX slides',   icon:'📊', category:'PDF Tools',   keywords:['powerpoint','ppt','pptx','slides','presentation','office'] },
  { id:'ppt-to-pdf',   name:'PowerPoint to PDF',     desc:'Convert PPTX presentation to PDF output',     icon:'🎯', category:'PDF Tools',   keywords:['powerpoint','ppt','pptx','slides','presentation'] },
  { id:'pdf-to-excel', name:'PDF to Excel',          desc:'Extract tables from PDF to XLSX spreadsheet', icon:'📋', category:'PDF Tools',   keywords:['excel','xlsx','xls','table','spreadsheet','data'] },
  { id:'excel-to-pdf', name:'Excel to PDF',          desc:'Convert XLSX spreadsheets to PDF format',     icon:'📋', category:'PDF Tools',   keywords:['excel','xlsx','spreadsheet','convert'] },
  { id:'ai-summarize', name:'AI Text Summarizer',    desc:'Instant AI-powered document summary',         icon:'🤖', category:'AI Tools',    keywords:['summary','summarize','ai','key points','brief','extract','nlp'] },
  { id:'age',          name:'Age Calculator',         desc:'Calculate exact age from any birthdate',       icon:'📅', category:'Calculators', keywords:['age','birthday','date','born','calculate','years','months'] },
  { id:'bmi',          name:'BMI Calculator',         desc:'Body mass index — metric & imperial',          icon:'⚖️', category:'Calculators', keywords:['bmi','body','weight','height','health','mass','index'] },
  { id:'discount',     name:'Discount Calculator',    desc:'Calculate discounts, savings, tax & GST',      icon:'🏷️', category:'Calculators', keywords:['discount','price','percent','tax','gst','sale','savings'] },
  { id:'inheritance', name:'Islamic Inheritance Calc', desc:'Warasat Intikal — Sharia estate distribution', icon:'☪️', category:'Calculators', keywords:['islamic','inheritance','warasat','intikal','sharia','quran','fara\'id','estate','muslim','mother','brother','sister'] },
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
  const isOpen = drawer.classList.contains('open');
  drawer.classList.toggle('open', !isOpen);
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
  }
}

/* ── MODAL ───────────────────────────────────────────────────── */
function initModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.addEventListener('click', e => { if (e.target === modal) closeAuth(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAuth();
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
if (!window.setLanguage) {
  window.setLanguage = function(code) {
    if (window.I18N) { window.I18N.setLanguage(code); return; }
    localStorage.setItem('cm_lang', code);
    initLangSelector();
    toast('Language set to: ' + code.toUpperCase());
  };
}

/* ── INIT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(STATE.theme);
  updateAuthUI();
  renderRecent();
  initSidebarNav();
  initSearch();
  initModal();
  initKeyboardShortcuts();
  renderNotificationBadge();
  updateStorageUI();
  // Auto-load i18n.js for full 8-language translation on all pages
  if (!window.I18N) {
    const _i18s = document.createElement('script');
    const _appRef = document.querySelector('script[src*="app.js"]');
    _i18s.src = _appRef ? _appRef.src.replace('app.js', 'i18n.js') : 'js/i18n.js';
    _i18s.onload = () => { if (window.I18N) window.I18N.initLangSelector(); };
    document.head.appendChild(_i18s);
  }
  initLangSelector();

  // Lazy load images
  if ('loading' in HTMLImageElement.prototype) {
    document.querySelectorAll('img:not([loading])').forEach(img => img.setAttribute('loading', 'lazy'));
  }

  console.log('%c CamMaster by PDFdukan ', 'background:#ff6333;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;');
});
