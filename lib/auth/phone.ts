/*
 * Tanzanian phone-number normalization to E.164 (+255XXXXXXXXX).
 *
 * Pure and dependency-free so it can be unit tested and reused on both the
 * server and (for formatting only) the client. The canonical E.164 string is
 * what we store, what we uniquely constrain in the database, and what feeds the
 * PIN-derivation HMAC — so it must be deterministic.
 *
 * Tanzanian mobile numbers are +255 followed by 9 digits, where the national
 * significant number begins with 6 or 7.
 */

const E164_TZ = /^\+255[67]\d{8}$/;

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Invalid Tanzanian phone number: ${input}`);
    this.name = 'InvalidPhoneError';
  }
}

/**
 * Returns the canonical +255XXXXXXXXX form, or throws InvalidPhoneError.
 * Accepts common local formats: 0712345678, 712345678, 255712..., +255712...,
 * and tolerates spaces, dashes and parentheses.
 */
export function normalizePhone(input: string): string {
  if (typeof input !== 'string') throw new InvalidPhoneError(String(input));

  // Keep digits only; a leading + is implied by the country logic below.
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length === 0) throw new InvalidPhoneError(input);

  let national: string;

  if (digits.startsWith('255')) {
    national = digits.slice(3);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    // Bare national significant number, e.g. 712345678.
    national = digits;
  }

  const candidate = `+255${national}`;
  if (!E164_TZ.test(candidate)) throw new InvalidPhoneError(input);
  return candidate;
}

/** Non-throwing variant for validation contexts. */
export function tryNormalizePhone(input: string): string | null {
  try {
    return normalizePhone(input);
  } catch {
    return null;
  }
}

export function isValidPhone(input: string): boolean {
  return tryNormalizePhone(input) !== null;
}

/** Last four digits of the national number — used by weak-PIN checks. */
export function lastFourDigits(canonicalPhone: string): string {
  return canonicalPhone.slice(-4);
}
