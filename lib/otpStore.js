/**
 * Shared in-memory OTP store.
 *
 * ── Why globalThis? ──────────────────────────────────────────────────────
 * A plain `export const otpStore = new Map()` is NOT safe in Next.js dev:
 * route handlers are compiled on demand and hot-reloaded, which re-evaluates
 * this module and throws away the Map. It can also be instantiated separately
 * for different route bundles. Either way, an OTP saved by /forgot-password is
 * missing when /verify-otp runs → "Invalid request or verification code has
 * expired." even though the code is correct.
 *
 * Pinning the Map to globalThis gives ONE instance for the whole Node process
 * that survives hot-reload and is shared across every route handler.
 *
 * ⚠️  PRODUCTION (multi-instance) NOTE
 * globalThis is per-process, so this still does not work across multiple
 * serverless instances (e.g. Vercel/Lambda with concurrency > 1). For that,
 * swap this module for a distributed store such as Upstash Redis or Vercel KV:
 *
 *   import { kv } from '@vercel/kv';
 *   // use kv.set / kv.get / kv.del instead of Map methods.
 *
 * Each entry shape:
 * {
 *   otp:              string,          // 6-digit code
 *   expiresAt:        number,          // Unix ms
 *   attempts:         number,          // failed verify attempts
 *   lockedUntil:      number | null,   // Unix ms lockout expiry
 *   verified:         boolean,         // true once OTP verified
 *   resetToken:       string | null,   // issued after verification
 *   resetTokenExpiry: number | null,   // Unix ms
 *   lastSentAt:       number,          // Unix ms of last OTP email (resend throttle)
 * }
 */

const globalForOtp = globalThis;

export const otpStore =
  globalForOtp.__pdfdukanOtpStore ?? (globalForOtp.__pdfdukanOtpStore = new Map());
