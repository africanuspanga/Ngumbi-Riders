import { describe, it, expect } from 'vitest';
import { resolveContractTerm, endDateWithoutPhoneLoan, TermError } from '@/lib/contracts/term';
import { ZERO_DURATION } from '@/lib/contracts/duration';

const base = {
  startDate: '2026-03-01',
  duration: { ...ZERO_DURATION, months: 3 },
  endDateMode: 'duration' as const,
  scheduleType: 'daily' as const,
  selectedWeekdays: [],
};

describe('resolveContractTerm — plain lease', () => {
  it('derives the inclusive end date from the duration', () => {
    const t = resolveContractTerm(base);
    expect(t.leaseStartDate).toBe('2026-03-01');
    expect(t.endDate).toBe('2026-05-31');
    expect(t.phoneLoan).toBeNull();
  });

  it("an exact end date always wins", () => {
    const t = resolveContractTerm({
      ...base,
      endDateMode: 'exact',
      exactEndDate: '2026-04-15',
    });
    expect(t.endDate).toBe('2026-04-15');
  });

  it('refuses an end date before the lease can start', () => {
    expect(() =>
      resolveContractTerm({ ...base, endDateMode: 'exact', exactEndDate: '2026-02-01' }),
    ).toThrow(TermError);
  });
});

describe('resolveContractTerm — phone loan defers the lease', () => {
  const withPhone = {
    ...base,
    phoneLoan: { principal: 600_000, termMonths: 3 },
  };

  it('starts the lease after the loan and pushes the end date out', () => {
    const t = resolveContractTerm(withPhone);
    expect(t.leaseStartDate).toBe('2026-06-02'); // day after the 3rd instalment
    expect(t.phoneLoanExtraMonths).toBe(3);
    expect(t.phoneInstalments.map((i) => i.dueDate)).toEqual([
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ]);
    // The motorcycle-only version of the same lease ends three months earlier.
    expect(endDateWithoutPhoneLoan(withPhone)).toBe('2026-05-31');
    expect(t.endDate > '2026-05-31').toBe(true);
  });

  it('never schedules the lease on the last loan instalment date', () => {
    const t = resolveContractTerm(withPhone);
    expect(t.leaseStartDate > t.phoneInstalments.at(-1)!.dueDate).toBe(true);
  });

  it('rejects a loan longer than three months', () => {
    expect(() =>
      resolveContractTerm({ ...withPhone, phoneLoan: { principal: 600_000, termMonths: 6 } }),
    ).toThrow(TermError);
  });
});

describe('resolveContractTerm — custom weekdays extend the term', () => {
  const custom = {
    ...base,
    scheduleType: 'selected_weekdays' as const,
    selectedWeekdays: [0, 1, 2, 3, 4, 6], // no Friday
    duration: { ...ZERO_DURATION, days: 28 },
    startDate: '2024-03-01',
  };

  it('extends by default so every payment day is collected', () => {
    const t = resolveContractTerm(custom);
    expect(t.baseEndDate).toBe('2024-03-28');
    expect(t.endDate).toBe('2024-04-02');
    expect(t.paymentDays?.targetDays).toBe(28);
    expect(t.paymentDays?.daysInBaseTerm).toBe(24);
  });

  it('leaves the term alone when the owner turns the extension off', () => {
    const t = resolveContractTerm({ ...custom, extendForPaymentDays: false });
    expect(t.endDate).toBe('2024-03-28');
    expect(t.paymentDays?.extraCalendarDays).toBe(0);
  });

  it('accepts an explicit payment-day count', () => {
    const t = resolveContractTerm({
      ...custom,
      endDateMode: 'payment_days',
      paymentDaysTarget: 28,
    });
    expect(t.endDate).toBe('2024-04-02');
  });

  it('requires a payment-day count in that mode', () => {
    expect(() =>
      resolveContractTerm({ ...custom, endDateMode: 'payment_days', paymentDaysTarget: null }),
    ).toThrow(TermError);
  });
});
