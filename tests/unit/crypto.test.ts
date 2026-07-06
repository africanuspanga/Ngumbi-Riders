import { describe, it, expect } from 'vitest';
import {
  encryptPII,
  decryptPII,
  encryptOptionalPII,
  maskIdentifier,
} from '@/lib/security/crypto';

describe('PII encryption (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const secret = '19900101123456789012';
    const enc = encryptPII(secret);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptPII(enc)).toBe(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const a = encryptPII('same-value');
    const b = encryptPII('same-value');
    expect(a).not.toBe(b);
    expect(decryptPII(a)).toBe('same-value');
    expect(decryptPII(b)).toBe('same-value');
  });

  it('rejects a tampered ciphertext (auth tag)', () => {
    const enc = encryptPII('tamper-me');
    const parts = enc.split('.');
    // Flip a character in the ciphertext segment.
    parts[3] = parts[3]!.slice(0, -1) + (parts[3]!.endsWith('A') ? 'B' : 'A');
    expect(() => decryptPII(parts.join('.'))).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptPII('not-a-payload')).toThrow();
    expect(() => decryptPII('v2.a.b.c')).toThrow();
  });

  it('encryptOptionalPII passes through null/empty', () => {
    expect(encryptOptionalPII(null)).toBeNull();
    expect(encryptOptionalPII('')).toBeNull();
    expect(encryptOptionalPII(undefined)).toBeNull();
    expect(encryptOptionalPII('x')).not.toBeNull();
  });

  it('maskIdentifier reveals only the last four', () => {
    expect(maskIdentifier('19900101123456789012')).toBe('•••• 9012');
    expect(maskIdentifier('12')).toBe('••••');
  });
});
