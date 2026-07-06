/*
 * Pure fixed-window rate-limit evaluation. Used by the generic durable limiter
 * (lib/security/rate-limit.ts) that throttles application submission and file
 * uploads (spec §25.2). Kept dependency-free so the policy math is unit tested
 * without a database.
 */
export type RateLimitPolicy = { max: number; windowMs: number };

export type RateLimitVerdict = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Given prior event timestamps (epoch-ms) for a key, decide whether one more
 * action is allowed at `now`. Blocks once `max` events fall inside the window;
 * `retryAfterSeconds` is when the oldest in-window event ages out.
 */
export function evaluateFixedWindow(
  timestamps: number[],
  now: number,
  policy: RateLimitPolicy,
): RateLimitVerdict {
  const windowStart = now - policy.windowMs;
  const inWindow = timestamps
    .filter((t) => t >= windowStart)
    .sort((a, b) => a - b);

  if (inWindow.length < policy.max) {
    return {
      allowed: true,
      remaining: policy.max - inWindow.length - 1,
      retryAfterSeconds: 0,
    };
  }

  const oldest = inWindow[0]!;
  const retryMs = oldest + policy.windowMs - now;
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
  };
}
