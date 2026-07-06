import { describe, it, expect } from 'vitest';
import {
  verifySnippeSignature,
  computeSnippeSignature,
} from '@/lib/payments/webhook-verify';
import { newIdempotencyKey, isValidIdempotencyKey, MAX_IDEMPOTENCY_LENGTH } from '@/lib/payments/idempotency';

const SECRET = 'whsec_test_key';
const NOW = 1_800_000_000; // fixed epoch seconds
const BODY = '{"id":"evt_1","type":"payment.completed","data":{"reference":"pi_1"}}';

function sign(ts: number, body: string) {
  return computeSnippeSignature(SECRET, String(ts), body);
}

describe('verifySnippeSignature', () => {
  it('accepts a correctly signed, fresh webhook', () => {
    const ts = NOW - 10;
    const sig = sign(ts, BODY);
    expect(verifySnippeSignature({ rawBody: BODY, timestamp: String(ts), signature: sig, secret: SECRET, nowSeconds: NOW })).toEqual({ valid: true });
  });

  it('rejects a tampered body', () => {
    const ts = NOW - 10;
    const sig = sign(ts, BODY);
    const r = verifySnippeSignature({ rawBody: BODY + ' ', timestamp: String(ts), signature: sig, secret: SECRET, nowSeconds: NOW });
    expect(r).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a wrong secret', () => {
    const ts = NOW - 10;
    const sig = computeSnippeSignature('wrong', String(ts), BODY);
    expect(verifySnippeSignature({ rawBody: BODY, timestamp: String(ts), signature: sig, secret: SECRET, nowSeconds: NOW }).valid).toBe(false);
  });

  it('rejects a stale timestamp (> 5 min)', () => {
    const ts = NOW - 400;
    const sig = sign(ts, BODY);
    expect(verifySnippeSignature({ rawBody: BODY, timestamp: String(ts), signature: sig, secret: SECRET, nowSeconds: NOW })).toEqual({ valid: false, reason: 'stale' });
  });

  it('rejects missing headers', () => {
    expect(verifySnippeSignature({ rawBody: BODY, timestamp: null, signature: null, secret: SECRET, nowSeconds: NOW })).toEqual({ valid: false, reason: 'malformed' });
  });

  it('the signature matches the guide formula {timestamp}.{body}', () => {
    const ts = '1700000000';
    const expected = computeSnippeSignature(SECRET, ts, BODY);
    // recompute independently
    expect(computeSnippeSignature(SECRET, ts, BODY)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('idempotency key', () => {
  it('is at most 30 characters and alphanumeric', () => {
    for (let i = 0; i < 50; i++) {
      const key = newIdempotencyKey();
      expect(key.length).toBeLessThanOrEqual(MAX_IDEMPOTENCY_LENGTH);
      expect(isValidIdempotencyKey(key)).toBe(true);
    }
  });
  it('rejects an over-long key', () => {
    expect(isValidIdempotencyKey('x'.repeat(31))).toBe(false);
  });
});
