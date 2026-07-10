import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

/*
 * Short-lived capability token authorizing document uploads for one freshly
 * submitted application (spec §8.3, §24). The public /apply flow submits the
 * application first, then uploads the 13 documents one request at a time
 * (Vercel caps request bodies at ~4.5 MB, so a single multipart submission of
 * all documents cannot work in production). The token is stateless:
 * `${applicationId}.${expiresAtMs}.${hmac}` signed with a server-only secret,
 * so an anonymous uploader can only attach documents to the application they
 * just created, and only for a bounded window.
 */

const TOKEN_TTL_MS = 2 * 60 * 60_000; // 2 hours

function sign(applicationId: string, expiresAtMs: number): string {
  return createHmac('sha256', serverEnv().AUTH_PIN_PEPPER)
    .update(`apply-upload:${applicationId}:${expiresAtMs}`)
    .digest('hex');
}

export function createUploadToken(applicationId: string): string {
  const expiresAtMs = Date.now() + TOKEN_TTL_MS;
  return `${applicationId}.${expiresAtMs}.${sign(applicationId, expiresAtMs)}`;
}

/** Returns the application id the token authorizes, or null. */
export function verifyUploadToken(token: string): string | null {
  const parts = token.split('.');
  const applicationId = parts[0];
  const expRaw = parts[1];
  const mac = parts[2];
  if (parts.length !== 3 || !applicationId || !expRaw || !mac) return null;
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return null;
  const expiresAtMs = Number(expRaw);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;
  const expected = sign(applicationId, expiresAtMs);
  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return applicationId;
}
