/* ============================================================
   PDFdukan — Gemini client config
   Talks to our PHP proxy (api/gemini.php) so the API key stays
   on the server, never in this file or the repo.
   ============================================================ */

/* Resolve the proxy URL whether we are at site root or in /tools/ */
const GEMINI_PROXY = (location.pathname.includes('/tools/') ? '../' : '') + 'api/gemini.php';

/* ── Rate limiter (Part 0.2): 10 calls / minute ── */
const RATE_LIMIT = { maxCalls: 10, windowMs: 60000, calls: [] };
function checkRateLimit() {
  const now = Date.now();
  RATE_LIMIT.calls = RATE_LIMIT.calls.filter(t => now - t < RATE_LIMIT.windowMs);
  if (RATE_LIMIT.calls.length >= RATE_LIMIT.maxCalls) {
    throw new Error('Too many requests. Please wait a minute and try again.');
  }
  RATE_LIMIT.calls.push(now);
}

/* ── Core call: prompt (+ optional file) → text ── */
async function callGemini(prompt, opts = {}) {
  checkRateLimit();
  const payload = { prompt: String(prompt || ''), maxTokens: opts.maxTokens || 2048 };
  if (opts.fileData && opts.mimeType) {
    payload.fileData = opts.fileData;
    payload.mimeType = opts.mimeType;
  }
  const res = await fetch(GEMINI_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Server returned an invalid response.'); }
  if (!res.ok || data.error) {
    throw new Error(data.error || ('Request failed (' + res.status + ')'));
  }
  return data.text || '';
}

/* ── Helpers ── */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]); // strip data: prefix
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function setButtonLoading(btn, loading, idleText) {
  if (!btn) return;
  if (loading) { btn.dataset._t = btn.textContent; btn.disabled = true; btn.textContent = 'Working…'; }
  else { btn.disabled = false; btn.textContent = idleText || btn.dataset._t || 'Go'; }
}
function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'output.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/* Falls back to a local escape if app.js sanitizeInput isn't present */
function aiSanitize(str) {
  if (window.sanitizeInput) return window.sanitizeInput(str);
  const d = document.createElement('div'); d.appendChild(document.createTextNode(String(str == null ? '' : str))); return d.innerHTML;
}

window.callGemini = callGemini;
window.checkRateLimit = checkRateLimit;
window.fileToBase64 = fileToBase64;
window.setButtonLoading = setButtonLoading;
window.downloadText = downloadText;
window.aiSanitize = aiSanitize;
