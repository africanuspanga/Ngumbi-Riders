import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { serverEnv } from '@/lib/env';

/*
 * Application-level field encryption for especially sensitive PII — NIDA and
 * driving-licence numbers, guarantor identifiers (spec §25.1). AES-256-GCM with
 * a random 96-bit IV per value and the auth tag stored alongside.
 *
 * Format (all base64, dot-separated, versioned so the scheme can evolve):
 *   v1.<iv>.<authTag>.<ciphertext>
 *
 * The key is PII_ENCRYPTION_KEY, a base64-encoded 32-byte key held only in the
 * server environment. Decrypted values are NEVER logged (spec §25.1).
 */

const VERSION = 'v1';
const IV_BYTES = 12;

function key(): Buffer {
  const raw = Buffer.from(serverEnv().PII_ENCRYPTION_KEY, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      'PII_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).',
    );
  }
  return raw;
}

export function encryptPII(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join('.');
}

export function decryptPII(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed ciphertext payload.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

/** Encrypt when present; pass through null/empty so optional fields stay null. */
export function encryptOptionalPII(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return encryptPII(value);
}

/**
 * Mask an identifier for list views (spec §25.1): reveal only the last 4 chars.
 * Operates on plaintext, e.g. "19900101...1234" -> "•••• 1234".
 */
export function maskIdentifier(value: string): string {
  const trimmed = value.replace(/\s+/g, '');
  if (trimmed.length <= 4) return '••••';
  return `•••• ${trimmed.slice(-4)}`;
}
