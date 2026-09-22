/*
 * Correcting the price of a live contract.
 *
 * The case that forced this to exist is pinned at the bottom: Alfred Francis
 * Msangi's NGR-C-0012, entered as TZS 10,000 per WEEK when the agreed daily
 * rate of TZS 10,000 makes the weekly instalment TZS 70,000.
 */

import { describe, it, expect } from 'vitest';
import {
  planReprice,
  computeRepriceMath,
  summariseForReprice,
  describeReprice,
  addDaysIso,
  extensionHorizon,
  RepriceError,
  type RepriceObligation,
} from '@/lib/contracts/reprice';
import { instalmentFromDailyRate } from '@/lib/contracts/pricing';

function ob(
  id: string,
  dueDate: string,
  amountDue: number,
  status: RepriceObligation['status'],
): RepriceObligation {
  return { id, dueDate, amountDue, status };
}

describe('planReprice — what changes and what does not', () => {
  it('re-prices unpaid days and leaves settled ones alone', () => {
    const plan = planReprice(
      [
        ob('a', '2026-08-09', 10_000, 'paid'),
        ob('b', '2026-08-16', 10_000, 'scheduled'),
        ob('c', '2026-08-23', 10_000, 'overdue'),
      ],
      70_000,
    );
    expect(plan.repriceIds).toEqual(['b', 'c']);
    expect(plan.unsettledTotalBefore).toBe(20_000);
    expect(plan.unsettledTotalAfter).toBe(140_000);
    expect(plan.settledTotal).toBe(10_000);
  });

  it('re-prices overdue days without moving them out of arrears', () => {
    // Due dates are not in the plan at all — only amounts. An overdue day that
    // is re-priced is still overdue, and still overdue from the same date.
    const plan = planReprice([ob('a', '2026-08-09', 10_000, 'overdue')], 70_000);
    expect(plan.repriceIds).toEqual(['a']);
    expect(plan.unsettledCount).toBe(1);
  });

  it('never re-prices exempted, postponed or cancelled days', () => {
    const plan = planReprice(
      [
        ob('x', '2026-08-09', 10_000, 'exempted'),
        ob('y', '2026-08-16', 10_000, 'postponed'),
        ob('z', '2026-08-23', 10_000, 'cancelled'),
        ob('u', '2026-08-30', 10_000, 'scheduled'),
      ],
      70_000,
    );
    expect(plan.repriceIds).toEqual(['u']);
    expect(plan.unsettledCount).toBe(1);
  });

  it('excludes exempted days from the shortfall — a waiver is not a debt', () => {
    // One paid day and one waived day. Only the PAID one under-collected;
    // charging for the exemption would bill a day the owner forgave.
    const plan = planReprice(
      [ob('p', '2026-08-09', 10_000, 'paid'), ob('e', '2026-08-16', 10_000, 'exempted')],
      70_000,
    );
    expect(plan.settledCount).toBe(1);
    expect(plan.shortfall).toBe(60_000);
  });

  it('counts paid_in_advance as settled history', () => {
    const plan = planReprice([ob('a', '2026-09-20', 10_000, 'paid_in_advance')], 70_000);
    expect(plan.settledCount).toBe(1);
    expect(plan.shortfall).toBe(60_000);
  });

  it('skips days that already carry the corrected amount', () => {
    const plan = planReprice(
      [ob('a', '2026-08-09', 70_000, 'scheduled'), ob('b', '2026-08-16', 10_000, 'scheduled')],
      70_000,
    );
    expect(plan.repriceIds).toEqual(['b']);
    expect(plan.alreadyCorrectIds).toEqual(['a']);
  });

  it('orders the re-priced ids oldest first', () => {
    const plan = planReprice(
      [
        ob('late', '2026-09-06', 10_000, 'scheduled'),
        ob('early', '2026-08-09', 10_000, 'scheduled'),
      ],
      70_000,
    );
    expect(plan.repriceIds).toEqual(['early', 'late']);
  });

  it('rejects a zero or negative instalment', () => {
    expect(() => planReprice([], 0)).toThrow(RepriceError);
    expect(() => planReprice([], -1)).toThrow(RepriceError);
  });
});

describe('planReprice — the shortfall on settled days', () => {
  it('turns the shortfall into whole extra payment days', () => {
    const plan = planReprice(
      [ob('a', '2026-08-09', 10_000, 'paid'), ob('b', '2026-08-16', 10_000, 'paid')],
      70_000,
    );
    expect(plan.shortfall).toBe(120_000); // 2 × 70,000 − 20,000
    expect(plan.extraPaymentDays).toBe(1); // 120,000 / 70,000 = 1 whole day
    expect(plan.unrecovered).toBe(50_000); // the remainder is reported, not rounded away
  });

  it('adds no days when nothing was under-collected', () => {
    const plan = planReprice([ob('a', '2026-08-09', 70_000, 'paid')], 70_000);
    expect(plan.shortfall).toBe(0);
    expect(plan.extraPaymentDays).toBe(0);
    expect(plan.overpaid).toBe(false);
  });

  it('reports an OVERPAYMENT rather than shortening the contract', () => {
    // Priced too high and already collected: there is deliberately no rider
    // credit balance in this system, so the owner is told and decides.
    const plan = planReprice([ob('a', '2026-08-09', 70_000, 'paid')], 10_000);
    expect(plan.overpaid).toBe(true);
    expect(plan.shortfall).toBe(-60_000);
    expect(plan.extraPaymentDays).toBe(0);
  });

  it('has no shortfall when nothing has been settled yet', () => {
    const plan = planReprice([ob('a', '2026-08-09', 10_000, 'scheduled')], 70_000);
    expect(plan.settledCount).toBe(0);
    expect(plan.shortfall).toBe(0);
    expect(plan.extraPaymentDays).toBe(0);
  });
});

describe('NGR-C-0012 — the contract that was reported', () => {
  /*
   * As it stood on the live database on 2026-09-22:
   *   22 weekly payment days, 06/08/2026 → 05/01/2027, priced 10,000/week
   *   7 settled (6 paid + 1 paid_in_advance) = 70,000 collected
   *   15 scheduled = 150,000
   * The agreed daily rate is 10,000, so weekly = 10,000 × 7 = 70,000.
   */
  const obligations: RepriceObligation[] = [
    ...Array.from({ length: 6 }, (_, i) =>
      ob(`paid-${i}`, `2026-08-${String(9 + i * 7).padStart(2, '0')}`, 10_000, 'paid'),
    ),
    ob('adv', '2026-09-20', 10_000, 'paid_in_advance'),
    ...Array.from({ length: 15 }, (_, i) => ob(`sched-${i}`, `2026-09-27`, 10_000, 'scheduled')),
  ];

  const weekly = instalmentFromDailyRate(10_000, 'weekly');

  it('prices the week from the agreed daily rate', () => {
    expect(weekly).toBe(70_000);
  });

  it('produces the owner-approved correction exactly', () => {
    const plan = planReprice(obligations, weekly);

    expect(plan.settledCount).toBe(7);
    expect(plan.settledTotal).toBe(70_000);
    expect(plan.unsettledCount).toBe(15);
    expect(plan.repriceIds).toHaveLength(15);

    // 15 unpaid weeks go 150,000 → 1,050,000
    expect(plan.unsettledTotalBefore).toBe(150_000);
    expect(plan.unsettledTotalAfter).toBe(1_050_000);

    // 7 settled weeks should have brought in 490,000; they brought in 70,000.
    expect(plan.shortfall).toBe(420_000);
    expect(plan.extraPaymentDays).toBe(6); // 420,000 / 70,000, exactly
    expect(plan.unrecovered).toBe(0);

    // Full lease value is preserved: 22 weeks × 70,000.
    expect(plan.contractTotalAfter).toBe(1_540_000);
    expect(plan.contractTotalAfter).toBe(22 * 70_000);
  });
});

describe('describeReprice', () => {
  const plan = planReprice(
    [ob('a', '2026-08-09', 10_000, 'paid'), ob('b', '2026-08-16', 10_000, 'scheduled')],
    70_000,
  );

  it('says what will be added when the shortfall is recovered', () => {
    const text = describeReprice(plan, true);
    expect(text).toContain('TZS 60,000');
    expect(text).toContain('extra');
    expect(text).toContain('NOT changed');
  });

  it('says plainly when the shortfall is being written off', () => {
    expect(describeReprice(plan, false)).toContain('will NOT be recovered');
  });

  it('warns about an overpayment instead of offering to add days', () => {
    const over = planReprice([ob('a', '2026-08-09', 70_000, 'paid')], 10_000);
    expect(describeReprice(over, true)).toContain('MORE than the corrected price');
  });
});

describe('summariseForReprice', () => {
  it('buckets the calendar and ignores everything that is neither owed nor settled', () => {
    expect(
      summariseForReprice([
        ob('a', '2026-08-09', 10_000, 'paid'),
        ob('b', '2026-08-16', 10_000, 'paid_in_advance'),
        ob('c', '2026-08-23', 10_000, 'scheduled'),
        ob('d', '2026-08-30', 10_000, 'due'),
        ob('e', '2026-09-06', 10_000, 'overdue'),
        ob('f', '2026-09-13', 10_000, 'exempted'),
        ob('g', '2026-09-20', 10_000, 'postponed'),
        ob('h', '2026-09-27', 10_000, 'cancelled'),
      ]),
    ).toEqual({
      unsettledCount: 3,
      unsettledTotalBefore: 30_000,
      settledCount: 2,
      settledTotal: 20_000,
    });
  });
});

describe('computeRepriceMath — the preview and the server agree', () => {
  /*
   * The owner's screen previews the correction from four totals; the server
   * plans it from the rows themselves. If these two ever disagreed, the number
   * confirmed on screen would not be the number written — the exact failure
   * `term.ts` exists to prevent for contract dates.
   */
  it('matches planReprice field for field', () => {
    const obligations = [
      ob('a', '2026-08-09', 10_000, 'paid'),
      ob('b', '2026-08-16', 10_000, 'paid'),
      ob('c', '2026-08-23', 10_000, 'scheduled'),
      ob('d', '2026-08-30', 10_000, 'overdue'),
    ];
    const plan = planReprice(obligations, 70_000);
    const math = computeRepriceMath(summariseForReprice(obligations), 70_000);
    const { repriceIds, alreadyCorrectIds, ...planMath } = plan;
    expect(planMath).toEqual(math);
    expect(repriceIds).toHaveLength(2);
    expect(alreadyCorrectIds).toEqual([]);
  });

  it('rejects a zero instalment', () => {
    expect(() =>
      computeRepriceMath(
        { unsettledCount: 1, unsettledTotalBefore: 1, settledCount: 0, settledTotal: 0 },
        0,
      ),
    ).toThrow(RepriceError);
  });
});

describe('addDaysIso', () => {
  it('adds days without a timezone shifting the date', () => {
    expect(addDaysIso('2027-01-05', 1)).toBe('2027-01-06');
  });

  it('crosses a month end', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year end', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('refuses a malformed date rather than inventing one', () => {
    expect(() => addDaysIso('05/01/2027', 1)).toThrow(RepriceError);
  });
});

describe('extensionHorizon', () => {
  it('over-shoots far enough for a weekly cadence to yield N days', () => {
    // 6 weekly days need at least 42 calendar days; the horizon must exceed it.
    expect(extensionHorizon('2027-01-06', 'weekly', 6) > '2027-02-17').toBe(true);
  });

  it('over-shoots for a daily cadence', () => {
    expect(extensionHorizon('2027-01-06', 'daily', 6)).toBe('2027-01-19');
  });

  it('refuses to extend by nothing', () => {
    expect(() => extensionHorizon('2027-01-06', 'weekly', 0)).toThrow(RepriceError);
  });
});
