import { describe, it, expect } from 'vitest';
import { evaluateLockout, RATE_LIMIT } from '@/lib/auth/lockout';

const NOW = Date.parse('2026-07-06T12:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const fail = (min: number) => ({ outcome: 'invalid_credentials', created_at: ago(min) });

describe('evaluateLockout', () => {
  it('does not lock below the failure threshold', () => {
    const attempts = [fail(1), fail(2), fail(3), fail(4)];
    expect(evaluateLockout(attempts, NOW)).toBeNull();
  });

  it('locks after five failures within the 15-minute window', () => {
    const attempts = [fail(1), fail(3), fail(5), fail(8), fail(12)];
    const until = evaluateLockout(attempts, NOW);
    expect(until).not.toBeNull();
    // Locked for 30 minutes after the most recent failure (1 min ago).
    expect(until).toBe(NOW - 1 * 60_000 + RATE_LIMIT.lockoutMinutes * 60_000);
  });

  it('does NOT lock when five failures are spread beyond 15 minutes', () => {
    // 5 failures but spanning 20 minutes -> no single 15-min window holds 5.
    const attempts = [fail(1), fail(6), fail(11), fail(16), fail(21)];
    expect(evaluateLockout(attempts, NOW)).toBeNull();
  });

  it('keeps the lock for the FULL 30 minutes after the burst', () => {
    // Burst completed 20 minutes ago (all within a 15-min span). Still locked
    // now because 20 < 30 minutes have elapsed.
    const attempts = [fail(20), fail(22), fail(25), fail(28), fail(31)];
    const until = evaluateLockout(attempts, NOW);
    expect(until).toBe(NOW - 20 * 60_000 + RATE_LIMIT.lockoutMinutes * 60_000);
    expect(until!).toBeGreaterThan(NOW);
  });

  it('lock expires once 30 minutes pass since the burst', () => {
    // Most recent failure of the burst was 31 minutes ago -> expired.
    const attempts = [fail(31), fail(33), fail(36), fail(39), fail(42)];
    expect(evaluateLockout(attempts, NOW)).toBeNull();
  });

  it('successful attempts never count toward lockout', () => {
    const attempts = [1, 2, 3, 4, 5].map((m) => ({
      outcome: 'success',
      created_at: ago(m),
    }));
    expect(evaluateLockout(attempts, NOW)).toBeNull();
  });
});
