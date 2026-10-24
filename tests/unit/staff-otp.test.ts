import { describe, expect, it } from 'vitest';
import {
  OTP_POLICY,
  canResend,
  checkOtp,
  generateOtpCode,
  hashOtpCode,
  maskPhone,
  otpSmsText,
  sessionIdFromAccessToken,
} from '@/lib/auth/staff-otp-core';

const PEPPER = 'x'.repeat(40);
const ID = '0b9c6a4e-1f7d-4c4e-9a59-3c1f0e2d7b11';
const NOW = new Date('2026-10-24T08:00:00Z');

function challenge(code: string, over: Partial<Parameters<typeof checkOtp>[0]> = {}) {
  return {
    codeHash: hashOtpCode(PEPPER, ID, code),
    expiresAt: new Date(NOW.getTime() + 60_000),
    attempts: 0,
    consumedAt: null,
    ...over,
  };
}

describe('generateOtpCode', () => {
  it('is always six digits, zero-padded', () => {
    for (let i = 0; i < 2000; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
});

describe('hashOtpCode', () => {
  it('binds the code to its challenge and to the pepper', () => {
    const h = hashOtpCode(PEPPER, ID, '123456');
    expect(h).not.toBe(hashOtpCode(PEPPER, '11111111-1111-1111-1111-111111111111', '123456'));
    expect(h).not.toBe(hashOtpCode('y'.repeat(40), ID, '123456'));
    expect(h).not.toContain('123456');
  });
});

describe('checkOtp', () => {
  const input = (code: string) => ({ pepper: PEPPER, challengeId: ID, code });

  it('accepts the right code, with or without spaces', () => {
    expect(checkOtp(challenge('004211'), input('004211'), NOW)).toEqual({ ok: true });
    expect(checkOtp(challenge('004211'), input('004 211'), NOW)).toEqual({ ok: true });
  });

  it('refuses a wrong code', () => {
    expect(checkOtp(challenge('004211'), input('004212'), NOW)).toEqual({ ok: false, reason: 'wrong_code' });
  });

  it('refuses a malformed code without counting it', () => {
    expect(checkOtp(challenge('004211'), input('4211'), NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses at and after expiry', () => {
    const c = challenge('004211', { expiresAt: NOW });
    expect(checkOtp(c, input('004211'), NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('a used or exhausted challenge refuses even the RIGHT code (no oracle)', () => {
    expect(checkOtp(challenge('004211', { consumedAt: NOW }), input('004211'), NOW)).toEqual({
      ok: false,
      reason: 'consumed',
    });
    expect(
      checkOtp(challenge('004211', { attempts: OTP_POLICY.maxAttempts }), input('004211'), NOW),
    ).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('allows exactly maxAttempts guesses', () => {
    const c = challenge('004211', { attempts: OTP_POLICY.maxAttempts - 1 });
    expect(checkOtp(c, input('004211'), NOW)).toEqual({ ok: true });
  });
});

describe('canResend', () => {
  const base = { consumedAt: null, sentCount: 1, attempts: 0 };

  it('enforces the cooldown and reports how long is left', () => {
    const r = canResend({ ...base, lastSentAt: new Date(NOW.getTime() - 20_000) }, NOW);
    expect(r).toEqual({ ok: false, reason: 'cooldown', retryAfterSeconds: 40 });
  });

  it('allows a resend after the cooldown', () => {
    const r = canResend({ ...base, lastSentAt: new Date(NOW.getTime() - 61_000) }, NOW);
    expect(r).toEqual({ ok: true });
  });

  it('caps sends per challenge and refuses used or exhausted ones', () => {
    const old = new Date(NOW.getTime() - 3_600_000);
    expect(canResend({ ...base, sentCount: OTP_POLICY.maxSends, lastSentAt: old }, NOW)).toMatchObject({
      reason: 'too_many_sends',
    });
    expect(canResend({ ...base, consumedAt: NOW, lastSentAt: old }, NOW)).toMatchObject({ reason: 'consumed' });
    expect(
      canResend({ ...base, attempts: OTP_POLICY.maxAttempts, lastSentAt: old }, NOW),
    ).toMatchObject({ reason: 'too_many_attempts' });
  });
});

describe('maskPhone', () => {
  it('shows the country code, first and last three digits only', () => {
    expect(maskPhone('+255753522155')).toBe('+255 7*****155');
  });
  it('does not leak a short or odd value', () => {
    expect(maskPhone('123')).toBe('***');
  });
});

describe('sessionIdFromAccessToken', () => {
  const token = (payload: object) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

  it('reads the session_id claim', () => {
    expect(sessionIdFromAccessToken(token({ session_id: ID }))).toBe(ID);
  });
  it('returns null for a missing or non-uuid claim, or garbage', () => {
    expect(sessionIdFromAccessToken(token({}))).toBeNull();
    expect(sessionIdFromAccessToken(token({ session_id: "x' or 1=1" }))).toBeNull();
    expect(sessionIdFromAccessToken('not-a-jwt')).toBeNull();
  });
});

describe('otpSmsText', () => {
  it('carries the code and stays a single plain-ASCII SMS', () => {
    const text = otpSmsText('004211');
    expect(text).toContain('004211');
    expect(/^[\x20-\x7E]*$/.test(text)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(160);
  });
});
