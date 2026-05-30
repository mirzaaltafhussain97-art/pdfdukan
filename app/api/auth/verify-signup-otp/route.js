import { NextResponse } from 'next/server';
import { otpStore } from '../../../../lib/otpStore';

const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 30 * 60 * 1000;
const STORE_PREFIX  = 'su:';

export async function POST(request) {
  try {
    const body  = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const code  = String(body.code  ?? '').trim();

    if (!email || !code) {
      return NextResponse.json({ success: false, message: 'Email and code are required.' }, { status: 400 });
    }

    const key    = STORE_PREFIX + email;
    const record = otpStore.get(key);

    if (!record) {
      return NextResponse.json({ success: false, message: 'Code not found or expired. Please request a new one.' }, { status: 400 });
    }
    if (record.lockedUntil && record.lockedUntil > Date.now()) {
      const mins = Math.ceil((record.lockedUntil - Date.now()) / 60_000);
      return NextResponse.json({ success: false, code: 'RATE_LIMITED', message: `Too many attempts. Locked for ${mins} more minute(s).` }, { status: 429 });
    }
    if (record.expiresAt < Date.now()) {
      otpStore.delete(key);
      return NextResponse.json({ success: false, message: 'Code has expired. Please request a new one.' }, { status: 400 });
    }
    if (record.otp !== code) {
      record.attempts += 1;
      if (record.attempts >= MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + LOCKOUT_MS;
        otpStore.set(key, record);
        return NextResponse.json({ success: false, code: 'RATE_LIMITED', message: 'Too many wrong attempts. Locked for 30 minutes.' }, { status: 429 });
      }
      otpStore.set(key, record);
      const left = MAX_ATTEMPTS - record.attempts;
      return NextResponse.json({ success: false, message: `Wrong code — ${left} attempt${left !== 1 ? 's' : ''} remaining.` }, { status: 400 });
    }

    otpStore.delete(key);
    return NextResponse.json({ success: true, message: 'Email verified successfully.' }, { status: 200 });
  } catch (err) {
    console.error('[verify-signup-otp]', err);
    return NextResponse.json({ success: false, message: 'Unexpected error.' }, { status: 500 });
  }
}
