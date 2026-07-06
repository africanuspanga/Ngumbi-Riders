import { describe, it, expect } from 'vitest';
import { validatePin, isPinFormatValid } from '@/lib/auth/pin';
import { derivePassword, safeEqual } from '@/lib/auth/pin-derive';

const PHONE = '+255712345678';

describe('validatePin', () => {
  it('accepts a strong four-digit PIN', () => {
    expect(validatePin('4820', PHONE)).toEqual({ ok: true });
    expect(validatePin('9027', PHONE)).toEqual({ ok: true });
  });

  it('rejects wrong length / non-digits', () => {
    expect(validatePin('123', PHONE).ok).toBe(false);
    expect(validatePin('12345', PHONE).ok).toBe(false);
    expect(validatePin('12a4', PHONE).ok).toBe(false);
  });

  it('rejects repeated digits', () => {
    for (const p of ['0000', '1111', '9999']) {
      expect(validatePin(p, PHONE)).toEqual({ ok: false, reason: expect.any(String) });
      expect(validatePin(p, PHONE).ok).toBe(false);
    }
  });

  it('rejects ascending and descending sequences', () => {
    expect(validatePin('1234', PHONE).ok).toBe(false);
    expect(validatePin('2345', PHONE).ok).toBe(false);
    expect(validatePin('4321', PHONE).ok).toBe(false);
    expect(validatePin('9876', PHONE).ok).toBe(false);
  });

  it('rejects the last four digits of the phone', () => {
    // Use a phone tail that is not itself a sequence/repeat so the phone_suffix
    // rule is what triggers.
    const phone = '+255712349274';
    const res = validatePin('9274', phone);
    expect(res).toEqual({ ok: false, reason: 'phone_suffix' });
  });

  it('rejects blocklisted common PINs', () => {
    expect(validatePin('2580', PHONE)).toEqual({ ok: false, reason: 'blocklisted' });
  });

  it('isPinFormatValid checks digits only', () => {
    expect(isPinFormatValid('0000')).toBe(true);
    expect(isPinFormatValid('12x4')).toBe(false);
  });
});

describe('derivePassword', () => {
  it('is deterministic for the same inputs', () => {
    expect(derivePassword(PHONE, '4820')).toBe(derivePassword(PHONE, '4820'));
  });

  it('never returns the raw PIN and looks like a sha256 hex digest', () => {
    const d = derivePassword(PHONE, '4820');
    expect(d).not.toContain('4820');
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds the phone so the same PIN differs across accounts', () => {
    expect(derivePassword(PHONE, '4820')).not.toBe(
      derivePassword('+255713333333', '4820'),
    );
  });

  it('differs for different PINs on the same phone', () => {
    expect(derivePassword(PHONE, '4820')).not.toBe(derivePassword(PHONE, '4821'));
  });

  it('safeEqual compares in constant time by value', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
