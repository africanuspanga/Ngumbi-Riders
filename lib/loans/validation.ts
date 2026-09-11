import { z } from 'zod';

/*
 * Phone-loan request input (client feedback #11).
 *
 * The AMOUNT and TERM caps are NOT in this schema, because they are settings
 * the Director can change (app_settings, migration 0031) and a schema compiled
 * with 350,000 baked in would go stale the day they change it. They are checked
 * in the server action against the live limits, which is also the only place
 * that can be trusted (spec rule 3).
 *
 * What IS here are the structural rules that can never change: a positive
 * whole-shilling amount, and a term the instalment engine can actually split.
 */
export const phoneLoanRequestSchema = z.object({
  principal: z.coerce
    .number()
    .int('Whole shillings only')
    .positive('Enter how much you need'),
  // 1–3 is a hard ceiling, not a setting: lib/loans/phone.ts only knows how to
  // split a loan across at most three monthly instalments, so a longer term is
  // a code change rather than a configuration change.
  termMonths: z.coerce
    .number()
    .int()
    .min(1, 'Choose a repayment period')
    .max(3, 'A phone loan is repaid within 3 months'),
  deviceDescription: z.string().trim().max(300).optional().or(z.literal('')),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
});

export type PhoneLoanRequestInput = z.infer<typeof phoneLoanRequestSchema>;
/** Pre-coercion shape: both numbers arrive from the form as strings. */
export type PhoneLoanRequestFormInput = z.input<typeof phoneLoanRequestSchema>;

export const decisionNoteSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason').max(1000),
});
