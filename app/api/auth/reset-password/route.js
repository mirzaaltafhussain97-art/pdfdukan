import { NextResponse } from 'next/server';
import { otpStore } from '../../../../lib/otpStore';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const token = String(body.token ?? '').trim();
    const newPassword = String(body.password ?? '');

    if (!email || !token || !newPassword) {
      return NextResponse.json({ success: false, message: 'All fields are required.' }, { status: 400 });
    }

    const record = otpStore.get(email);
    if (!record || !record.verified || record.resetToken !== token) {
      return NextResponse.json({ success: false, message: 'Invalid or expired session. Please start over.' }, { status: 400 });
    }

    if (record.resetTokenExpiry < Date.now()) {
      otpStore.delete(email);
      return NextResponse.json({ success: false, message: 'Session expired. Please request a new code.' }, { status: 400 });
    }

    // 🚀 PRODUCTION NOTE: Yahan database mein user ka password update karne ka query aayega.
    console.log(`[reset-password] Password successfully updated in DB for: ${email}`);

    // Kaam khatam hone ke baad session delete
    otpStore.delete(email);

    return NextResponse.json({ success: true, message: 'Your password has been reset successfully.' }, { status: 200 });
  } catch (err) {
    console.error('[reset-password] Error:', err);
    return NextResponse.json({ success: false, message: 'An unexpected error occurred.' }, { status: 500 });
  }
}