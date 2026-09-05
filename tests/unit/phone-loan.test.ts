import { describe, it, expect } from 'vitest';
import {
  computePhoneLoan,
  phoneLoanSchedule,
  leaseStartAfterPhoneLoan,
  splitLoanTotal,
  describePhoneLoan,
  DEFAULT_PHONE_INTEREST_BPS,
  PhoneLoanError,
} from '@/lib/loans/phone';

describe('computePhoneLoan — the worked example from the brief', () => {
  it('600,000 at 50% over 3 months = 3 x 300,000', () => {
    const t = computePhoneLoan({ principal: 600_000, termMonths: 3 });
    expect(t.interestAmount).toBe(300_000);
    expect(t.totalAmount).toBe(900_000);
    expect(t.instalments).toEqual([300_000, 300_000, 300_000]);
    expect(t.interestBps).toBe(DEFAULT_PHONE_INTEREST_BPS);
  });

  it('puts the remainder on the LAST instalment so the total is exact', () => {
    const t = computePhoneLoan({ principal: 100_001, termMonths: 3 });
    expect(t.totalAmount).toBe(150_002); // 100,001 + 50,000.5 rounded
    expect(t.instalments.reduce((s, a) => s + a, 0)).toBe(t.totalAmount);
    expect(t.instalments[2]).toBeGreaterThanOrEqual(t.instalments[0]!);
  });

  it('accepts 1 and 2 month terms', () => {
    expect(computePhoneLoan({ principal: 200_000, termMonths: 1 }).instalments).toEqual([300_000]);
    expect(computePhoneLoan({ principal: 200_000, termMonths: 2 }).instalments).toEqual([
      150_000, 150_000,
    ]);
  });

  it('refuses a term longer than 3 months and a non-positive principal', () => {
    expect(() => computePhoneLoan({ principal: 600_000, termMonths: 4 })).toThrow(PhoneLoanError);
    expect(() => computePhoneLoan({ principal: 0 })).toThrow(PhoneLoanError);
    expect(() => computePhoneLoan({ principal: -1 })).toThrow(PhoneLoanError);
  });
});

describe('phoneLoanSchedule', () => {
  it('bills monthly starting one month after the contract starts', () => {
    const t = computePhoneLoan({ principal: 600_000, termMonths: 3 });
    expect(phoneLoanSchedule(t, '2026-03-10').map((i) => i.dueDate)).toEqual([
      '2026-04-10',
      '2026-05-10',
      '2026-06-10',
    ]);
  });

  it('clamps to the end of a short month', () => {
    const t = computePhoneLoan({ principal: 300_000, termMonths: 1 });
    expect(phoneLoanSchedule(t, '2026-01-31')[0]!.dueDate).toBe('2026-02-28');
  });
});

describe('leaseStartAfterPhoneLoan', () => {
  it('starts the lease the day after the final instalment', () => {
    expect(leaseStartAfterPhoneLoan('2026-03-10', 3)).toBe('2026-06-11');
  });

  it('never collides with the last loan instalment', () => {
    const t = computePhoneLoan({ principal: 600_000, termMonths: 3 });
    const last = phoneLoanSchedule(t, '2026-03-10').at(-1)!.dueDate;
    expect(leaseStartAfterPhoneLoan('2026-03-10', 3) > last).toBe(true);
  });
});

describe('splitLoanTotal', () => {
  it('reproduces the instalments stored on the loan', () => {
    const t = computePhoneLoan({ principal: 600_000, termMonths: 3 });
    expect(splitLoanTotal(t.totalAmount, t.termMonths)).toEqual(t.instalments);
  });

  it('rejects an invalid term', () => {
    expect(() => splitLoanTotal(900_000, 0)).toThrow(PhoneLoanError);
    expect(() => splitLoanTotal(900_000, 4)).toThrow(PhoneLoanError);
  });
});

describe('describePhoneLoan', () => {
  it('spells out principal, interest, total and the monthly figure', () => {
    const t = computePhoneLoan({ principal: 600_000, termMonths: 3 });
    expect(describePhoneLoan(t)).toContain('600,000');
    expect(describePhoneLoan(t)).toContain('50%');
    expect(describePhoneLoan(t)).toContain('900,000');
    expect(describePhoneLoan(t)).toContain('300,000/month');
  });
});
