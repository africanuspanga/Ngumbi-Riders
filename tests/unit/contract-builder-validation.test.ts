import { describe, it, expect } from 'vitest';
import { contractBuilderSchema } from '@/lib/contracts/validation';
import { presetOptions, type SelectableObligation } from '@/lib/payments/selection';

/*
 * Regression tests for the 2026-07-18 production-readiness review.
 *
 * 1. RHF keeps the values of UNMOUNTED conditional fields, so a schedule-type
 *    switch can leave weeklyWeekday/dueDayOfMonth as '' — which z.coerce turns
 *    into 0. Before the preprocess fix, a stale '' due day FAILED min(1) with
 *    the error attached to a field that was no longer rendered: the submit
 *    button silently did nothing (the exact silent-failure class that shipped
 *    once already with the zod-v4 resolver).
 * 2. Rider pay presets must be cadence-denominated: "Lipa siku 7" on a monthly
 *    contract would charge SEVEN MONTHS.
 */

const base = {
  riderId: '5f0c9f9a-4b7d-4b1e-9a53-1234567890ab',
  motorcycleId: '5f0c9f9a-4b7d-4b1e-9a53-1234567890ac',
  ownershipTransfers: false,
  startDate: '2026-08-01',
  durationMonths: 6,
  installmentAmount: 10_000,
  paymentDeadlineTime: '18:00',
  selectedWeekdays: [] as number[],
};

describe('contractBuilderSchema — stale empty conditional fields', () => {
  it("a leftover dueDayOfMonth '' does NOT block a daily contract", () => {
    const res = contractBuilderSchema.safeParse({
      ...base,
      scheduleType: 'daily',
      dueDayOfMonth: '', // left behind after switching monthly -> daily
      weeklyWeekday: '',
    });
    expect(res.success).toBe(true);
  });

  it("weeklyWeekday '' does not silently become Sunday", () => {
    const res = contractBuilderSchema.safeParse({
      ...base,
      scheduleType: 'weekly',
      weeklyWeekday: '',
    });
    // '' -> undefined -> the weekly refine fires with a VISIBLE field error.
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join('.') === 'weeklyWeekday')).toBe(true);
    }
  });

  it('a blank monthly due day fails with the custom message on the field', () => {
    const res = contractBuilderSchema.safeParse({
      ...base,
      scheduleType: 'monthly',
      dueDayOfMonth: '',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) => i.path.join('.') === 'dueDayOfMonth');
      expect(issue?.message).toMatch(/monthly due day/i);
    }
  });

  it('valid weekly and monthly configurations still parse', () => {
    expect(
      contractBuilderSchema.safeParse({ ...base, scheduleType: 'weekly', weeklyWeekday: '1' }).success,
    ).toBe(true);
    expect(
      contractBuilderSchema.safeParse({ ...base, scheduleType: 'monthly', dueDayOfMonth: '31' }).success,
    ).toBe(true);
  });
});

describe('presetOptions — cadence-denominated bundles', () => {
  const ob = (dueDate: string, id = dueDate): SelectableObligation => ({
    id,
    dueDate,
    amountDue: 150_000,
    status: 'scheduled',
  });

  it('monthly riders get month-denominated options, never "siku"', () => {
    const obs = ['2026-08-20', '2026-09-20', '2026-10-20', '2026-11-20'].map((d) => ob(d));
    const options = presetOptions(obs, '2026-08-01', 'monthly');
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => !o.label.includes('siku'))).toBe(true);
    // A monthly rider can pay exactly ONE upcoming instalment mid-month.
    const one = options.find((o) => o.count === 1);
    expect(one?.amount).toBe(150_000);
  });

  it('a monthly rider with a single remaining instalment is not blocked', () => {
    const options = presetOptions([ob('2026-08-20')], '2026-08-01', 'monthly');
    expect(options.some((o) => o.count === 1)).toBe(true);
  });

  it('weekly riders get week-denominated options', () => {
    const obs = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'].map((d) => ob(d));
    const options = presetOptions(obs, '2026-08-01', 'weekly');
    expect(options.some((o) => o.label.includes('wiki'))).toBe(true);
    expect(options.every((o) => !o.label.includes('siku'))).toBe(true);
  });

  it('daily behavior is unchanged', () => {
    const obs = Array.from({ length: 14 }, (_, i) =>
      ob(`2026-08-${String(i + 1).padStart(2, '0')}`),
    );
    const options = presetOptions(obs, '2026-08-01', 'daily');
    expect(options.some((o) => o.label === 'Lipa siku 7')).toBe(true);
  });

  it('"Madeni + leo" covers EVERY obligation due today', () => {
    const obs = [
      ob('2026-07-30', 'a'),
      ob('2026-08-01', 'b'),
      ob('2026-08-01', 'c'), // postponement replacement landing on a due day
    ];
    const options = presetOptions(obs, '2026-08-01', 'daily');
    const combo = options.find((o) => o.key === 'arrears_plus_today');
    expect(combo?.count).toBe(3);
  });
});
