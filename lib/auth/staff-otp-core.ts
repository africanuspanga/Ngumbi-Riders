import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/*
 * The pure half of staff SMS sign-in codes (D-053). No I/O here, so every rule
 * that decides whether a code is accepted is unit-tested
 * (tests/unit/staff-otp.test.ts). The server half is lib/auth/staff-otp.ts.
 */

export const OTP_POLICY = {
  /** Digits in a code. 6 → one in a million per guess. */
  length: 6,
  /** How long a code is valid after it is (re)sent. */
  ttlSeconds: 5 * 60,
  /** Wrong guesses before the challenge is burned and a new login is needed. */
  maxAttempts: 5,
  /** Minimum gap between two SMS for the same challenge. */
  resendCooldownSeconds: 60,
  /** SMS per challenge, the first one included. */
  maxSends: 3,
  /** New challenges per account per window — caps SMS cost and spam. */
  maxChallengesPerWindow: 5,
  windowSeconds: 15 * 60,
} as const;

/** A uniformly random code, zero-padded ("004211" is a valid code). */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_POLICY.length)).padStart(OTP_POLICY.length, '0');
}

/**
 * Keyed by the challenge id so the same code on two challenges hashes
 * differently; keyed by the server pepper so a leaked table cannot be brute
 * forced offline (a 6-digit space is only a million guesses).
 */
export function hashOtpCode(pepper: string, challengeId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');
}

export function normalizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, '');
}

export type ChallengeState = {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
};

export type OtpCheck =
  | { ok: true }
  | { ok: false; reason: 'consumed' | 'expired' | 'too_many_attempts' | 'malformed' | 'wrong_code' };

/**
 * Decide a guess. The order matters: a used, expired or exhausted challenge is
 * refused BEFORE the code is compared, so it cannot be used as an oracle.
 * `wrong_code` is the only outcome that should count as an attempt.
 */
export function checkOtp(
  challenge: ChallengeState,
  input: { pepper: string; challengeId: string; code: string },
  now: Date = new Date(),
): OtpCheck {
  if (challenge.consumedAt) return { ok: false, reason: 'consumed' };
  if (now.getTime() >= challenge.expiresAt.getTime()) return { ok: false, reason: 'expired' };
  if (challenge.attempts >= OTP_POLICY.maxAttempts) return { ok: false, reason: 'too_many_attempts' };

  const code = normalizeOtpInput(input.code);
  if (code.length !== OTP_POLICY.length) return { ok: false, reason: 'malformed' };

  const expected = Buffer.from(challenge.codeHash, 'hex');
  const actual = Buffer.from(hashOtpCode(input.pepper, input.challengeId, code), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'wrong_code' };
  }
  return { ok: true };
}

export type ResendCheck =
  | { ok: true }
  | { ok: false; reason: 'consumed' | 'too_many_sends' | 'too_many_attempts' | 'cooldown'; retryAfterSeconds?: number };

export function canResend(
  c: { consumedAt: Date | null; sentCount: number; lastSentAt: Date; attempts: number },
  now: Date = new Date(),
): ResendCheck {
  if (c.consumedAt) return { ok: false, reason: 'consumed' };
  if (c.attempts >= OTP_POLICY.maxAttempts) return { ok: false, reason: 'too_many_attempts' };
  if (c.sentCount >= OTP_POLICY.maxSends) return { ok: false, reason: 'too_many_sends' };
  const elapsed = (now.getTime() - c.lastSentAt.getTime()) / 1000;
  if (elapsed < OTP_POLICY.resendCooldownSeconds) {
    return {
      ok: false,
      reason: 'cooldown',
      retryAfterSeconds: Math.ceil(OTP_POLICY.resendCooldownSeconds - elapsed),
    };
  }
  return { ok: true };
}

/** "+255753522155" → "+255 7*****155" — enough to recognise, not to harvest. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  const rest = digits.slice(3);
  return `+${digits.slice(0, 3)} ${rest[0]}${'*'.repeat(rest.length - 4)}${rest.slice(-3)}`;
}

/**
 * The `session_id` claim of a Supabase access token. Read WITHOUT verifying the
 * signature — only ever call this on a token Supabase itself just returned to
 * the server, never on one supplied by a client.
 */
export function sessionIdFromAccessToken(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      session_id?: unknown;
    };
    return typeof json.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(json.session_id)
      ? json.session_id
      : null;
  } catch {
    return null;
  }
}

/** The SMS itself. ASCII only so it stays one GSM-7 segment. */
export function otpSmsText(code: string): string {
  return `Ng'umbi Riders: nambari yako ya kuingia ni ${code}. Inaisha baada ya dakika 5. Usimpe mtu yeyote. / Your sign-in code is ${code}.`;
}
