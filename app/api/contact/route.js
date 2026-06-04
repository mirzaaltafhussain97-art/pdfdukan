import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// ─── Rate limiting (in-memory, resets on server restart) ─────────────────────
const _submissions = new Map(); // ip → { count, resetAt }
const RATE_LIMIT    = 3;        // max 3 submissions per window
const RATE_WINDOW   = 60 * 60 * 1000; // 1-hour window

function _checkRate(ip) {
  const now    = Date.now();
  const record = _submissions.get(ip);
  if (!record || record.resetAt < now) {
    _submissions.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count++;
  return true;
}

// ─── Email template (sent to site owner) ─────────────────────────────────────
function buildOwnerEmail(name, email, subject, message) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;width:100%;background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
        <tr>
          <td style="background:linear-gradient(135deg,#ff6333,#ff9055);padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;">✉️ New Contact Form Message</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">PDFdukan — CamMaster</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 0;border-bottom:1px solid #2a2a2a;">
                <span style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px">From</span><br>
                <span style="font-size:15px;color:#f0f0f0;font-weight:600">${escapeHtml(name)}</span>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #2a2a2a;">
                <span style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px">Email</span><br>
                <a href="mailto:${escapeHtml(email)}" style="font-size:15px;color:#ff6333;text-decoration:none;">${escapeHtml(email)}</a>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #2a2a2a;">
                <span style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px">Subject</span><br>
                <span style="font-size:15px;color:#f0f0f0;font-weight:600">${escapeHtml(subject)}</span>
              </td></tr>
              <tr><td style="padding:12px 0;">
                <span style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px">Message</span><br>
                <div style="margin-top:8px;padding:16px;background:#242424;border-radius:8px;font-size:14px;color:#ddd;line-height:1.7;white-space:pre-wrap">${escapeHtml(message)}</div>
              </td></tr>
            </table>
            <a href="mailto:${escapeHtml(email)}?subject=Re: ${encodeURIComponent('[CamMaster] ' + subject)}"
               style="display:inline-block;margin-top:20px;padding:11px 24px;background:#ff6333;color:#fff;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">
              Reply to ${escapeHtml(name)} →
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#111;padding:16px 32px;border-top:1px solid #2a2a2a;text-align:center;">
            <p style="margin:0;color:#555;font-size:12px;">© ${year} PDFdukan &middot; <a href="https://pdfdukan.com" style="color:#888;text-decoration:none;">pdfdukan.com</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Confirmation email (sent to the user who submitted) ─────────────────────
function buildConfirmationEmail(name) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;width:100%;background:#1a1a1a;border-radius:14px;overflow:hidden;border:1px solid #2a2a2a;">
        <tr>
          <td style="background:linear-gradient(135deg,#ff6333,#ff9055);padding:24px 32px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">PDFdukan</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">CamMaster Document Tools</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 12px;color:#f0f0f0;font-size:18px;font-weight:700;">✅ We received your message, ${escapeHtml(name)}!</h2>
            <p style="margin:0 0 16px;color:#aaa;font-size:14px;line-height:1.7;">
              Thank you for reaching out to PDFdukan support. We've received your message and will reply to this email address within <strong style="color:#f0f0f0;">24 hours</strong>.
            </p>
            <p style="margin:0 0 16px;color:#aaa;font-size:14px;line-height:1.7;">
              While you wait, you might find answers in our <a href="https://pdfdukan.com/help.html" style="color:#ff6333;text-decoration:underline;">Help &amp; FAQ Center</a>.
            </p>
            <div style="padding:14px 18px;background:#242424;border-radius:8px;border-left:3px solid #ff6333;margin-top:8px;">
              <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
                <strong style="color:#f0f0f0;">Tip:</strong> If your issue is urgent, you can also reach us directly at
                <a href="mailto:mirzaaltafhussain97@gmail.com" style="color:#ff6333;text-decoration:none;">mirzaaltafhussain97@gmail.com</a>
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#111;padding:16px 32px;border-top:1px solid #2a2a2a;text-align:center;">
            <p style="margin:0;color:#555;font-size:12px;">© ${year} PDFdukan &middot; <a href="https://pdfdukan.com" style="color:#888;text-decoration:none;">pdfdukan.com</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── POST /api/contact ────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    // Basic rate limiting by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
             || request.headers.get('x-real-ip')
             || 'unknown';
    if (!_checkRate(ip)) {
      return NextResponse.json(
        { success: false, message: 'Too many submissions. Please wait an hour before trying again.' },
        { status: 429 }
      );
    }

    const body    = await request.json().catch(() => ({}));
    const name    = String(body.name    ?? '').trim();
    const email   = String(body.email   ?? '').trim();
    const subject = String(body.subject ?? '').trim();
    const message = String(body.message ?? '').trim();

    // Validation
    if (!name || !email || !subject || !message) {
      return NextResponse.json({ success: false, message: 'All fields are required.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, message: 'Enter a valid email address.' }, { status: 400 });
    }
    if (message.length < 10) {
      return NextResponse.json({ success: false, message: 'Message is too short.' }, { status: 400 });
    }
    if (message.length > 5000) {
      return NextResponse.json({ success: false, message: 'Message is too long (max 5000 characters).' }, { status: 400 });
    }

    // If the email service isn't configured on this host (e.g. RESEND_API_KEY
    // not set in the deployment env), don't throw a 500 — return 503 so the
    // client falls back to Formspree and the message still gets delivered.
    const apiKey = (process.env.RESEND_API_KEY ?? '').trim();
    if (!apiKey) {
      console.warn('[contact] RESEND_API_KEY not configured — signalling client fallback (503).');
      return NextResponse.json(
        { success: false, message: 'Primary email service unavailable — using fallback.' },
        { status: 503 }
      );
    }

    const resend        = new Resend(apiKey);
    const fromEmail     = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
    const fromName      = process.env.RESEND_FROM_NAME  ?? 'PDFdukan';
    const from          = `${fromName} <${fromEmail}>`;
    const ownerEmail    = process.env.CONTACT_RECIPIENT_EMAIL ?? 'mirzaaltafhussain97@gmail.com';

    // Dev redirect: if using the shared Resend sender, deliver to owner's test address
    const isTestSender = fromEmail === 'onboarding@resend.dev';
    const redirectTo   = (process.env.RESEND_TEST_REDIRECT_TO ?? '').trim();
    const deliverTo    = (isTestSender && redirectTo) ? redirectTo : ownerEmail;

    // 1. Send message to site owner
    let ownerErr = null;
    try {
      ({ error: ownerErr } = await resend.emails.send({
        from,
        to:      [deliverTo],
        replyTo: email,
        subject: `[CamMaster Contact] ${subject} — from ${name}`,
        html:    buildOwnerEmail(name, email, subject, message),
      }));
    } catch (sendErr) {
      // SDK/network threw — fall back on the client (503) rather than dead-end.
      console.error('[contact] Resend send threw:', sendErr);
      return NextResponse.json(
        { success: false, message: 'Primary email service error — using fallback.' },
        { status: 503 }
      );
    }

    if (ownerErr) {
      console.error('[contact] Resend owner email error:', ownerErr);
      return NextResponse.json(
        { success: false, message: ownerErr.message || 'Failed to send message. Please try again.' },
        { status: 502 }
      );
    }

    // 2. Send confirmation to the user (best-effort, don't fail on error)
    const confirmTo = (isTestSender && redirectTo) ? redirectTo : email;
    resend.emails.send({
      from,
      to:      [confirmTo],
      subject: 'We received your message — PDFdukan',
      html:    buildConfirmationEmail(name),
    }).catch(err => console.warn('[contact] Confirmation email failed:', err));

    return NextResponse.json(
      { success: true, message: 'Your message has been sent successfully! We\'ll reply within 24 hours.' },
      { status: 200 }
    );

  } catch (err) {
    console.error('[contact] Unhandled error:', err);
    return NextResponse.json(
      { success: false, message: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
