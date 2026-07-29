import { describe, it, expect } from 'vitest';
import {
  addDuration,
  contractEndDateFor,
  durationFromDates,
  durationInMonths,
  endDateFromDuration,
  formatDuration,
  monthlyInstalmentCount,
  normalizeDuration,
  totalDaysBetween,
  DurationError,
  ZERO_DURATION,
} from '@/lib/contracts/duration';

const d = (p: Partial<typeof ZERO_DURATION>) => ({ ...ZERO_DURATION, ...p });

describe('flexible contract duration (spec #9)', () => {
  it('adds whole months on the calendar, not in 30-day blocks', () => {
    // Feb is short; a "1 month" term from 01/01 must end 31/01, and from 01/02
    // must end 28/02 — never a fixed 30 days.
    expect(endDateFromDuration('2026-01-01', d({ months: 1 }))).toBe('2026-01-31');
    expect(endDateFromDuration('2026-02-01', d({ months: 1 }))).toBe('2026-02-28');
    expect(endDateFromDuration('2026-04-01', d({ months: 1 }))).toBe('2026-04-30');
  });

  it('handles leap years', () => {
    // 2028 is a leap year: February has 29 days.
    expect(endDateFromDuration('2028-02-01', d({ months: 1 }))).toBe('2028-02-29');
    // 29 Feb + 1 year clamps to 28 Feb in the non-leap year that follows.
    expect(addDuration('2028-02-29', d({ years: 1 }))).toBe('2029-02-28');
    expect(totalDaysBetween('2028-01-01', '2028-12-31')).toBe(366);
    expect(totalDaysBetween('2026-01-01', '2026-12-31')).toBe(365);
  });

  it('supports days, weeks, months and years on their own', () => {
    expect(endDateFromDuration('2026-08-01', d({ days: 90 }))).toBe('2026-10-29');
    expect(endDateFromDuration('2026-08-01', d({ weeks: 12 }))).toBe('2026-10-23');
    expect(endDateFromDuration('2026-08-01', d({ months: 3 }))).toBe('2026-10-31');
    expect(endDateFromDuration('2026-08-01', d({ years: 1 }))).toBe('2027-07-31');
  });

  it('combines units, applying calendar units before fixed ones', () => {
    // 3 months and 2 weeks from 01/08/2026 → 01/11 + 14d = 15/11, minus a day.
    expect(endDateFromDuration('2026-08-01', d({ months: 3, weeks: 2 }))).toBe('2026-11-14');
    // 6 months, 1 week and 4 days from 31/01/2026 → 31/07 + 11d = 11/08 − 1d.
    expect(endDateFromDuration('2026-01-31', d({ months: 6, weeks: 1, days: 4 }))).toBe('2026-08-10');
    // 1 year and 3 months.
    expect(endDateFromDuration('2026-08-01', d({ years: 1, months: 3 }))).toBe('2027-10-31');
  });

  it('clamps a month-end start to the target month length', () => {
    expect(addDuration('2026-01-31', d({ months: 1 }))).toBe('2026-02-28');
    expect(addDuration('2026-03-31', d({ months: 1 }))).toBe('2026-04-30');
  });

  it('rejects an empty duration rather than making a one-day lease', () => {
    expect(() => endDateFromDuration('2026-08-01', ZERO_DURATION)).toThrow(DurationError);
  });

  it('rejects absurd terms', () => {
    expect(() => endDateFromDuration('2026-08-01', d({ years: 20 }))).toThrow(DurationError);
  });

  it('lets an exact end date override the computed one', () => {
    expect(
      contractEndDateFor({ startDate: '2026-01-31', duration: d({ months: 1 }), exactEndDate: '2026-02-28' }),
    ).toBe('2026-02-28');
    // No override → derived.
    expect(contractEndDateFor({ startDate: '2026-01-31', duration: d({ months: 1 }) })).toBe('2026-02-27');
  });

  it('refuses an end date before the start date', () => {
    expect(() =>
      contractEndDateFor({ startDate: '2026-08-01', duration: d({ months: 1 }), exactEndDate: '2026-07-01' }),
    ).toThrow(DurationError);
  });

  it('derives a structured duration from an exact date pair', () => {
    expect(durationFromDates('2026-08-01', '2026-10-31')).toEqual(d({ months: 3 }));
    expect(durationFromDates('2026-08-01', '2026-11-14')).toEqual(d({ months: 3, weeks: 2 }));
    expect(durationFromDates('2026-08-01', '2027-10-31')).toEqual(d({ years: 1, months: 3 }));
    expect(durationFromDates('2026-08-01', '2026-08-10')).toEqual(d({ weeks: 1, days: 3 }));
  });

  it('re-derives a term that lands on the same end date', () => {
    // durationFromDates is canonical (greedy: months, then weeks, then days),
    // so it is not a literal inverse — "12 weeks" comes back as "2 months,
    // 3 weeks and 2 days". What must hold is that the derived term describes
    // the SAME span, which is what the contract stores and displays.
    for (const term of [
      d({ months: 3 }),
      d({ weeks: 12 }),
      d({ days: 90 }),
      d({ years: 1, months: 3, weeks: 1 }),
      d({ months: 6, weeks: 1, days: 4 }),
    ]) {
      const end = endDateFromDuration('2026-08-01', term);
      const derived = durationFromDates('2026-08-01', end);
      expect(endDateFromDuration('2026-08-01', derived)).toBe(end);
    }
  });

  it('keeps month-based terms in their canonical month form', () => {
    expect(durationFromDates('2026-08-01', endDateFromDuration('2026-08-01', d({ months: 3 })))).toEqual(
      d({ months: 3 }),
    );
    expect(
      durationFromDates('2026-08-01', endDateFromDuration('2026-08-01', d({ years: 1, months: 3, weeks: 1 }))),
    ).toEqual(d({ years: 1, months: 3, weeks: 1 }));
  });

  it('formats a readable term', () => {
    expect(formatDuration(d({ months: 3 }))).toBe('3 months');
    expect(formatDuration(d({ months: 1 }))).toBe('1 month');
    expect(formatDuration(d({ months: 6, weeks: 1, days: 4 }))).toBe('6 months, 1 week and 4 days');
    expect(formatDuration(d({ years: 1, months: 3 }))).toBe('1 year and 3 months');
    expect(formatDuration(ZERO_DURATION)).toBe('—');
  });

  it('normalises loose form input', () => {
    expect(normalizeDuration({ years: '1', months: '', weeks: undefined, days: '4' })).toEqual(
      d({ years: 1, days: 4 }),
    );
    expect(normalizeDuration({ months: -3 })).toEqual(ZERO_DURATION);
    expect(normalizeDuration(null)).toEqual(ZERO_DURATION);
    expect(durationInMonths(d({ years: 2, months: 3 }))).toBe(27);
  });

  it('counts monthly instalments from the month component when there is one', () => {
    expect(
      monthlyInstalmentCount({
        startDate: '2026-08-01',
        endDate: '2027-07-31',
        duration: d({ years: 1 }),
        dueDayOfMonth: 5,
      }),
    ).toBe(12);
  });

  it('falls back to counting due days for a week/day-only term', () => {
    // 01/08/2026 → 29/10/2026 (90 days), due on the 5th: Aug, Sep, Oct = 3.
    expect(
      monthlyInstalmentCount({
        startDate: '2026-08-01',
        endDate: '2026-10-29',
        duration: d({ days: 90 }),
        dueDayOfMonth: 5,
      }),
    ).toBe(3);
    // Due day already passed in the first month → that month does not count.
    expect(
      monthlyInstalmentCount({
        startDate: '2026-08-10',
        endDate: '2026-10-29',
        duration: d({ days: 81 }),
        dueDayOfMonth: 5,
      }),
    ).toBe(2);
  });
});
