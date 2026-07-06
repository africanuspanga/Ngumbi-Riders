import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { LoginOutcome } from '@/lib/supabase/types';
import { RATE_LIMIT, evaluateLockout } from './lockout';

/*
 * Login rate limiting and temporary lockout (spec §7.3).
 *
 *   Five failed attempts within 15 minutes locks login for 30 minutes.
 *
 * Attempts are tracked per phone AND per IP so a single IP cannot brute-force
 * across many phones. Records live in the `login_attempts` table and never
 * contain the PIN. Written via the service-role client because unauthenticated
 * callers must not read or write this table under RLS. The lockout math itself
 * lives in ./lockout.ts and is unit tested there.
 */

export { RATE_LIMIT } from './lockout';

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type AttemptRow = { outcome: LoginOutcome; created_at: string };

/**
 * Decide whether a login attempt from (phone, ip) may proceed. Reads the recent
 * attempt history for either identifier and blocks if either is locked.
 */
export async function checkLoginRateLimit(
  phone: string | null,
  ip: string,
): Promise<RateLimitDecision> {
  const admin = createAdminClient();
  const now = Date.now();
  // Look back far enough to catch a burst whose oldest member preceded a lock
  // that is still active: lockout (30m) + detection window (15m).
  const lookbackIso = new Date(
    now - (RATE_LIMIT.lockoutMinutes + RATE_LIMIT.windowMinutes) * 60_000,
  ).toISOString();

  const { data, error } = await admin
    .from('login_attempts')
    .select('outcome, created_at, phone, ip')
    .gte('created_at', lookbackIso)
    .or(`phone.eq.${phone ?? '__none__'},ip.eq.${ip}`);

  if (error || !data) {
    // Fail open only for read errors — a failure to read history must not lock
    // out a legitimate rider — but the attempt is still recorded below.
    return { allowed: true };
  }

  const rows = data as unknown as Array<AttemptRow & { phone: string | null; ip: string }>;
  const byPhone = phone ? rows.filter((r) => r.phone === phone) : [];
  const byIp = rows.filter((r) => r.ip === ip);

  const lockedUntil =
    evaluateLockout(byPhone, now) ?? evaluateLockout(byIp, now) ?? null;

  if (lockedUntil !== null) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000),
    };
  }
  return { allowed: true };
}

/** Record an attempt outcome. Never receives or stores the PIN. */
export async function recordLoginAttempt(params: {
  phone: string | null;
  ip: string;
  outcome: LoginOutcome;
  userAgent?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from('login_attempts').insert({
    phone: params.phone,
    ip: params.ip,
    outcome: params.outcome,
    user_agent: params.userAgent ?? null,
  });
}
