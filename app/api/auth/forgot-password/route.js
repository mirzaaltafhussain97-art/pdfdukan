import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { otpStore } from '../../../../lib/otpStore';

// ─── Configuration ────────────────────────────────────────────────────────
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES ?? '10', 10);
const RESEND_THROTTLE_MS = 30 * 1000; // min gap between OTP emails for one address

// ─── Disposable / throwaway email domain blocklist ────────────────────────
// Kept in sync with the client-side list in ForgotPasswordFlow.jsx so both
// layers enforce the same policy independently.
const BLOCKED_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'yopmail.com', 'throwam.com', 'sharklasers.com', 'guerrillamail.info',
  'spam4.me', 'trashmail.com', 'dispostable.com', 'spamgourmet.com',
  'fakeinbox.com', 'maildrop.cc', 'getairmail.com', 'discard.email',
  'spambog.com', 'tempr.email', 'harakirimail.com', 'temp-mail.org',
  'tempmail.net', 'throwaway.email', 'mailtemp.info', 'fakemailgenerator.com',
  'spamhereplease.com', 'getnada.com', 'mailnesia.com', 'tempm.com',
  'incognitomail.com', 'mailexpire.com', 'meltmail.com', 'tempalias.com',
  'tempinbox.com', 'temporaryemail.net', 'temporaryinbox.com',
  'trashmail.at', 'trashmail.io', 'trashmail.me', 'trashmail.xyz',
  'filzmail.com', 'mailnull.com', 'zzrgg.com', 'nwldx.com',
]);

// ─── Helper: email format validation ─────────────────────────────────────
function isValidEmailFormat(email) {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email);
}

// ─── Helper: disposable domain check ─────────────────────────────────────
function isDisposableDomain(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return true;
  return BLOCKED_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

// ─── Helper: cryptographically random 6-digit OTP ────────────────────────
function generateOTP() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

// ─── Helper: professional OTP email template ─────────────────────────────
// `requestedFor` is only passed in dev test-redirect mode; when present it
// renders a small banner noting which address originally requested the code.
function buildEmailHTML(otp, expiryMinutes, requestedFor) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;width:100%;background:#1a1a1a;border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
        <tr>
          <td style="background:linear-gradient(135deg,#ff6333,#ff9055);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">PDFdukan</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-weight:500;">CamMaster Document Tools</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 12px;color:#f0f0f0;font-size:20px;font-weight:700;">Password Reset Request</h2>
            <p style="margin:0 0 18px;color:#aaa;font-size:15px;line-height:1.6;">
              We received a request to reset your password. Enter the verification code below to continue.
            </p>
            ${requestedFor ? `<p style="margin:0 0 22px;padding:10px 14px;background:#2a2118;border:1px solid #ff6333;border-radius:8px;color:#ffb38a;font-size:13px;line-height:1.5;">⚙️ <strong>Test mode:</strong> this code was requested for <strong>${requestedFor}</strong> and redirected to this inbox because no Resend domain is verified yet.</p>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td align="center">
                <div style="display:inline-block;background:#242424;border:2px solid #ff6333;border-radius:12px;padding:24px 48px;text-align:center;">
                  <p style="margin:0 0 8px;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:2px;font-weight:600;">Verification Code</p>
                  <p style="margin:0;color:#ff6333;font-size:44px;font-weight:800;letter-spacing:12px;">${otp}</p>
                </div>
              </td></tr>
            </table>
            <p style="margin:0 0 14px;color:#aaa;font-size:14px;line-height:1.6;">
              This code expires in <strong style="color:#f0f0f0;">${expiryMinutes} minutes</strong>.
              If you did not request a password reset, you can safely ignore this email.
            </p>
            <p style="margin:0;color:#666;font-size:13px;line-height:1.6;">
              For your security, never share this code with anyone.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#111;padding:20px 40px;border-top:1px solid #2a2a2a;text-align:center;">
            <p style="margin:0;color:#555;font-size:12px;line-height:1.6;">&copy; ${year} PDFdukan. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── POST /api/auth/forgot-password ──────────────────────────────────────
export async function POST(request) {
  try {
    const body  = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();

    // 1. Presence
    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Email address is required.' },
        { status: 400 }
      );
    }

    // 2. Format
    if (!isValidEmailFormat(email)) {
      return NextResponse.json(
        { success: false, message: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    // 3. Disposable-domain block
    if (isDisposableDomain(email)) {
      return NextResponse.json(
        {
          success: false,
          code: 'DISPOSABLE_EMAIL',
          message: 'Temporary or disposable email addresses are not permitted. Please use your real email address.',
        },
        { status: 400 }
      );
    }

    const existing = otpStore.get(email);

    // 4. Lockout — respect an active failed-attempt lock from verify-otp
    if (existing?.lockedUntil && existing.lockedUntil > Date.now()) {
      const mins = Math.ceil((existing.lockedUntil - Date.now()) / 60_000);
      return NextResponse.json(
        {
          success: false,
          code: 'RATE_LIMITED',
          message: `Too many requests. Please wait ${mins} minute${mins !== 1 ? 's' : ''} before trying again.`,
        },
        { status: 429 }
      );
    }

    // 5. Resend throttle — block OTP bombing (one email per 30s per address)
    if (existing?.lastSentAt && Date.now() - existing.lastSentAt < RESEND_THROTTLE_MS) {
      const secs = Math.ceil((RESEND_THROTTLE_MS - (Date.now() - existing.lastSentAt)) / 1000);
      return NextResponse.json(
        {
          success: false,
          code: 'THROTTLED',
          message: `Please wait ${secs} second${secs !== 1 ? 's' : ''} before requesting another code.`,
        },
        { status: 429 }
      );
    }

    // 6. Generate + persist OTP (shape consumed by verify-otp/route.js)
    const otp       = generateOTP();
    const expiresAt = Date.now() + OTP_EXPIRY_MINUTES * 60_000;
    otpStore.set(email, {
      otp,
      expiresAt,
      attempts: 0,
      lockedUntil: null,
      verified: false,
      resetToken: null,
      resetTokenExpiry: null,
      lastSentAt: Date.now(),
    });

    // 7. Send via Resend.
    //    Falls back to Resend's shared onboarding sender, which works without a
    //    verified domain — matches the working configuration in .env.local.
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
    const fromName  = process.env.RESEND_FROM_NAME ?? 'PDFdukan';
    const from      = `${fromName} <${fromEmail}>`;

    // ── DEV-ONLY TEST REDIRECT ───────────────────────────────────────────
    // Resend's shared `onboarding@resend.dev` sender can only deliver to the
    // account-owner address until a domain is verified. To keep the flow
    // testable with ANY typed email, when RESEND_TEST_REDIRECT_TO is set AND
    // we're still on the onboarding sender, deliver the email there instead.
    // The OTP stays keyed to the email the user actually typed (stored above),
    // so verify-otp still matches on that address. This auto-disables the
    // moment RESEND_FROM_EMAIL points at a verified domain — zero changes
    // needed for production.
    const isTestSender = fromEmail === 'onboarding@resend.dev';
    const redirectTo   = (process.env.RESEND_TEST_REDIRECT_TO ?? '').trim();
    const deliverTo    = (isTestSender && redirectTo) ? redirectTo : email;
    const redirected   = deliverTo.toLowerCase() !== email.toLowerCase();

    const { error: sendError } = await resend.emails.send({
      from,
      to: [deliverTo],
      subject: `${otp} is your PDFdukan verification code`,
      html: buildEmailHTML(otp, OTP_EXPIRY_MINUTES, redirected ? email : null),
    });

    if (sendError) {
      console.error('[forgot-password] Resend error:', sendError);
      otpStore.delete(email);
      // Surface the real provider reason so config issues (e.g. Resend's
      // test-mode "can only send to your own address until you verify a
      // domain" 403) are visible instead of a generic failure.
      const detail = sendError.message
        || 'The email service rejected the request. Please try again in a moment.';
      return NextResponse.json(
        { success: false, code: 'EMAIL_SEND_FAILED', message: detail },
        { status: 502 }
      );
    }

    // 8. Success. `expiresInMinutes` drives the client-side countdown timer.
    return NextResponse.json(
      {
        success: true,
        message: `A 6-digit verification code has been sent to ${email}.`,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[forgot-password] Unhandled error:', err);
    return NextResponse.json(
      { success: false, message: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
