import { z } from 'zod';
import type { ScheduleType } from '@/lib/supabase/types';

/*
 * Contract builder validation (spec §10.1, #8/#13). Duration is captured in
 * months and the inclusive end date is derived by the schedule engine. Amount is
 * the legal snapshot copied from settings and remains editable before activation
 * (§3.3).
 *
 * Schedule types:
 *   daily            — one obligation every calendar day.
 *   selected_weekdays— obligations on the chosen weekdays.
 *   weekly           — one obligation per week on a single chosen weekday
 *                      (stored as a one-element selectedWeekdays array).
 *   monthly          — one obligation per month on `dueDayOfMonth`; exactly
 *                      durationMonths obligations (owner sets a fixed due day).
 */
export const contractBuilderSchema = z
  .object({
    riderId: z.string().uuid('Select a rider'),
    motorcycleId: z.string().uuid('Select a motorcycle'),
    ownershipTransfers: z.boolean().default(false),
    ownershipTransferNotes: z.string().trim().max(1000).optional().or(z.literal('')),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date'),
    durationMonths: z.coerce.number().int().min(1).max(60),
    scheduleType: z.enum(['daily', 'selected_weekdays', 'weekly', 'monthly']),
    selectedWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
    // Weekly only: the single weekday (0=Sun..6=Sat) the payment is due.
    // Empty string MUST become undefined, not a coerced number: RHF keeps the
    // values of unmounted conditional fields, so after switching schedule types
    // a leftover '' would otherwise coerce to 0 (Sunday) — or, for the monthly
    // due day, FAIL min(1) with the error attached to a field that is no longer
    // rendered, silently blocking submit with no visible message (the exact
    // silent-failure class this app shipped once already).
    weeklyWeekday: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.coerce.number().int().min(0).max(6).optional(),
    ),
    // Monthly only: the day-of-month the payment is due (1..31; 31 = last day).
    dueDayOfMonth: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.coerce.number().int().min(1).max(31).optional(),
    ),
    installmentAmount: z.coerce.number().int().positive('Amount must be greater than 0'),
    paymentDeadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time'),
    specialTerms: z.string().trim().max(2000).optional().or(z.literal('')),
  })
  .refine(
    (v) => v.scheduleType !== 'selected_weekdays' || v.selectedWeekdays.length > 0,
    { message: 'Select at least one weekday', path: ['selectedWeekdays'] },
  )
  .refine(
    (v) => v.scheduleType !== 'weekly' || (v.weeklyWeekday !== undefined && v.weeklyWeekday >= 0),
    { message: 'Choose the weekly payment day', path: ['weeklyWeekday'] },
  )
  .refine(
    (v) => v.scheduleType !== 'monthly' || (v.dueDayOfMonth !== undefined && v.dueDayOfMonth >= 1),
    { message: 'Choose the monthly due day (1–31; 31 = last day of month)', path: ['dueDayOfMonth'] },
  );

export type ContractBuilderInput = z.infer<typeof contractBuilderSchema>;
// Pre-coercion shape (number fields arrive as strings from form inputs).
export type ContractBuilderFormInput = z.input<typeof contractBuilderSchema>;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Ordinal suffix for a day-of-month, e.g. 1→"1st", 31→"31st". */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Human-readable schedule description shared by the detail page and the PDF. */
export function scheduleLabel(
  scheduleType: ScheduleType,
  selectedWeekdays: number[],
  dueDayOfMonth: number | null | undefined,
): string {
  switch (scheduleType) {
    case 'daily':
      return 'Every day';
    case 'weekly':
      return `Weekly (${WEEKDAY_LABELS[selectedWeekdays[0] ?? 0]})`;
    case 'monthly':
      return dueDayOfMonth === 31
        ? 'Monthly (last day of month)'
        : `Monthly (${ordinal(dueDayOfMonth ?? 1)} of the month)`;
    case 'selected_weekdays':
    default:
      return selectedWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
  }
}
