import { randomBytes } from 'node:crypto';

/*
 * Snippe requires an Idempotency-Key of at most 30 characters (Integration
 * Guide §Idempotency; a longer key returns 500 PAY_001). Our payment UUID is 36
 * chars, so we mint a short, unique, alphanumeric key and store it on the
 * payment row (which has its own unique constraint).
 */
export const MAX_IDEMPOTENCY_LENGTH = 30;

/** e.g. "ngr7f3k9q2x8m1p4a" — prefix + base36 entropy, always ≤ 30 chars. */
export function newIdempotencyKey(): string {
  const entropy = BigInt('0x' + randomBytes(12).toString('hex')).toString(36);
  return `ngr${entropy}`.slice(0, MAX_IDEMPOTENCY_LENGTH);
}

export function isValidIdempotencyKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,30}$/.test(key);
}
