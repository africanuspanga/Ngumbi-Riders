import 'server-only';

/**
 * Best-effort client IP for rate limiting. Behind Vercel/other proxies the real
 * client is in `x-forwarded-for` (first hop). Never trust this for authz — it
 * is only an additional brute-force throttle key.
 */
const IP_SHAPE = /^[0-9a-fA-F:.]{3,45}$/;

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    // Attacker-controlled header: only accept something IP-shaped, so a
    // crafted value can't error the PostgREST filter it is interpolated into
    // (which would fail the rate limiter open).
    if (first && IP_SHAPE.test(first)) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real && IP_SHAPE.test(real)) return real;
  return 'unknown';
}
