import { lastFourDigits } from './phone';

/*
 * Four-digit PIN validation (spec §7.3). Pure and secret-free so the login and
 * change-PIN forms can reuse the exact server rules for instant feedback. The
 * PIN itself is NEVER persisted or logged — it only ever feeds the server-side
 * HMAC derivation in ./pin-derive.ts.
 */

export const PIN_LENGTH = 4;

export type PinRejectionReason =
  | 'format' // not exactly four digits
  | 'repeated' // all identical, e.g. 1111
  | 'sequence' // ascending/descending run, e.g. 1234 / 4321
  | 'phone_suffix' // matches the last four digits of the phone
  | 'blocklisted'; // common guessable PIN

// Common PINs that are not caught by the structural rules below.
const BLOCKLIST = new Set(['0000', '1234', '1111', '2580', '1212', '0007']);

export type PinValidation =
  | { ok: true }
  | { ok: false; reason: PinRejectionReason };

function isRepeated(pin: string): boolean {
  return pin[0] === pin[1] && pin[1] === pin[2] && pin[2] === pin[3];
}

function isSequence(pin: string): boolean {
  const d = pin.split('').map(Number);
  const ascending = d.every((n, i) => i === 0 || n === d[i - 1]! + 1);
  const descending = d.every((n, i) => i === 0 || n === d[i - 1]! - 1);
  return ascending || descending;
}

/**
 * Validate a PIN against structural rules plus the owning phone number.
 * `canonicalPhone` must already be in E.164 form.
 */
export function validatePin(
  pin: string,
  canonicalPhone: string,
): PinValidation {
  if (!/^\d{4}$/.test(pin)) return { ok: false, reason: 'format' };
  if (isRepeated(pin)) return { ok: false, reason: 'repeated' };
  if (isSequence(pin)) return { ok: false, reason: 'sequence' };
  if (BLOCKLIST.has(pin)) return { ok: false, reason: 'blocklisted' };
  if (pin === lastFourDigits(canonicalPhone))
    return { ok: false, reason: 'phone_suffix' };
  return { ok: true };
}

/** Format-only check (used before we know the phone, e.g. current-PIN entry). */
export function isPinFormatValid(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
