/*
 * Flexible contract duration (build spec #9/#15). A lease term is expressed as
 * any combination of years, months, weeks and days — "3 months", "12 weeks",
 * "90 days", "3 months and 2 weeks", "6 months, 1 week and 4 days",
 * "1 year and 3 months" — or as an exact end date typed by the owner.
 *
 * Pure and dependency-free so every rule is unit tested. Two invariants:
 *
 *   1. Calendar units are calendar units. A month is NOT 30 days: adding months
 *      lands on the same day-of-month in the target month (clamped to that
 *      month's real length), and February keeps 28/29 days. Years are added as
 *      12 months, so 29 Feb + 1 year clamps to 28 Feb in a non-leap year.
 *   2. Fixed units are fixed. Weeks and days are exact multiples of 24h in the
 *      UTC-midnight arithmetic used here, applied AFTER the calendar units so
 *      "1 month and 5 days" reads left to right.
 *
 * End-date convention (unchanged from the original month-only engine, so live
 * contracts keep their dates): the stored `end_date` is INCLUSIVE and equals
 * `start + duration − 1 day`. A 1-month lease starting 01/01 ends 31/01. Where a
 * month-end start clamps (31/01 + 1 month → 28/02 → end 27/02), the owner can
 * override with an exact end date — see `contractEndDateFor`.
 */

export type DurationUnit = 'years' | 'months' | 'weeks' | 'days';

export const DURATION_UNITS: DurationUnit[] = ['years', 'months', 'weeks', 'days'];

/** A term as its four components. All non-negative; at least one must be > 0. */
export type ContractDuration = {
  years: number;
  months: number;
  weeks: number;
  days: number;
};

export const ZERO_DURATION: ContractDuration = { years: 0, months: 0, weeks: 0, days: 0 };

export class DurationError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Safety cap — a lease longer than this is a typo, not a business case. */
const MAX_TOTAL_DAYS = 366 * 10;

const daysInMonth = (year: number, monthIdx0: number): number =>
  new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();

function toUtcMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Coerce loose form input (strings, undefined, NaN) into a clean duration. */
export function normalizeDuration(input: Partial<Record<DurationUnit, unknown>> | null | undefined): ContractDuration {
  const num = (v: unknown): number => {
    if (v === '' || v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return {
    years: num(input?.years),
    months: num(input?.months),
    weeks: num(input?.weeks),
    days: num(input?.days),
  };
}

export function isZeroDuration(d: ContractDuration): boolean {
  return d.years === 0 && d.months === 0 && d.weeks === 0 && d.days === 0;
}

/** Whole calendar months in the term (years folded in). Weeks/days ignored. */
export function durationInMonths(d: ContractDuration): number {
  return d.years * 12 + d.months;
}

/**
 * Add a duration to a calendar date and return the EXCLUSIVE next date, i.e.
 * the first day that is no longer inside the term. Calendar units first
 * (clamped per month), then the fixed week/day offset.
 */
export function addDuration(startDate: string, duration: ContractDuration): string {
  if (!DATE_RE.test(startDate)) throw new DurationError('Invalid start date');
  const d = normalizeDuration(duration);

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const totalMonths = (sm! - 1) + durationInMonths(d);
  const year = sy! + Math.floor(totalMonths / 12);
  const monthIdx = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(sd!, daysInMonth(year, monthIdx));

  const afterMonths = Date.UTC(year, monthIdx, day);
  return formatUtcDate(afterMonths + (d.weeks * 7 + d.days) * DAY_MS);
}

/**
 * The INCLUSIVE end date to store on the contract: start + duration − 1 day.
 * Throws when the duration is empty or absurdly long — a contract with no term
 * must never silently become a one-day lease.
 */
export function endDateFromDuration(startDate: string, duration: ContractDuration): string {
  const d = normalizeDuration(duration);
  if (isZeroDuration(d)) throw new DurationError('Duration must be at least one day');
  const exclusive = addDuration(startDate, d);
  const end = formatUtcDate(toUtcMidnight(exclusive) - DAY_MS);
  if (totalDaysBetween(startDate, end) > MAX_TOTAL_DAYS) {
    throw new DurationError('Duration is too long');
  }
  return end;
}

/** Inclusive day count between two calendar dates (start and end both count). */
export function totalDaysBetween(startDate: string, endDate: string): number {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new DurationError('Invalid date');
  }
  return Math.round((toUtcMidnight(endDate) - toUtcMidnight(startDate)) / DAY_MS) + 1;
}

/**
 * The contract's inclusive end date: the owner's exact date when they typed
 * one, otherwise derived from the duration. `exactEndDate` wins because the
 * owner may need a term the calendar arithmetic cannot express (e.g. a
 * month-end lease that should run to the last day of the month).
 */
export function contractEndDateFor(opts: {
  startDate: string;
  duration: ContractDuration;
  exactEndDate?: string | null;
}): string {
  if (opts.exactEndDate) {
    if (!DATE_RE.test(opts.exactEndDate)) throw new DurationError('Invalid end date');
    if (opts.exactEndDate < opts.startDate) throw new DurationError('End date is before start date');
    if (totalDaysBetween(opts.startDate, opts.exactEndDate) > MAX_TOTAL_DAYS) {
      throw new DurationError('Duration is too long');
    }
    return opts.exactEndDate;
  }
  return endDateFromDuration(opts.startDate, opts.duration);
}

/**
 * Derive the duration components implied by an exact start/end pair, so a
 * manually-entered end date still stores (and displays) a structured term.
 * Greedy: whole years, then whole months, then whole weeks, then leftover days.
 */
export function durationFromDates(startDate: string, endDate: string): ContractDuration {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new DurationError('Invalid date');
  }
  if (endDate < startDate) throw new DurationError('End date is before start date');

  // The term covers [start, end] inclusive, so it "ends" the following day.
  const exclusiveMs = toUtcMidnight(endDate) + DAY_MS;

  let months = 0;
  while (toUtcMidnight(addDuration(startDate, { ...ZERO_DURATION, months: months + 1 })) <= exclusiveMs) {
    months++;
  }
  const afterMonths = toUtcMidnight(addDuration(startDate, { ...ZERO_DURATION, months }));
  const leftoverDays = Math.round((exclusiveMs - afterMonths) / DAY_MS);

  return {
    years: Math.floor(months / 12),
    months: months % 12,
    weeks: Math.floor(leftoverDays / 7),
    days: leftoverDays % 7,
  };
}

const UNIT_LABEL: Record<DurationUnit, [singular: string, plural: string]> = {
  years: ['year', 'years'],
  months: ['month', 'months'],
  weeks: ['week', 'weeks'],
  days: ['day', 'days'],
};

/**
 * Readable term, e.g. "6 months, 1 week and 4 days". Zero components are
 * dropped; an empty duration reads as "—".
 */
export function formatDuration(duration: ContractDuration): string {
  const d = normalizeDuration(duration);
  const parts = DURATION_UNITS.filter((u) => d[u] > 0).map((u) => {
    const [one, many] = UNIT_LABEL[u];
    return `${d[u]} ${d[u] === 1 ? one : many}`;
  });
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Number of monthly instalments for a monthly-schedule contract. Month-based
 * terms give exactly that many (the D-032 rule: a 12-month contract makes 12
 * monthly payments). A term expressed only in weeks/days has no month count, so
 * it falls back to how many due-day occurrences actually fit in the date range.
 */
export function monthlyInstalmentCount(opts: {
  startDate: string;
  endDate: string;
  duration: ContractDuration;
  dueDayOfMonth: number;
}): number {
  const months = durationInMonths(normalizeDuration(opts.duration));
  if (months > 0) return months;

  const [sy, sm, sd] = opts.startDate.split('-').map(Number);
  let count = 0;
  for (let i = 0; i < 240; i++) {
    const total = (sm! - 1) + i;
    const y = sy! + Math.floor(total / 12);
    const mIdx = ((total % 12) + 12) % 12;
    const day = Math.min(opts.dueDayOfMonth, daysInMonth(y, mIdx));
    const due = `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (due > opts.endDate) break;
    if (i === 0 && day < sd!) continue; // due day already passed in month 1
    count++;
  }
  return count;
}
