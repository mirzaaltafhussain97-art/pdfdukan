'use client';

/**
 * ForgotPasswordFlow.jsx
 *
 * Three-stage password-reset state machine:
 *   Stage 1 — Email input with real-time domain validation & disposable-email blocklist
 *   Stage 2 — 6-digit OTP grid (auto-advance, paste, backspace, countdown, resend)
 *   Stage 3 — New password + confirm with live strength indicator
 *   Stage 4 — Success screen
 *
 * API routes consumed (all secured server-side):
 *   POST /api/auth/forgot-password   { email }                    → sends OTP via Resend
 *   POST /api/auth/verify-otp        { email, code }              → validates code, returns resetToken
 *   POST /api/auth/reset-password    { email, token, password }   → persists new password
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './ForgotPasswordFlow.module.css';

/* ── Client-side disposable-email blocklist ──────────────────────────────
   Mirrors the server-side set so the UI gives instant feedback without
   a round-trip. The server also enforces this independently.            */
const BLOCKED_DOMAINS = new Set([
  'mailinator.com','tempmail.com','10minutemail.com','guerrillamail.com',
  'yopmail.com','throwam.com','sharklasers.com','guerrillamail.info',
  'spam4.me','trashmail.com','dispostable.com','spamgourmet.com',
  'fakeinbox.com','maildrop.cc','getairmail.com','discard.email',
  'spambog.com','tempr.email','harakirimail.com','temp-mail.org',
  'tempmail.net','throwaway.email','mailtemp.info','fakemailgenerator.com',
  'spamhereplease.com','getnada.com','mailnesia.com','tempm.com',
  'incognitomail.com','mailexpire.com','meltmail.com','tempalias.com',
  'tempinbox.com','temporaryemail.net','temporaryinbox.com',
  'trashmail.at','trashmail.io','trashmail.me','trashmail.xyz',
  'filzmail.com','mailnull.com','zzrgg.com','nwldx.com',
]);

/* ── Pure helpers ────────────────────────────────────────────────────── */

function isValidEmailFormat(email) {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email);
}

function isBlockedDomain(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  return BLOCKED_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

function getPasswordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '#333', pct: 0 };
  let score = 0;
  if (pw.length >= 8)         score++;
  if (pw.length >= 12)        score++;
  if (/[A-Z]/.test(pw))       score++;
  if (/[0-9]/.test(pw))       score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score: 1, label: 'Weak',   color: '#e53935', pct: 20  };
  if (score === 2) return { score: 2, label: 'Fair',   color: '#fb8c00', pct: 40  };
  if (score === 3) return { score: 3, label: 'Good',   color: '#fdd835', pct: 60  };
  if (score === 4) return { score: 4, label: 'Strong', color: '#43a047', pct: 80  };
  return              { score: 5, label: 'Great',  color: '#00897b', pct: 100 };
}

function formatSeconds(total) {
  const m   = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ── SVG icons (inline — no icon library dependency) ─────────────────── */

function IconCheck({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5.25" stroke={color} strokeWidth="1.2" />
      <path d="M3.5 6l2 2 3-3" stroke={color} strokeWidth="1.2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAlert({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5.25" stroke={color} strokeWidth="1.2" />
      <path d="M6 4v3M6 8.5h.01" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconBigAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
         style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Step indicator ───────────────────────────────────────────────────── */

function StepIndicator({ current }) {
  const labels = ['Email', 'Verify', 'Reset'];
  return (
    <div className={styles.steps}>
      {labels.map((label, i) => {
        const n       = i + 1;
        const isDone  = n < current;
        const isActive = n === current;
        return (
          <div key={n} className={styles.stepItem}>
            {i > 0 && (
              <div className={`${styles.stepConnector} ${isDone ? styles.done : ''}`} />
            )}
            <div className={
              `${styles.stepDot} ${isDone ? styles.done : ''} ${isActive ? styles.active : ''}`
            }>
              {isDone
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                : n}
            </div>
            <span className={
              `${styles.stepLabel} ${isDone ? styles.done : ''} ${isActive ? styles.active : ''}`
            }>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── API error banner ─────────────────────────────────────────────────── */

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className={styles.errorBanner} role="alert">
      <IconBigAlert />
      {message}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STAGE 1 — Email entry
   Validates format + blocklist in real-time (no network call).
   Submits to /api/auth/forgot-password on form submit.
═══════════════════════════════════════════════════════════════ */

function Stage1Email({ onSuccess }) {
  const [email,     setEmail]     = useState('');
  /* validity: 'idle' | 'valid' | 'invalid' | 'blocked' */
  const [validity,  setValidity]  = useState('idle');
  const [feedback,  setFeedback]  = useState('');
  const [apiError,  setApiError]  = useState('');
  const [loading,   setLoading]   = useState(false);

  const validate = useCallback((val) => {
    const t = val.trim();
    if (!t)                      { setValidity('idle');    setFeedback('');                                           return; }
    if (!isValidEmailFormat(t))  { setValidity('invalid'); setFeedback('Please enter a valid email address.');        return; }
    if (isBlockedDomain(t))      { setValidity('blocked'); setFeedback('Temporary or disposable email services are not permitted. Please use your real email address.'); return; }
    setValidity('valid');
    setFeedback('Email address looks good.');
  }, []);

  function handleChange(e) {
    const v = e.target.value;
    setEmail(v);
    setApiError('');
    validate(v);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (validity !== 'valid') return;
    setLoading(true);
    setApiError('');
    try {
      const res  = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!data.success) { setApiError(data.message || 'Something went wrong.'); return; }
      onSuccess(email.trim(), data.expiresInMinutes ?? 10);
    } catch {
      setApiError('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputCls = [
    styles.fieldInput,
    validity === 'valid'                               ? styles.valid   : '',
    validity === 'invalid' || validity === 'blocked'   ? styles.invalid : '',
  ].filter(Boolean).join(' ');

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className={styles.stageTitle}>Forgot your password?</h2>
      <p className={styles.stageSub}>
        Enter your account email and we&apos;ll send a 6-digit verification code.
      </p>

      <ErrorBanner message={apiError} />

      <div className={styles.fieldWrap}>
        <label className={styles.fieldLabel} htmlFor="fp-email">Email Address</label>
        <input
          id="fp-email"
          type="email"
          autoComplete="email"
          autoFocus
          disabled={loading}
          placeholder="you@example.com"
          value={email}
          onChange={handleChange}
          className={inputCls}
          aria-describedby="fp-email-fb"
        />

        {/* In-field status icon */}
        {validity === 'valid' && (
          <svg className={styles.fieldIcon} viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="8" fill="#4caf50" />
            <path d="M5 9l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {(validity === 'invalid' || validity === 'blocked') && (
          <svg className={styles.fieldIcon} viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="8" fill="#e53935" />
            <path d="M6 6l6 6M12 6l-6 6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}

        {feedback && (
          <div
            id="fp-email-fb"
            className={`${styles.fieldFeedback} ${validity === 'valid' ? styles.success : styles.error}`}
          >
            {validity === 'valid'
              ? <IconCheck color="#4caf50" />
              : <IconAlert color="#ef5350" />}
            {feedback}
          </div>
        )}
      </div>

      <button
        type="submit"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={loading || validity !== 'valid'}
      >
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        {loading ? 'Sending code…' : 'Send Verification Code'}
      </button>

      <a
        href={`${process.env.NEXT_PUBLIC_BASE_URL ?? '/'}`}
        className={styles.backLink}
      >
        ← Back to sign in
      </a>
    </form>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STAGE 2 — OTP entry
   6 individual digit cells. Features:
   • Auto-advance on digit input
   • Backspace moves to previous cell
   • Paste splits digits across all cells
   • Countdown timer with expired state
   • Resend button with 60-second cooldown
   • Auto-submit when all 6 cells are filled
═══════════════════════════════════════════════════════════════ */

const OTP_LEN         = 6;
const RESEND_COOLDOWN = 60;

function Stage2OTP({ email, expiryMinutes, onSuccess, onBack }) {
  const [digits,   setDigits]   = useState(Array(OTP_LEN).fill(''));
  const [otpState, setOtpState] = useState('idle');   /* 'idle' | 'success' | 'error' */
  const [apiError, setApiError] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [timeLeft, setTimeLeft] = useState(expiryMinutes * 60);
  const [resendCD, setResendCD] = useState(RESEND_COOLDOWN);
  const [resending,setResending]= useState(false);
  const refs = useRef([]);

  /* Countdown timers */
  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timeLeft]);

  useEffect(() => {
    if (resendCD <= 0) return;
    const id = setInterval(() => setResendCD(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [resendCD]);

  /* Focus first cell on mount */
  useEffect(() => { refs.current[0]?.focus(); }, []);

  /* Called after every digit change and on submit button click */
  const submitCode = useCallback(async (code) => {
    if (loading) return;
    setLoading(true);
    setApiError('');
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        /* Backend reads `code` (not `otp`) — keep field names aligned */
        body:    JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!data.success) {
        setOtpState('error');
        setApiError(data.message || 'Incorrect code. Please try again.');
        /* Clear all cells and refocus first */
        setDigits(Array(OTP_LEN).fill(''));
        setTimeout(() => refs.current[0]?.focus(), 50);
        return;
      }
      setOtpState('success');
      onSuccess(data.resetToken);
    } catch {
      setOtpState('error');
      setApiError('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [email, loading, onSuccess]);

  function handleCellChange(idx, raw) {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next  = [...digits];
    next[idx]   = digit;
    setDigits(next);
    setApiError('');
    setOtpState('idle');

    if (digit && idx < OTP_LEN - 1) refs.current[idx + 1]?.focus();

    /* Auto-submit when last cell is filled */
    if (digit && next.every(d => d !== '')) submitCode(next.join(''));
  }

  function handleKeyDown(idx, e) {
    if (e.key === 'Backspace') {
      if (digits[idx] === '' && idx > 0) {
        refs.current[idx - 1]?.focus();
      } else {
        const next = [...digits]; next[idx] = ''; setDigits(next);
      }
    }
    if (e.key === 'ArrowLeft'  && idx > 0)           refs.current[idx - 1]?.focus();
    if (e.key === 'ArrowRight' && idx < OTP_LEN - 1) refs.current[idx + 1]?.focus();
  }

  function handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const src  = text.replace(/\D/g, '').slice(0, OTP_LEN).split('');
    if (!src.length) return;
    const next = [...digits];
    src.forEach((d, i) => { next[i] = d; });
    setDigits(next);
    const focusIdx = Math.min(src.length, OTP_LEN - 1);
    refs.current[focusIdx]?.focus();
    if (next.every(d => d !== '')) submitCode(next.join(''));
  }

  async function handleResend() {
    if (resendCD > 0 || resending) return;
    setResending(true);
    setApiError('');
    setDigits(Array(OTP_LEN).fill(''));
    setOtpState('idle');
    try {
      const res  = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setTimeLeft((data.expiresInMinutes ?? expiryMinutes) * 60);
        setResendCD(RESEND_COOLDOWN);
        setTimeout(() => refs.current[0]?.focus(), 50);
      } else {
        setApiError(data.message || 'Could not resend code. Please try again.');
      }
    } catch {
      setApiError('Network error — please try again.');
    } finally {
      setResending(false);
    }
  }

  const allFilled = digits.every(d => d !== '');
  const expired   = timeLeft <= 0;

  return (
    <div>
      <h2 className={styles.stageTitle}>Enter verification code</h2>
      <p className={styles.stageSub}>
        We sent a 6-digit code to{' '}
        <span className={styles.emailHighlight}>{email}</span>.
        {expired && ' The code has expired — please request a new one.'}
      </p>

      <ErrorBanner message={apiError} />

      {/* 6-cell OTP grid */}
      <div className={styles.otpGrid} onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            disabled={loading || expired}
            aria-label={`Digit ${i + 1} of ${OTP_LEN}`}
            onChange={e => handleCellChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            className={[
              styles.otpCell,
              d                         ? styles.filled  : '',
              otpState === 'error'      ? styles.error   : '',
              otpState === 'success'    ? styles.success : '',
            ].filter(Boolean).join(' ')}
          />
        ))}
      </div>

      {/* Timer + resend */}
      <div className={styles.timerRow}>
        {expired
          ? <span className={styles.timerExpired}>Code expired</span>
          : <span className={styles.timerText}>
              Expires in <span className={styles.timerValue}>{formatSeconds(timeLeft)}</span>
            </span>
        }
        <button
          type="button"
          className={styles.resendBtn}
          onClick={handleResend}
          disabled={resendCD > 0 || resending}
        >
          {resending ? 'Sending…' : resendCD > 0 ? `Resend in ${resendCD}s` : 'Resend code'}
        </button>
      </div>

      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={loading || !allFilled || expired}
        onClick={() => submitCode(digits.join(''))}
      >
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        {loading ? 'Verifying…' : 'Verify Code'}
      </button>

      <button type="button" className={styles.backLink} onClick={onBack}>
        ← Use a different email address
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STAGE 3 — New password
   Live strength bar, show/hide toggles, match validation.
═══════════════════════════════════════════════════════════════ */

function Stage3Reset({ email, resetToken, onSuccess }) {
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [matchError,  setMatchError]  = useState('');
  const [apiError,    setApiError]    = useState('');
  const [loading,     setLoading]     = useState(false);

  const strength = getPasswordStrength(newPw);

  function handleConfirmChange(val) {
    setConfirmPw(val);
    setMatchError(val && newPw && val !== newPw ? 'Passwords do not match.' : '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!newPw || !confirmPw) return;
    if (newPw !== confirmPw) { setMatchError('Passwords do not match.'); return; }
    if (strength.score < 2)  { setApiError('Password is too weak. Please choose a stronger one.'); return; }

    setLoading(true);
    setApiError('');
    try {
      const res  = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        /* Backend reads `token` and `password` — keep field names aligned.
           Confirm-match is already enforced client-side above. */
        body:    JSON.stringify({ email, token: resetToken, password: newPw }),
      });
      const data = await res.json();
      if (!data.success) { setApiError(data.message || 'Could not reset password. Please try again.'); return; }
      onSuccess();
    } catch {
      setApiError('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = newPw.length >= 8 && confirmPw === newPw && strength.score >= 2 && !loading;

  const EyeIcon = ({ show }) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      {show
        ? <>
            <path d="M1 9s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
          </>
        : <>
            <path d="M1 9s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="2" y1="2" x2="16" y2="16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </>
      }
    </svg>
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className={styles.stageTitle}>Set a new password</h2>
      <p className={styles.stageSub}>
        Choose a strong password for{' '}
        <span className={styles.emailHighlight}>{email}</span>.
      </p>

      <ErrorBanner message={apiError} />

      {/* New password field */}
      <div className={styles.fieldWrap} style={{ marginBottom: 4 }}>
        <label className={styles.fieldLabel} htmlFor="fp-new">New Password</label>
        <div style={{ position: 'relative' }}>
          <input
            id="fp-new"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            disabled={loading}
            placeholder="Minimum 8 characters"
            value={newPw}
            onChange={e => { setNewPw(e.target.value); setApiError(''); }}
            className={`${styles.fieldInput} ${newPw && strength.score >= 2 ? styles.valid : ''}`}
            style={{ paddingRight: 38 }}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowNew(v => !v)}
            aria-label={showNew ? 'Hide password' : 'Show password'}
            style={{
              position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
              background:'none', border:'none', cursor:'pointer', color:'#888', padding:2,
              display:'flex', alignItems:'center',
            }}
          >
            <EyeIcon show={showNew} />
          </button>
        </div>
      </div>

      {/* Strength bar */}
      {newPw && (
        <div className={styles.strengthWrap}>
          <div className={styles.strengthBar}>
            <div
              className={styles.strengthFill}
              style={{ width: `${strength.pct}%`, backgroundColor: strength.color }}
            />
          </div>
          <span className={styles.strengthLabel} style={{ color: strength.color }}>
            {strength.label}
          </span>
        </div>
      )}

      {/* Confirm password field */}
      <div className={styles.fieldWrap}>
        <label className={styles.fieldLabel} htmlFor="fp-confirm">Confirm Password</label>
        <div style={{ position: 'relative' }}>
          <input
            id="fp-confirm"
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            disabled={loading}
            placeholder="Repeat your new password"
            value={confirmPw}
            onChange={e => { handleConfirmChange(e.target.value); setApiError(''); }}
            className={[
              styles.fieldInput,
              confirmPw && !matchError  ? styles.valid   : '',
              matchError                ? styles.invalid : '',
            ].filter(Boolean).join(' ')}
            style={{ paddingRight: 38 }}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowConfirm(v => !v)}
            aria-label={showConfirm ? 'Hide password' : 'Show password'}
            style={{
              position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
              background:'none', border:'none', cursor:'pointer', color:'#888', padding:2,
              display:'flex', alignItems:'center',
            }}
          >
            <EyeIcon show={showConfirm} />
          </button>
        </div>
        {matchError && (
          <div className={`${styles.fieldFeedback} ${styles.error}`}>
            <IconAlert color="#ef5350" />
            {matchError}
          </div>
        )}
      </div>

      <button
        type="submit"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={!canSubmit}
      >
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        {loading ? 'Updating password…' : 'Reset Password'}
      </button>
    </form>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STAGE 4 — Success
═══════════════════════════════════════════════════════════════ */

function SuccessScreen() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  return (
    <div className={styles.successWrap}>
      <div className={styles.successIcon} role="img" aria-label="Password updated successfully">
        <svg viewBox="0 0 32 32" fill="none" width="34" height="34"
             stroke="#4caf50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 17l8 8 14-14" />
        </svg>
      </div>
      <h2 className={styles.successTitle}>Password updated!</h2>
      <p className={styles.successBody}>
        Your password has been changed successfully.
        You can now sign in with your new credentials.
      </p>
      <a
        href={`${base}/`}
        className={`${styles.btn} ${styles.btnPrimary}`}
        style={{ textDecoration: 'none', justifyContent: 'center' }}
      >
        Go to sign in →
      </a>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ROOT COMPONENT
   Owns the stage state and passes down only what each stage needs.
═══════════════════════════════════════════════════════════════ */

export default function ForgotPasswordFlow() {
  const [stage,      setStage]      = useState(1);
  const [email,      setEmail]      = useState('');
  const [expiry,     setExpiry]     = useState(10);
  const [resetToken, setResetToken] = useState('');

  function handleEmail(verifiedEmail, expiryMins) {
    setEmail(verifiedEmail);
    setExpiry(expiryMins);
    setStage(2);
  }

  function handleOTP(token) {
    setResetToken(token);
    setStage(3);
  }

  function handleReset() {
    setStage(4);
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>

        {/* Branded header */}
        <div className={styles.logoBar}>
          <a href={process.env.NEXT_PUBLIC_BASE_URL ?? '/'} className={styles.logoLink}>
            <h1 className={styles.logoTitle}>PDFdukan</h1>
            <p className={styles.logoSub}>CamMaster Document Tools</p>
          </a>
        </div>

        {/* Step indicator — hidden on success screen */}
        {stage <= 3 && <StepIndicator current={stage} />}

        {/* Stage body */}
        <div className={styles.body}>
          {stage === 1 && (
            <Stage1Email onSuccess={handleEmail} />
          )}

          {stage === 2 && (
            <Stage2OTP
              email={email}
              expiryMinutes={expiry}
              onSuccess={handleOTP}
              onBack={() => setStage(1)}
            />
          )}

          {stage === 3 && (
            <Stage3Reset
              email={email}
              resetToken={resetToken}
              onSuccess={handleReset}
            />
          )}

          {stage === 4 && <SuccessScreen />}
        </div>

      </div>
    </main>
  );
}
