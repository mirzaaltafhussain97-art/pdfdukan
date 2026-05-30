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

/* ── OTP FLOW STATE ──────────────────────────────────────────── */
let _pendingSignup = null;  // { username, gender, name, email, phone, pass }
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
      ? `${count} document${count !== 1 ? 's' : ''} in local history`
      : `${count} local doc${count !== 1 ? 's' : ''}`;
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

/* Kick off Firebase load immediately; everything awaits this promise. */
const _firebaseReady = (async function () {
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
  if (!(await _firebaseReady) || !_auth) { toast('Auth not ready — please retry', 'error'); return; }
  // Request Google Drive file access alongside sign-in
  _googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
  try {
    const result = await _fb.signInWithPopup(_auth, _googleProvider);
    // Capture Google access token for Drive API
    const credential = _fb.GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      try { localStorage.setItem('cm_gdrive_token', credential.accessToken); } catch(_) {}
    }
    closeAuth();
    toast('Signed in with Google ✓', 'success');
  } catch (e) { toast(_authErr(e), 'error'); }
}

async function signInEmail() {
  const email = document.getElementById('siEmail')?.value.trim();
  const pass  = document.getElementById('siPass')?.value;
  if (!email || !pass) { toast('Please fill in all fields', 'error'); return; }
  if (!_validEmail(email)) { toast('Enter a valid email address', 'error'); return; }
  if (!(await _firebaseReady) || !_auth) { toast('Auth not ready — please retry', 'error'); return; }
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
  const username = document.getElementById('suUsername')?.value.trim();
  const name     = document.getElementById('suName')?.value.trim();
  const email    = document.getElementById('suEmail')?.value.trim();
  const phone    = document.getElementById('suPhone')?.value.trim();   // optional
  const pass     = document.getElementById('suPass')?.value;
  const passConf = document.getElementById('suPassConf')?.value;

  // Validate required fields (same rules as before)
  if (!username)            { toast('Please enter a username', 'error'); return; }
  if (username.length < 3)  { toast('Username must be at least 3 characters', 'error'); return; }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) { toast('Username may only contain letters, numbers, _ . -', 'error'); return; }
  if (!name)                { toast('Please enter your full name', 'error'); return; }
  if (!email)               { toast('Please enter your email address', 'error'); return; }
  if (!_validEmail(email))  { toast('Enter a valid email address', 'error'); return; }
  if (!pass)                { toast('Please choose a password', 'error'); return; }
  if (pass.length < 8)      { toast('Password must be at least 8 characters', 'error'); return; }
  if (pass !== passConf)    { toast('Passwords do not match', 'error'); return; }
  if (phone && !/^[+\d\s\-().]{7,20}$/.test(phone)) {
    toast('Enter a valid phone number', 'error'); return;
  }

  // Store form data and send OTP — account is created only after OTP verified
  _pendingSignup = { username, name, email, phone, pass };
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
  const { username, name, email, phone, pass } = _pendingSignup;
  if (!(await _firebaseReady) || !_auth) { toast('Auth not ready', 'error'); return; }
  try {
    const cred = await _fb.createUserWithEmailAndPassword(_auth, email, pass);
    try { await _fb.updateProfile(cred.user, { displayName: name }); } catch(e) {}
    try { localStorage.setItem('cm_profile_extra', JSON.stringify({ username, gender, phone: phone || null })); } catch(e) {}
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
  if (await _firebaseReady && _auth) { try { await _fb.signOut(_auth); } catch (e) {} }
  STATE.user = null;
  try { localStorage.removeItem('cm_user'); } catch (e) {}
  updateAuthUI();
  if (typeof updateStorageUI === 'function') updateStorageUI();
  hideProfileMenu();
  toast('Signed out');
}

/* Re-send the verification email for the current user. */
async function resendVerification() {
  if (!(await _firebaseReady) || !_auth || !_auth.currentUser) return;
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
  if (!(await _firebaseReady) || !_auth || !_auth.currentUser) { toast('Not connected', 'error'); return; }
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
  if (!(await _firebaseReady) || !_auth) { toast('Auth not ready', 'error'); return; }
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
  // Block file selection via any <input type="file"> when logged out.
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'file' && !isLoggedIn()) {
      e.stopImmediatePropagation();
      e.preventDefault();
      try { t.value = ''; } catch (_) {}
      _gatePrompt();
    }
  }, true);
  // Block file drag-and-drop when logged out.
  document.addEventListener('drop', function (e) {
    if (!isLoggedIn() && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      e.stopImmediatePropagation();
      e.preventDefault();
      _gatePrompt();
    }
  }, true);
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
if (!window.setLanguage) {
  window.setLanguage = function(code) {
    if (window.I18N) { window.I18N.setLanguage(code); return; }
    localStorage.setItem('cm_lang', code);
    initLangSelector();
    toast('Language set to: ' + code.toUpperCase());
  };
}

/* ── COOKIE CONSENT BANNER ────────────────────────────────────── */
function _initCookieBanner() {
  if (localStorage.getItem('cm_cookie_consent') === '1') return;
  const p = window.location.pathname;
  const base = p.split('/').filter(Boolean).length > 1 ? '../' : '';
  const banner = document.createElement('div');
  banner.id = 'cmCookieBanner';
  banner.innerHTML =
    '<span class="ccb-text">We use cookies for basic functionality and to show relevant ads. ' +
    'By continuing, you agree to our <a href="' + base + 'cookies.html">Cookie Policy</a>.</span>' +
    '<div class="ccb-btns">' +
      '<a href="' + base + 'cookies.html" class="ccb-more">Learn More</a>' +
      '<button class="ccb-accept" onclick="_acceptCookies()">Accept</button>' +
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
    '.ccb-more{font-size:13px;color:var(--text-3,#888);padding:8px 14px;border-radius:7px;' +
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
}
window._acceptCookies = _acceptCookies;

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

  _initCookieBanner();
  console.log('%c CamMaster by PDFdukan ', 'background:#ff6333;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;');
});
