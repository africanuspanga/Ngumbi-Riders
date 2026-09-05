import { describe, it, expect } from 'vitest';
import {
  countPaymentDays,
  endDateForPaymentDays,
  extendTermForPaymentDays,
  PaymentDaysError,
} from '@/lib/obligations/payment-days';

// Mon–Thu, Sat, Sun — Friday excluded. This is the client's example: six
// payment days a week.
const SIX_DAYS = [0, 1, 2, 3, 4, 6];

describe('countPaymentDays', () => {
  it('counts every calendar day when no weekdays are given', () => {
    expect(countPaymentDays('2024-03-01', '2024-03-28', null)).toBe(28);
  });

  it('counts only the chosen weekdays', () => {
    // 1–28 March 2024 is exactly four weeks; six pay-days a week = 24.
    expect(countPaymentDays('2024-03-01', '2024-03-28', SIX_DAYS)).toBe(24);
  });

  it('returns 0 when the range is inverted', () => {
    expect(countPaymentDays('2024-03-10', '2024-03-01', null)).toBe(0);
  });
});

describe('endDateForPaymentDays', () => {
  it('is start + N − 1 when every day is a payment day', () => {
    expect(endDateForPaymentDays('2024-03-01', 28, null)).toBe('2024-03-28');
  });

  it('runs past the calendar term when Fridays are excluded', () => {
    // The 28th payment day of a six-day week that starts Fri 1 March 2024
    // (Friday itself excluded) falls on 2 April.
    const end = endDateForPaymentDays('2024-03-01', 28, SIX_DAYS);
    expect(end).toBe('2024-04-02');
    expect(countPaymentDays('2024-03-01', end, SIX_DAYS)).toBe(28);
  });

  it('always ends ON a payment day', () => {
    const end = endDateForPaymentDays('2024-03-01', 10, SIX_DAYS);
    const weekday = new Date(`${end}T00:00:00Z`).getUTCDay();
    expect(SIX_DAYS).toContain(weekday);
  });

  it('rejects a non-positive count', () => {
    expect(() => endDateForPaymentDays('2024-03-01', 0, SIX_DAYS)).toThrow(PaymentDaysError);
  });
});

describe('extendTermForPaymentDays — the Juma case', () => {
  it('extends a 28-day term so all 28 payment days are collected', () => {
    const r = extendTermForPaymentDays({
      startDate: '2024-03-01',
      baseEndDate: '2024-03-28',
      weekdays: SIX_DAYS,
    });
    expect(r.targetDays).toBe(28);
    expect(r.daysInBaseTerm).toBe(24); // four short
    expect(r.endDate).toBe('2024-04-02');
    expect(r.extraCalendarDays).toBe(5);
    expect(countPaymentDays('2024-03-01', r.endDate, SIX_DAYS)).toBe(28);
  });

  it('does not extend when every day is already a payment day', () => {
    const r = extendTermForPaymentDays({
      startDate: '2024-03-01',
      baseEndDate: '2024-03-28',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(r.endDate).toBe('2024-03-28');
    expect(r.extraCalendarDays).toBe(0);
  });

  it('honours an explicit payment-day target over the calendar length', () => {
    const r = extendTermForPaymentDays({
      startDate: '2024-03-01',
      baseEndDate: '2024-03-28',
      weekdays: SIX_DAYS,
      targetDays: 30,
    });
    expect(countPaymentDays('2024-03-01', r.endDate, SIX_DAYS)).toBe(30);
  });
});
