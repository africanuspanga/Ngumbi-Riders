import { describe, it, expect } from 'vitest';
import { computeRisk } from '@/lib/risk/scoring';

const base = { overdueLast30: 0, consecutiveMisses: 0, arrearsAmount: 0 };

describe('computeRisk', () => {
  it('is low with no overdue in the last 30 days', () => {
    const r = computeRisk(base);
    expect(r.level).toBe('low');
    expect(r.reasons[0]).toMatch(/No overdue/);
  });

  it('is medium with 1–2 overdue', () => {
    expect(computeRisk({ ...base, overdueLast30: 1 }).level).toBe('medium');
    expect(computeRisk({ ...base, overdueLast30: 2 }).level).toBe('medium');
  });

  it('is high with 3–6 overdue', () => {
    expect(computeRisk({ ...base, overdueLast30: 3 }).level).toBe('high');
    expect(computeRisk({ ...base, overdueLast30: 6 }).level).toBe('high');
  });

  it('is critical with 7+ overdue', () => {
    expect(computeRisk({ ...base, overdueLast30: 7 }).level).toBe('critical');
  });

  it('escalates to high on two consecutive misses', () => {
    const r = computeRisk({ ...base, consecutiveMisses: 2 });
    expect(r.level).toBe('high');
    expect(r.reasons.join(' ')).toMatch(/consecutive/);
  });

  it('escalates on significant / prolonged arrears', () => {
    expect(computeRisk({ ...base, arrearsAmount: 50_000 }).level).toBe('high');
    expect(computeRisk({ ...base, arrearsAmount: 200_000 }).level).toBe('critical');
  });

  it('honours an owner manual override above computed level', () => {
    const r = computeRisk({ ...base, overdueLast30: 0, manualOverride: 'critical' });
    expect(r.level).toBe('critical');
    expect(r.reasons).toEqual(['Owner manual override']);
  });

  it('records explainable reasons for every contributing factor', () => {
    const r = computeRisk({ overdueLast30: 4, consecutiveMisses: 3, arrearsAmount: 60_000 });
    expect(r.level).toBe('high');
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
