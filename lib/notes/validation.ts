import { z } from 'zod';

/*
 * Internal financial-note validation (build spec #10).
 *
 * Kept in its own module because `lib/notes/actions.ts` is a `'use server'`
 * file, and such a file may only export async functions — exporting a zod
 * schema from it fails the production build with
 * "A 'use server' file can only export async functions, found object".
 */
export const financialNoteSchema = z.object({
  entityType: z.enum(['rider', 'contract', 'payment', 'motorcycle', 'general']),
  entityId: z.string().uuid().optional().or(z.literal('')),
  body: z.string().trim().min(1, 'Write a note').max(4000, 'Too long'),
});

export type FinancialNoteInput = z.infer<typeof financialNoteSchema>;
