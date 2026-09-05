/*
 * Payment-day accounting for custom-weekday contracts (client feedback
 * 2026-09-05).
 *
 * The Director sells a lease as a number of PAYMENT DAYS, not a number of
 * calendar days. A rider who pays on 6 days a week (Mon–Thu, Sat, Sun — no
 * Friday) still owes the full count of payment days, so the term must run on
 * until they have all fallen:
 *
 *   "Juma has taken a one-month contract consisting of 28 payment days. If it
 *    starts 1 March and he only pays 6 days a week, he still has payment days
 *    left after 28 March — so the contract is extended until they are done."
 *
 * Two functions do the whole job:
 *   countPaymentDays  — how many payment days fall inside a date range,
 *   endDateForPaymentDays — the inclusive end date that yields exactly N.
 *
 * Pure and dependency-free so every rule is unit tested. All dates are plain
 * `YYYY-MM-DD` calendar dates handled in UTC-midnight arithmetic, which is
 * exact for Tanzania (EAT, no DST).
 */

export class PaymentDaysError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Safety cap: ~10 years of walking, well past any real lease. */
const MAX_SCAN_DAYS = 366 * 10;

function toUtcMidnight(dateStr: string): number {
  if (!DATE_RE.test(dateStr)) throw new PaymentDaysError('Invalid date');
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Normalise a weekday selection; an empty/absent set means "every day". */
function weekdaySet(weekdays: number[] | null | undefined): Set<number> | null {
  const wd = (weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return wd.length === 0 ? null : new Set(wd);
}

/** Payment days falling in [startDate, endDate] inclusive. */
export function countPaymentDays(
  startDate: string,
  endDate: string,
  weekdays?: number[] | null,
): number {
  const startMs = toUtcMidnight(startDate);
  const endMs = toUtcMidnight(endDate);
  if (endMs < startMs) return 0;
  const keep = weekdaySet(weekdays);
  if (!keep) return Math.round((endMs - startMs) / DAY_MS) + 1;

  let count = 0;
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    if (keep.has(new Date(ms).getUTCDay())) count++;
  }
  return count;
}

/**
 * The inclusive end date on which the Nth payment day falls. The term always
 * ENDS on a payment day, so the contract finishes on the day the last money is
 * collected rather than trailing a few dead days.
 */
export function endDateForPaymentDays(
  startDate: string,
  paymentDays: number,
  weekdays?: number[] | null,
): string {
  const target = Math.round(Number(paymentDays));
  if (!Number.isInteger(target) || target < 1) {
    throw new PaymentDaysError('Payment days must be at least 1');
  }
  const keep = weekdaySet(weekdays);
  const startMs = toUtcMidnight(startDate);
  if (!keep) return formatUtcDate(startMs + (target - 1) * DAY_MS);

  let seen = 0;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const ms = startMs + i * DAY_MS;
    if (keep.has(new Date(ms).getUTCDay())) {
      seen++;
      if (seen === target) return formatUtcDate(ms);
    }
  }
  throw new PaymentDaysError('That number of payment days is too far in the future');
}

export type PaymentDayExtension = {
  /** Payment days the base term would have collected (a daily schedule). */
  targetDays: number;
  /** Payment days the chosen weekdays actually collect in the base term. */
  daysInBaseTerm: number;
  /** The end date after extending so `targetDays` are collected. */
  endDate: string;
  /** Calendar days added to the base term (0 when nothing had to change). */
  extraCalendarDays: number;
};

/**
 * Extend a base term so a custom-weekday schedule still collects every payment
 * day the term was sold for.
 *
 * The target is the number of days in the BASE term — i.e. what a rider paying
 * every day would have paid — because that is what the term's price was built
 * from. With 6 pay-days a week the calendar simply runs longer.
 */
export function extendTermForPaymentDays(opts: {
  startDate: string;
  baseEndDate: string;
  weekdays: number[];
  /** Override the target when the owner typed an explicit payment-day count. */
  targetDays?: number | null;
}): PaymentDayExtension {
  const targetDays =
    opts.targetDays && opts.targetDays > 0
      ? Math.round(opts.targetDays)
      : countPaymentDays(opts.startDate, opts.baseEndDate, null);
  const daysInBaseTerm = countPaymentDays(opts.startDate, opts.baseEndDate, opts.weekdays);
  const endDate = endDateForPaymentDays(opts.startDate, targetDays, opts.weekdays);
  const extraCalendarDays = Math.max(
    0,
    Math.round((toUtcMidnight(endDate) - toUtcMidnight(opts.baseEndDate)) / DAY_MS),
  );
  return { targetDays, daysInBaseTerm, endDate, extraCalendarDays };
}
