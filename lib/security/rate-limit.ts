import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  evaluateFixedWindow,
  type RateLimitPolicy,
} from './rate-limit-window';

/*
 * Generic durable rate limiter (spec §25.2) for public/expensive actions such
 * as application submission and file uploads. Backed by `rate_limit_events` via
 * the service-role client. The window math lives in ./rate-limit-window.ts and
 * is unit tested.
 *
 * Named policies keep call sites declarative and consistent.
 */
export const POLICIES = {
  application_submit: { max: 5, windowMs: 60 * 60_000 }, // 5 / hour per IP
  upload_sign: { max: 60, windowMs: 60 * 60_000 }, // 60 / hour per IP
} satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof POLICIES;

export type EnforceResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Check the policy for (action, subject); if allowed, record this attempt.
 * Fails open on read errors so a transient DB issue never blocks a legitimate
 * applicant, but still records the event when possible.
 */
export async function enforceRateLimit(
  action: PolicyName,
  subject: string,
): Promise<EnforceResult> {
  const policy = POLICIES[action];
  const admin = createAdminClient();
  const now = Date.now();
  const since = new Date(now - policy.windowMs).toISOString();

  const { data, error } = await admin
    .from('rate_limit_events')
    .select('created_at')
    .eq('action', action)
    .eq('subject', subject)
    .gte('created_at', since);

  if (error) return { allowed: true };

  const timestamps = (data ?? []).map((r) =>
    new Date((r as { created_at: string }).created_at).getTime(),
  );
  const verdict = evaluateFixedWindow(timestamps, now, policy);

  if (!verdict.allowed) {
    return { allowed: false, retryAfterSeconds: verdict.retryAfterSeconds };
  }

  await admin.from('rate_limit_events').insert({ action, subject });
  return { allowed: true };
}
