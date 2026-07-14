import { z } from 'zod';

/*
 * Contract builder validation (spec §10.1). Duration is captured in months and
 * the inclusive end date is derived by the schedule engine. Amount is the legal
 * snapshot copied from settings and remains editable before activation (§3.3).
 */
export const contractBuilderSchema = z
  .object({
    riderId: z.string().uuid('Select a rider'),
    motorcycleId: z.string().uuid('Select a motorcycle'),
    ownershipTransfers: z.boolean().default(false),
    ownershipTransferNotes: z.string().trim().max(1000).optional().or(z.literal('')),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date'),
    durationMonths: z.coerce.number().int().min(1).max(60),
    scheduleType: z.enum(['daily', 'selected_weekdays']),
    selectedWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
    installmentAmount: z.coerce.number().int().positive('Amount must be greater than 0'),
    paymentDeadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time'),
    specialTerms: z.string().trim().max(2000).optional().or(z.literal('')),
  })
  .refine(
    (v) => v.scheduleType !== 'selected_weekdays' || v.selectedWeekdays.length > 0,
    { message: 'Select at least one weekday', path: ['selectedWeekdays'] },
  );

export type ContractBuilderInput = z.infer<typeof contractBuilderSchema>;
// Pre-coercion shape (number fields arrive as strings from form inputs).
export type ContractBuilderFormInput = z.input<typeof contractBuilderSchema>;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
