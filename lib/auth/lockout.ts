/*
 * Pure lockout evaluation (spec §7.3): five failed attempts within 15 minutes
 * locks login for 30 minutes. Kept dependency-free so the rule is unit-tested
 * without a database.
 *
 * The lock must persist for the FULL 30 minutes after the burst, even once the
 * failures age past the 15-minute detection window — so we detect any run of
 * `maxFailures` failures spanning <= `windowMinutes`, then lock for
 * `lockoutMinutes` from the most recent failure in that run.
 */
export const RATE_LIMIT = {
  windowMinutes: 15,
  maxFailures: 5,
  lockoutMinutes: 30,
} as const;

export type Attempt = { outcome: string; created_at: string };

/**
 * Returns the epoch-ms timestamp until which login is locked, or null if not
 * locked. `now` is epoch-ms.
 */
export function evaluateLockout(
  attempts: Attempt[],
  now: number,
): number | null {
  const windowMs = RATE_LIMIT.windowMinutes * 60_000;
  const lockoutMs = RATE_LIMIT.lockoutMinutes * 60_000;

  const failures = attempts
    .filter((a) => a.outcome !== 'success')
    .map((a) => new Date(a.created_at).getTime())
    .sort((a, b) => b - a); // most recent first

  if (failures.length < RATE_LIMIT.maxFailures) return null;

  // Slide a window of `maxFailures` consecutive (time-ordered) failures. If the
  // newest and the fifth-newest in a group fall within `windowMinutes`, that
  // group tripped the lock; it stays locked until newest + 30 minutes.
  for (let i = 0; i + RATE_LIMIT.maxFailures <= failures.length; i++) {
    const newest = failures[i]!;
    const fifth = failures[i + RATE_LIMIT.maxFailures - 1]!;
    if (newest - fifth <= windowMs) {
      const lockedUntil = newest + lockoutMs;
      if (now < lockedUntil) return lockedUntil;
    }
  }
  return null;
}
