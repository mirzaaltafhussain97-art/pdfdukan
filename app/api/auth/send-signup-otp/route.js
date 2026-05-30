import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { otpStore } from '../../../../lib/otpStore';

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES ?? '10', 10);
const RESEND_THROTTLE_MS = 30 * 1000;

const BLOCKED_DOMAINS = new Set([
  'mailinator.com','tempmail.com','10minutemail.com','guerrillamail.com',
  'yopmail.com','throwam.com','sharklasers.com','guerrillamail.info',
  'spam4.me','trashmail.com','dispostable.com','fakeinbox.com',
  'maildrop.cc','temp-mail.org','tempmail.net','throwaway.email',
  'trashmail.at','trashmail.io','trashmail.me','trashmail.xyz',
]);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isDisposable(email) {
  const at = email.lastIndexOf('@');
  return at === -1 || BLOCKED_DOMAINS.has(email.slice(at + 1).toLowerCase());
}
function generateOTP() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

function buildHTML(otp, mins) {
  const yr = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:36px 16px;">
<tr><td align="center">
  <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0;">
    <tr><td style="background:linear-gradient(135deg,#ff6333,#ff9055);padding:28px 36px;text-align:center;">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px;">PDFdukan</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:12px;">CamMaster — Document Tools</p>
    </td></tr>
    <tr><td style="padding:32px 36px;">
      <h2 style="margin:0 0 10px;color:#1a1a1a;font-size:19px;font-weight:700;">Verify your email address</h2>
      <p style="margin:0 0 22px;color:#555;font-size:14px;line-height:1.6;">Use the code below to complete your registration. It expires in <strong>${mins} minutes</strong>.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td align="center">
          <div style="display:inline-block;background:#fff8f5;border:2px solid #ff6333;border-radius:10px;padding:18px 40px;text-align:center;">
            <p style="margin:0 0 5px;color:#999;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;">Verification Code</p>
            <p style="margin:0;color:#ff6333;font-size:38px;font-weight:800;letter-spacing:10px;">${otp}</p>
          </div>
        </td></tr>
      </table>
      <p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.6;">Didn't create a PDFdukan account? You can safely ignore this email.</p>
      <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">Never share this code with anyone.</p>
    </td></tr>
    <tr><td style="background:#fafafa;padding:16px 36px;border-top:1px solid #eee;text-align:center;">
      <p style="margin:0;color:#bbb;font-size:11px;">&copy; ${yr} PDFdukan. All rights reserved.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function buildText(otp, mins) {
  return `PDFdukan — Email Verification\n\nYour verification code: ${otp}\n\nThis code expires in ${mins} minutes.\n\nIf you didn't create a PDFdukan account, ignore this email.\n\n© ${new Date().getFullYear()} PDFdukan`;
}

const STORE_PREFIX = 'su:';

export async function POST(request) {
  try {
    const body  = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();

    if (!email)              return NextResponse.json({ success: false, message: 'Email is required.' }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ success: false, message: 'Enter a valid email address.' }, { status: 400 });
    if (isDisposable(email)) return NextResponse.json({ success: false, message: 'Disposable email addresses are not allowed.' }, { status: 400 });

    const key = STORE_PREFIX + email;
    const existing = otpStore.get(key);

    if (existing?.lockedUntil && existing.lockedUntil > Date.now()) {
      const mins = Math.ceil((existing.lockedUntil - Date.now()) / 60_000);
      return NextResponse.json({ success: false, code: 'RATE_LIMITED', message: `Too many attempts. Wait ${mins} minute(s).` }, { status: 429 });
    }
    if (existing?.lastSentAt && Date.now() - existing.lastSentAt < RESEND_THROTTLE_MS) {
      const secs = Math.ceil((RESEND_THROTTLE_MS - (Date.now() - existing.lastSentAt)) / 1000);
      return NextResponse.json({ success: false, code: 'THROTTLED', message: `Wait ${secs} second(s) before requesting another code.` }, { status: 429 });
    }

    const otp = generateOTP();
    otpStore.set(key, { otp, expiresAt: Date.now() + OTP_EXPIRY_MINUTES * 60_000, attempts: 0, lockedUntil: null, lastSentAt: Date.now() });

    const resend    = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
    const fromName  = process.env.RESEND_FROM_NAME  ?? 'PDFdukan';
    const isTest    = fromEmail === 'onboarding@resend.dev';
    const redirect  = (process.env.RESEND_TEST_REDIRECT_TO ?? '').trim();
    const deliverTo = (isTest && redirect) ? redirect : email;

    const { error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to:   [deliverTo],
      subject: `${otp} is your PDFdukan code`,
      html: buildHTML(otp, OTP_EXPIRY_MINUTES),
      text: buildText(otp, OTP_EXPIRY_MINUTES),
    });

    if (error) {
      otpStore.delete(key);
      return NextResponse.json({ success: false, message: error.message || 'Failed to send email.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: `Code sent to ${email}.`, expiresInMinutes: OTP_EXPIRY_MINUTES }, { status: 200 });
  } catch (err) {
    console.error('[send-signup-otp]', err);
    return NextResponse.json({ success: false, message: 'Unexpected error.' }, { status: 500 });
  }
}
