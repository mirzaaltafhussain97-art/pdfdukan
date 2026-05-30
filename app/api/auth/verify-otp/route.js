import { NextResponse } from 'next/server';
import { otpStore } from '../../../../lib/otpStore';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;
const TOKEN_EXPIRY_MINUTES = 15;

function generateResetToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const code = String(body.code ?? '').trim();

    if (!email || !code) {
      return NextResponse.json({ success: false, message: 'Email and verification code are required.' }, { status: 400 });
    }

    const record = otpStore.get(email);
    if (!record) {
      return NextResponse.json({ success: false, message: 'Invalid request or verification code has expired.' }, { status: 400 });
    }

    if (record.lockedUntil && record.lockedUntil > Date.now()) {
      const mins = Math.ceil((record.lockedUntil - Date.now()) / 60_000);
      return NextResponse.json({ success: false, code: 'RATE_LIMITED', message: `Too many failed attempts. Please wait ${mins} minutes.` }, { status: 429 });
    }

    if (record.expiresAt < Date.now()) {
      otpStore.delete(email);
      return NextResponse.json({ success: false, message: 'The verification code has expired.' }, { status: 400 });
    }

    if (record.otp !== code) {
      record.attempts += 1;
      if (record.attempts >= MAX_FAILED_ATTEMPTS) {
        record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        otpStore.set(email, record);
        return NextResponse.json({ success: false, code: 'RATE_LIMITED', message: 'Too many incorrect attempts. Locked for 30 minutes.' }, { status: 429 });
      }
      otpStore.set(email, record);
      return NextResponse.json({ success: false, message: `Incorrect code. ${MAX_FAILED_ATTEMPTS - record.attempts} attempts remaining.` }, { status: 400 });
    }

    const resetToken = generateResetToken();
    const resetTokenExpiry = Date.now() + TOKEN_EXPIRY_MINUTES * 60_000;

    otpStore.set(email, { ...record, verified: true, resetToken, resetTokenExpiry });

    return NextResponse.json({ success: true, message: 'Email verification successful.', resetToken }, { status: 200 });
  } catch (err) {
    console.error('[verify-otp] Error:', err);
    return NextResponse.json({ success: false, message: 'An unexpected error occurred.' }, { status: 500 });
  }
}