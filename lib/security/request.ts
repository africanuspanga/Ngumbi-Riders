import 'server-only';

/**
 * Best-effort client IP for rate limiting. Behind Vercel/other proxies the real
 * client is in `x-forwarded-for` (first hop). Never trust this for authz — it
 * is only an additional brute-force throttle key.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
