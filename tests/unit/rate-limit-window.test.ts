import { describe, it, expect } from 'vitest';
import { evaluateFixedWindow } from '@/lib/security/rate-limit-window';

const NOW = Date.parse('2026-07-06T12:00:00.000Z');
const ago = (min: number) => NOW - min * 60_000;
const POLICY = { max: 5, windowMs: 60 * 60_000 }; // 5 per hour

describe('evaluateFixedWindow', () => {
  it('allows when under the limit and reports remaining', () => {
    const v = evaluateFixedWindow([ago(1), ago(2)], NOW, POLICY);
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(2); // 5 - 2 existing - 1 for this attempt
  });

  it('blocks once the window is full', () => {
    const ts = [ago(5), ago(10), ago(15), ago(20), ago(25)];
    const v = evaluateFixedWindow(ts, NOW, POLICY);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('ignores events older than the window', () => {
    const ts = [ago(61), ago(70), ago(80), ago(90), ago(100)];
    const v = evaluateFixedWindow(ts, NOW, POLICY);
    expect(v.allowed).toBe(true);
  });

  it('retryAfter counts down from the oldest in-window event', () => {
    // Oldest in-window event was 25 min ago -> ages out in 35 min.
    const ts = [ago(5), ago(10), ago(15), ago(20), ago(25)];
    const v = evaluateFixedWindow(ts, NOW, POLICY);
    expect(v.retryAfterSeconds).toBe(35 * 60);
  });

  it('allows exactly at the boundary below max', () => {
    const ts = [ago(1), ago(2), ago(3), ago(4)]; // 4 < 5
    expect(evaluateFixedWindow(ts, NOW, POLICY).allowed).toBe(true);
  });
});
