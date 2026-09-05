import { z } from 'zod';
import {
  REQUISITION_BUDGET_COVERS,
  REQUISITION_DEPARTMENTS,
  REQUISITION_ITEM_CATEGORIES,
  REQUISITION_UNITS,
} from './constants';

/*
 * The one schema the form and the server action both validate against. The
 * client's copy is decoration: `saveRequisition` re-parses the payload with
 * this exact schema before anything is written (spec rule 3 — never trust a
 * client-supplied amount).
 *
 * `z.coerce.number()` is used for the numeric inputs because an <input
 * type="number"> hands react-hook-form a STRING. Forms carrying coerced fields
 * must be declared `useForm<FormInput, unknown, Output>` — the input/output
 * generics — or the resolver's types silently drift from the runtime shape
 * (the /apply wizard incident, 2026-07-11).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');

export const requisitionItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe the item').max(300),
  category: z.enum(REQUISITION_ITEM_CATEGORIES, { message: 'Choose a category' }),
  quantity: z.coerce
    .number()
    .int('Whole numbers only')
    .positive('At least 1')
    .max(100000, 'That quantity looks wrong'),
  unit: z.enum(REQUISITION_UNITS, { message: 'Choose a unit' }),
  // Integer TZS. Zero is rejected: a line with no price tells the Director
  // nothing about what they are approving.
  unitPrice: z.coerce
    .number()
    .int('Whole shillings only')
    .positive('Enter the unit price'),
  budgetCover: z.enum(REQUISITION_BUDGET_COVERS, { message: 'Choose a budget cover' }),
});

export const requisitionSchema = z.object({
  title: z.string().trim().min(3, 'Give the request a title').max(200),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  department: z.enum(REQUISITION_DEPARTMENTS, { message: 'Choose a department' }),
  requestDate: isoDate,
  paymentInformation: z.string().trim().max(1000).optional().or(z.literal('')),
  // The Managing Director the request is addressed to. Verified server-side to
  // be a real owner account before it is stored.
  approverId: z.string().uuid('Choose an approver'),
  items: z
    .array(requisitionItemSchema)
    .min(1, 'Add at least one item')
    .max(50, 'Split a request this large into several'),
});

export type RequisitionItemInput = z.infer<typeof requisitionItemSchema>;
export type RequisitionInput = z.infer<typeof requisitionSchema>;
// Pre-coercion shape: `quantity` and `unitPrice` arrive from the form as strings.
export type RequisitionFormInput = z.input<typeof requisitionSchema>;

/** Rejection reason for a rejected requisition — the Director must say why. */
export const rejectionSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason').max(1000),
});
