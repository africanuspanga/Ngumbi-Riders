import { describe, expect, it } from 'vitest';
import {
  planReschedule,
  rescheduleMath,
  RescheduleError,
  addDays,
  type RescheduleObligation,
} from '@/lib/contracts/reschedule';

/** A daily calendar of `n` days from `start`, all at `amount`. */
function dailyDays(
  start: string,
  n: number,
  amount = 10_000,
  status = 'scheduled',
  kind = 'lease',
): RescheduleObligation[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${kind}-${status}-${addDays(start, i)}`,
    dueDate: addDays(start, i),
    amountDue: amount,
    status,
    kind,
  }));
}

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const sum = (p: ReturnType<typeof planReschedule>) =>
  p.updates.reduce((s, u) => s + u.amount, 0) + p.inserts.reduce((s, u) => s + u.amount, 0);

const TODAY = '2026-10-30'; // a Friday

describe('rescheduleMath', () => {
  it('splits a total into full instalments plus a smaller last one', () => {
    expect(rescheduleMath(1_600_000, 70_000)).toEqual({ instalmentCount: 23, lastAmount: 60_000 });
    expect(rescheduleMath(1_400_000, 70_000)).toEqual({ instalmentCount: 20, lastAmount: 70_000 });
    expect(rescheduleMath(0, 70_000)).toEqual({ instalmentCount: 0, lastAmount: 0 });
  });
  it('refuses a non-positive instalment', () => {
    expect(() => rescheduleMath(100, 0)).toThrow(RescheduleError);
  });
});

describe('planReschedule — daily → weekly (the NGR-C-0005 case)', () => {
  // Paid history, two arrears, today due, then 160 future days.
  const obligations = [
    ...dailyDays('2026-09-01', 57, 10_000, 'paid'),
    ...dailyDays('2026-10-28', 2, 10_000, 'overdue'),
    ...dailyDays(TODAY, 1, 10_000, 'due'),
    ...dailyDays('2026-10-31', 160),
  ];
  const plan = planReschedule({
    obligations,
    today: TODAY,
    cadence: { scheduleType: 'weekly', selectedWeekdays: [6] }, // Saturdays
    instalment: 70_000,
    deadlineTime: '18:00',
  });

  it('conserves the money owed on future days to the shilling', () => {
    expect(plan.scopeTotal).toBe(1_600_000);
    expect(sum(plan)).toBe(1_600_000);
    expect(plan.instalmentCount).toBe(23);
    expect(plan.lastAmount).toBe(1_600_000 - 22 * 70_000); // 60,000
  });

  it('puts every instalment on the chosen weekday, after today', () => {
    const dates = [
      ...plan.updates.map((u) => obligations.find((o) => o.id === u.id)!.dueDate),
      ...plan.inserts.map((i) => i.dueDate),
    ];
    expect(dates.every((d) => weekday(d) === 6 && d > TODAY)).toBe(true);
    expect(plan.firstDate).toBe('2026-10-31');
  });

  it('never touches paid days, arrears or today', () => {
    const touched = new Set([...plan.cancelIds, ...plan.updates.map((u) => u.id)]);
    for (const o of obligations) {
      if (o.status !== 'scheduled') expect(touched.has(o.id)).toBe(false);
    }
  });

  it('covers every future scheduled day exactly once', () => {
    const ids = [...plan.cancelIds, ...plan.updates.map((u) => u.id)].sort();
    const scope = obligations.filter((o) => o.status === 'scheduled').map((o) => o.id).sort();
    expect(ids).toEqual(scope);
  });

  it('keeps existing days that land on a chosen date instead of colliding', () => {
    // Every Saturday inside the old daily calendar already had a row.
    expect(plan.updates.length).toBeGreaterThan(0);
    const insertDates = new Set(plan.inserts.map((i) => i.dueDate));
    for (const o of obligations) expect(insertDates.has(o.dueDate)).toBe(false);
  });
});

describe('planReschedule — daily → monthly', () => {
  it('re-cuts into 30-day instalments on the due day', () => {
    const obligations = dailyDays('2026-10-31', 160);
    const plan = planReschedule({
      obligations,
      today: TODAY,
      cadence: { scheduleType: 'monthly', dueDayOfMonth: 5 },
      instalment: 300_000,
      deadlineTime: '18:00',
    });
    expect(plan.instalmentCount).toBe(6);
    expect(plan.lastAmount).toBe(100_000);
    expect(sum(plan)).toBe(1_600_000);
    expect(plan.firstDate).toBe('2026-11-05');
    expect(plan.lastDate).toBe('2027-04-05');
    expect(plan.endDate).toBe('2027-04-05');
  });
});

describe('planReschedule — dates it may not use', () => {
  it('skips a date held by an advance payment', () => {
    const obligations = [
      ...dailyDays('2026-10-31', 1, 10_000, 'paid_in_advance'), // Saturday, paid
      ...dailyDays('2026-11-01', 20),
    ];
    const plan = planReschedule({
      obligations,
      today: TODAY,
      cadence: { scheduleType: 'weekly', selectedWeekdays: [6] },
      instalment: 70_000,
      deadlineTime: '18:00',
    });
    expect(plan.firstDate).toBe('2026-11-07');
    expect(sum(plan)).toBe(200_000);
  });

  it('leaves phone-loan instalments alone', () => {
    const obligations = [
      ...dailyDays('2026-11-07', 1, 50_000, 'scheduled', 'phone_loan'),
      ...dailyDays('2026-10-31', 14),
    ];
    const plan = planReschedule({
      obligations,
      today: TODAY,
      cadence: { scheduleType: 'weekly', selectedWeekdays: [6] },
      instalment: 70_000,
      deadlineTime: '18:00',
    });
    expect(plan.scopeTotal).toBe(140_000);
    expect(plan.cancelIds.some((id) => id.startsWith('phone_loan'))).toBe(false);
    expect(plan.inserts.some((i) => i.dueDate === '2026-11-07')).toBe(false);
  });

  it('refuses when nothing is left to change', () => {
    expect(() =>
      planReschedule({
        obligations: dailyDays('2026-10-01', 30, 10_000, 'paid'),
        today: TODAY,
        cadence: { scheduleType: 'weekly', selectedWeekdays: [6] },
        instalment: 70_000,
        deadlineTime: '18:00',
      }),
    ).toThrow(RescheduleError);
  });

  it('refuses a weekly cadence without exactly one weekday', () => {
    expect(() =>
      planReschedule({
        obligations: dailyDays('2026-10-31', 10),
        today: TODAY,
        cadence: { scheduleType: 'weekly', selectedWeekdays: [1, 2] },
        instalment: 70_000,
        deadlineTime: '18:00',
      }),
    ).toThrow(RescheduleError);
  });
});

describe('planReschedule — weekly → daily', () => {
  it('turns weekly instalments back into daily ones', () => {
    const obligations: RescheduleObligation[] = [0, 1, 2].map((w) => ({
      id: `w${w}`,
      dueDate: addDays('2026-10-31', w * 7),
      amountDue: 70_000,
      status: 'scheduled',
      kind: 'lease',
    }));
    const plan = planReschedule({
      obligations,
      today: TODAY,
      cadence: { scheduleType: 'daily' },
      instalment: 10_000,
      deadlineTime: '18:00',
    });
    expect(plan.instalmentCount).toBe(21);
    expect(plan.updates.map((u) => u.id).sort()).toEqual(['w0', 'w1', 'w2']);
    expect(plan.cancelIds).toEqual([]);
    expect(sum(plan)).toBe(210_000);
  });
});
