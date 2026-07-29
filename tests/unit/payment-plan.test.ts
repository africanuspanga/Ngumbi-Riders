import { describe, it, expect } from 'vitest';
import {
  generatePlan,
  normalizePlan,
  summarizePlan,
  validatePlan,
  planToObligations,
  PlanError,
  MAX_PLAN_ENTRIES,
  type PlanEntry,
} from '@/lib/obligations/plan';

const daily = (startDate: string, endDate: string, amount = 10_000) =>
  generatePlan({ startDate, endDate, frequency: 'daily', amount });

describe('bulk payment-plan generator (spec #1)', () => {
  it('generates a 7-day daily schedule', () => {
    const plan = daily('2026-08-01', '2026-08-07');
    expect(plan).toHaveLength(7);
    expect(plan[0]!.dueDate).toBe('2026-08-01');
    expect(plan[6]!.dueDate).toBe('2026-08-07');
    expect(plan.every((p) => p.included && p.amount === 10_000)).toBe(true);
  });

  it('generates a 30-day daily schedule', () => {
    expect(daily('2026-08-01', '2026-08-30')).toHaveLength(30);
  });

  it('generates the 60-day daily schedule from the spec example', () => {
    // 01/08/2026 → 29/09/2026 at TZS 10,000/day.
    const plan = daily('2026-08-01', '2026-09-29');
    expect(plan).toHaveLength(60);
    expect(summarizePlan(plan)).toEqual({ count: 60, total: 600_000 });
  });

  it('spans month boundaries and leap days correctly', () => {
    expect(daily('2028-02-27', '2028-03-01').map((p) => p.dueDate)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it('generates a weekly schedule on the start weekday by default', () => {
    // 01/08/2026 is a Saturday.
    const plan = generatePlan({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      frequency: 'weekly',
      amount: 50_000,
    });
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29']);
  });

  it('generates a weekly schedule on a chosen weekday', () => {
    const plan = generatePlan({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      frequency: 'weekly',
      amount: 50_000,
      weekdays: [1], // Monday
    });
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);
  });

  it('generates one entry per month for a monthly schedule', () => {
    const plan = generatePlan({
      startDate: '2026-08-01',
      endDate: '2027-01-31',
      frequency: 'monthly',
      amount: 300_000,
      dueDayOfMonth: 5,
    });
    expect(plan.map((p) => p.dueDate)).toEqual([
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  it('clamps a monthly due day of 31 to the last day of each month', () => {
    const plan = generatePlan({
      startDate: '2026-01-01',
      endDate: '2026-04-30',
      frequency: 'monthly',
      amount: 100_000,
      dueDayOfMonth: 31,
    });
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('skips a monthly due day that has already passed in the first month', () => {
    const plan = generatePlan({
      startDate: '2026-08-10',
      endDate: '2026-10-31',
      frequency: 'monthly',
      amount: 100_000,
      dueDayOfMonth: 5,
    });
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-09-05', '2026-10-05']);
  });

  it('generates a custom weekday schedule', () => {
    const plan = generatePlan({
      startDate: '2026-08-01',
      endDate: '2026-08-14',
      frequency: 'custom',
      amount: 20_000,
      weekdays: [1, 3], // Mon + Wed
    });
    expect(plan.map((p) => p.dueDate)).toEqual([
      '2026-08-03',
      '2026-08-05',
      '2026-08-10',
      '2026-08-12',
    ]);
  });

  it('rejects bad generator input', () => {
    expect(() => daily('2026-08-10', '2026-08-01')).toThrow(PlanError);
    expect(() => generatePlan({ startDate: '2026-08-01', endDate: '2026-08-07', frequency: 'daily', amount: 0 })).toThrow(PlanError);
    expect(() => generatePlan({ startDate: 'nope', endDate: '2026-08-07', frequency: 'daily', amount: 1 })).toThrow(PlanError);
    expect(() =>
      generatePlan({ startDate: '2026-08-01', endDate: '2026-08-31', frequency: 'custom', amount: 1, weekdays: [] }),
    ).toThrow(PlanError);
    expect(() =>
      generatePlan({ startDate: '2026-08-01', endDate: '2026-08-31', frequency: 'monthly', amount: 1 }),
    ).toThrow(PlanError);
    // A monthly plan whose due day never falls inside a short range.
    expect(() =>
      generatePlan({ startDate: '2026-08-10', endDate: '2026-08-20', frequency: 'monthly', amount: 1, dueDayOfMonth: 5 }),
    ).toThrow(PlanError);
  });

  it('refuses a period that would exceed the entry cap', () => {
    expect(() => daily('2026-01-01', '2036-01-01')).toThrow(PlanError);
  });

  it('excludes deselected dates from the saved plan and the totals', () => {
    const plan = daily('2026-08-01', '2026-08-07');
    plan[2]!.included = false;
    plan[5]!.included = false;
    const rows = normalizePlan(plan);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.dueDate)).not.toContain('2026-08-03');
    expect(summarizePlan(plan)).toEqual({ count: 5, total: 50_000 });
  });

  it('honours an edited individual amount in the total', () => {
    const plan = daily('2026-08-01', '2026-08-03');
    plan[1]!.amount = 15_000;
    expect(summarizePlan(plan)).toEqual({ count: 3, total: 35_000 });
  });

  it('honours an edited individual date and keeps the plan sorted', () => {
    const plan = daily('2026-08-01', '2026-08-03');
    plan[0]!.dueDate = '2026-08-20';
    expect(normalizePlan(plan).map((r) => r.dueDate)).toEqual(['2026-08-02', '2026-08-03', '2026-08-20']);
  });

  it('collapses duplicate dates rather than inserting them twice', () => {
    const plan: PlanEntry[] = [
      { dueDate: '2026-08-01', amount: 10_000, included: true },
      { dueDate: '2026-08-01', amount: 12_000, included: true },
      { dueDate: '2026-08-02', amount: 10_000, included: true },
    ];
    const rows = normalizePlan(plan);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ dueDate: '2026-08-01', amount: 12_000, included: true });
  });

  it('drops rows with a non-positive or non-numeric amount', () => {
    const rows = normalizePlan([
      { dueDate: '2026-08-01', amount: 0, included: true },
      { dueDate: '2026-08-02', amount: -5, included: true },
      { dueDate: '2026-08-03', amount: Number.NaN, included: true },
      { dueDate: '2026-08-04', amount: 10_000, included: true },
    ]);
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-08-04']);
  });

  describe('server-side validation', () => {
    const bounds = { startDate: '2026-08-01', endDate: '2026-08-31' };

    it('accepts a plan inside the contract term', () => {
      const res = validatePlan(daily('2026-08-01', '2026-08-07'), bounds);
      expect(res.ok).toBe(true);
    });

    it('rejects an empty plan', () => {
      expect(validatePlan([], bounds)).toEqual({ ok: false, error: 'plan_empty' });
      const allExcluded = daily('2026-08-01', '2026-08-03').map((e) => ({ ...e, included: false }));
      expect(validatePlan(allExcluded, bounds)).toEqual({ ok: false, error: 'plan_empty' });
    });

    it('rejects dates outside the contract term', () => {
      const plan = daily('2026-08-01', '2026-08-03');
      plan[0]!.dueDate = '2026-07-31';
      expect(validatePlan(plan, bounds)).toEqual({ ok: false, error: 'plan_out_of_term' });
      const plan2 = daily('2026-08-01', '2026-08-03');
      plan2[0]!.dueDate = '2026-09-01';
      expect(validatePlan(plan2, bounds)).toEqual({ ok: false, error: 'plan_out_of_term' });
    });

    it('rejects a plan longer than the cap', () => {
      const rows: PlanEntry[] = Array.from({ length: MAX_PLAN_ENTRIES + 1 }, (_, i) => ({
        dueDate: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
        amount: 1000,
        included: true,
      }));
      expect(validatePlan(rows, { startDate: '2020-01-01', endDate: '2040-01-01' })).toEqual({
        ok: false,
        error: 'plan_too_long',
      });
    });
  });

  it('maps a plan onto obligation rows with EAT deadlines and per-row amounts', () => {
    const plan = daily('2026-08-01', '2026-08-02');
    plan[1]!.amount = 12_000;
    const rows = planToObligations(plan, '18:00');
    expect(rows).toEqual([
      { dueDate: '2026-08-01', dueAtUtc: '2026-08-01T15:00:00.000Z', localDueTime: '18:00', amount: 10_000 },
      { dueDate: '2026-08-02', dueAtUtc: '2026-08-02T15:00:00.000Z', localDueTime: '18:00', amount: 12_000 },
    ]);
  });
});
