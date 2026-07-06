import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Snippe webhook verification (Integration Guide §Webhooks). The signature is
 *   hex(HMAC-SHA256(signing_key, "{timestamp}.{raw_body}"))
 * computed over the RAW request body — never re-serialize the JSON. Timestamps
 * older than 5 minutes are rejected to prevent replay. Constant-time compare.
 *
 * Pure so verification can be unit tested with known vectors.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: 'stale' | 'bad_signature' | 'malformed' };

export function computeSnippeSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

export function verifySnippeSignature(params: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): VerifyResult {
  const { rawBody, timestamp, signature, secret, nowSeconds } = params;
  const tolerance = params.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;

  if (!timestamp || !signature) return { valid: false, reason: 'malformed' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'malformed' };

  // Reject stale (and implausibly future) timestamps.
  if (Math.abs(nowSeconds - ts) > tolerance) return { valid: false, reason: 'stale' };

  const expected = computeSnippeSignature(secret, timestamp, rawBody);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }
  return { valid: true };
}
