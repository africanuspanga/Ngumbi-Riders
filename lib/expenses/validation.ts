import { z } from 'zod';

/*
 * Lightweight motorcycle expense ledger (spec §3.6) — date, category, amount,
 * note. Feeds the maintenance and cash-operating-margin reports. NOT a full
 * workshop module.
 */
export const EXPENSE_CATEGORIES = [
  'maintenance',
  'repair',
  'spare_parts',
  'service',
  'insurance',
  'registration',
  'fuel',
  'other',
] as const;

export const expenseSchema = z.object({
  motorcycleId: z.string().uuid(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().int().positive('Amount must be greater than 0'),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
// Pre-coercion shape (`amount` arrives as a string from the form input).
export type ExpenseFormInput = z.input<typeof expenseSchema>;
