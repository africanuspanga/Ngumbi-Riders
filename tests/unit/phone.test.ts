import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  tryNormalizePhone,
  isValidPhone,
  lastFourDigits,
  InvalidPhoneError,
} from '@/lib/auth/phone';

describe('normalizePhone', () => {
  it('accepts the various local formats and canonicalises them', () => {
    const expected = '+255712345678';
    expect(normalizePhone('0712345678')).toBe(expected);
    expect(normalizePhone('712345678')).toBe(expected);
    expect(normalizePhone('255712345678')).toBe(expected);
    expect(normalizePhone('+255712345678')).toBe(expected);
    expect(normalizePhone('+255 712 345 678')).toBe(expected);
    expect(normalizePhone('0712-345-678')).toBe(expected);
    expect(normalizePhone('(0712) 345678')).toBe(expected);
  });

  it('accepts numbers beginning with 6 (some MNOs)', () => {
    expect(normalizePhone('0655123456')).toBe('+255655123456');
  });

  it('rejects invalid numbers', () => {
    expect(() => normalizePhone('')).toThrow(InvalidPhoneError);
    expect(() => normalizePhone('123')).toThrow(InvalidPhoneError);
    expect(() => normalizePhone('0812345678')).toThrow(); // 8 not allowed
    expect(() => normalizePhone('071234567')).toThrow(); // too short
    expect(() => normalizePhone('07123456789')).toThrow(); // too long
    expect(() => normalizePhone('+1 202 555 0100')).toThrow(); // wrong country
  });

  it('tryNormalizePhone returns null instead of throwing', () => {
    expect(tryNormalizePhone('nonsense')).toBeNull();
    expect(tryNormalizePhone('0712345678')).toBe('+255712345678');
  });

  it('isValidPhone reflects validity', () => {
    expect(isValidPhone('0712345678')).toBe(true);
    expect(isValidPhone('nope')).toBe(false);
  });

  it('lastFourDigits returns the trailing four', () => {
    expect(lastFourDigits('+255712345678')).toBe('5678');
  });
});
