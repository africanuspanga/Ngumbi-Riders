import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

/*
 * Server-only PIN → Supabase-password transformation (spec §7.2 step 4).
 *
 * The raw four-digit PIN never leaves the server and is never sent to Supabase.
 * Instead the actual Supabase password is a keyed HMAC:
 *
 *   HMAC_SHA256(AUTH_PIN_PEPPER, canonical_phone + ':' + pin)
 *
 * Because the pepper is a server-only secret, an attacker who somehow reads the
 * Supabase auth table still cannot brute-force four digits offline without it.
 * The canonical phone is bound into the message so the same PIN on two accounts
 * derives different passwords.
 */
export function derivePassword(canonicalPhone: string, pin: string): string {
  const pepper = serverEnv().AUTH_PIN_PEPPER;
  return createHmac('sha256', pepper)
    .update(`${canonicalPhone}:${pin}`)
    .digest('hex');
}

/** Constant-time comparison for any internal derived-value checks. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
