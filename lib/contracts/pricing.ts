/*
 * Instalment pricing from the agreed DAILY rate (client feedback 2026-09-05).
 *
 * The Director agrees ONE number with a rider — the daily rate, e.g. TZS
 * 10,000/day. Everything else follows from the cadence and must not be typed a
 * second time:
 *
 *   daily             → 10,000 per payment   (1 day per payment)
 *   weekly            → 70,000 per payment   (10,000 × 7)
 *   monthly           → 300,000 per payment  (10,000 × 30)
 *   custom weekdays   → 10,000 per payment   (each chosen day is one day's rate;
 *                       the TERM is extended instead — see payment-days.ts)
 *
 * A month is priced as a flat 30 days on purpose: the instalment has to be one
 * predictable number a rider can memorise, and billing 31,000-worth in January
 * and 28,000-worth in February for the same lease is not how these leases are
 * sold. Calendar arithmetic (when the payment is DUE) stays exact — only the
 * PRICE uses the 30-day month.
 *
 * Pure and dependency-free so the arithmetic is unit tested. Integer TZS only.
 */

import type { ScheduleType } from '@/lib/supabase/types';

/** How many days of lease one payment covers, per cadence. */
export const DAYS_PER_PAYMENT: Record<ScheduleType, number> = {
  daily: 1,
  selected_weekdays: 1,
  weekly: 7,
  monthly: 30,
};

/** The instalment implied by a daily rate. Returns 0 for a missing rate. */
export function instalmentFromDailyRate(
  dailyRate: number | null | undefined,
  scheduleType: ScheduleType,
): number {
  const rate = Math.round(Number(dailyRate));
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return rate * (DAYS_PER_PAYMENT[scheduleType] ?? 1);
}

/**
 * The daily rate implied by an instalment — used to pre-fill the editor for
 * contracts created before the daily rate existed. Returns null when the
 * instalment is not a whole multiple of the cadence, because inventing a
 * fractional daily rate would misprice every later edit.
 */
export function dailyRateFromInstalment(
  installmentAmount: number | null | undefined,
  scheduleType: ScheduleType,
): number | null {
  const amount = Math.round(Number(installmentAmount));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const days = DAYS_PER_PAYMENT[scheduleType] ?? 1;
  return amount % days === 0 ? amount / days : null;
}

/** "TZS 10,000 × 7 days = TZS 70,000 per week" — shown next to the field. */
export function explainInstalment(
  dailyRate: number | null | undefined,
  scheduleType: ScheduleType,
): string | null {
  const rate = Math.round(Number(dailyRate));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const days = DAYS_PER_PAYMENT[scheduleType] ?? 1;
  const n = (v: number) => v.toLocaleString('en-US');
  if (scheduleType === 'daily') return `TZS ${n(rate)} per day.`;
  if (scheduleType === 'selected_weekdays') {
    return `TZS ${n(rate)} on each chosen day — the term is extended until every payment day has been collected.`;
  }
  const unit = scheduleType === 'weekly' ? 'week' : 'month';
  return `TZS ${n(rate)} × ${days} days = TZS ${n(rate * days)} per ${unit}.`;
}
