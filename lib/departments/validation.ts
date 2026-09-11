import { z } from 'zod';
import { REQUISITION_ITEM_CATEGORIES } from '@/lib/requisitions/constants';

/*
 * Department, budget and expense input schemas (client feedback #2).
 *
 * The server action re-parses every payload with the SAME schema the form
 * uses — the client-side copy is decoration (spec rule 3). Numeric fields go
 * through `z.coerce` because an <input type="number"> hands react-hook-form a
 * string; any form carrying one must be declared
 * `useForm<FormInput, unknown, Output>` (the /apply resolver incident).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

/** Mirrors the CHECK constraint in 0030 exactly, so the DB never has to say no. */
export const departmentCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Z][A-Z0-9_]{1,31}$/,
    'Use 2–32 capitals, digits or underscores, starting with a letter',
  );

export const departmentSchema = z.object({
  code: departmentCodeSchema,
  name: z.string().trim().min(2, 'Name the department').max(100),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
});

/** Editing: the code is FROZEN (spec rule 15 — an identifier is append-only). */
export const departmentEditSchema = z.object({
  name: z.string().trim().min(2, 'Name the department').max(100),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  isActive: z.boolean(),
});

export const budgetSchema = z
  .object({
    departmentId: z.string().uuid('Choose a department'),
    label: z.string().trim().min(2, 'Name the allocation').max(120),
    periodStart: isoDate,
    periodEnd: isoDate,
    amount: z.coerce
      .number()
      .int('Whole shillings only')
      .positive('Enter the budget amount'),
    note: z.string().trim().max(1000).optional().or(z.literal('')),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: 'The end date cannot be before the start date',
    path: ['periodEnd'],
  });

export const departmentExpenseSchema = z.object({
  departmentId: z.string().uuid('Choose a department'),
  expenseDate: isoDate,
  category: z.enum(REQUISITION_ITEM_CATEGORIES, { message: 'Choose a category' }),
  amount: z.coerce.number().int('Whole shillings only').positive('Enter the amount'),
  description: z.string().trim().min(1, 'Describe the expense').max(300),
  supplier: z.string().trim().max(200).optional().or(z.literal('')),
  reference: z.string().trim().max(120).optional().or(z.literal('')),
  /** Optional link to the purchase the Director approved. */
  requisitionId: z.string().uuid().optional().or(z.literal('')),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;
export type DepartmentEditInput = z.infer<typeof departmentEditSchema>;
export type BudgetInput = z.infer<typeof budgetSchema>;
export type DepartmentExpenseInput = z.infer<typeof departmentExpenseSchema>;

export type BudgetFormInput = z.input<typeof budgetSchema>;
export type DepartmentExpenseFormInput = z.input<typeof departmentExpenseSchema>;
