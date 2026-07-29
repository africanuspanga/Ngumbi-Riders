import { z } from 'zod';

/*
 * Accountant account creation (build spec #10). The owner sets an initial
 * password which the accountant should change; there is no self-signup and no
 * public invite link — the owner creates the account from their dashboard.
 */

// Deliberately stricter than the rider PIN rules: this is a full email/password
// back-office login with access to the whole payment ledger.
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Too long')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Include an uppercase letter, a lowercase letter and a number',
  });

export const createAccountantSchema = z.object({
  fullName: z.string().trim().min(2, 'Required').max(120),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password,
});

export type CreateAccountantInput = z.infer<typeof createAccountantSchema>;

export const resetAccountantPasswordSchema = z.object({
  profileId: z.string().uuid(),
  password,
});

export type ResetAccountantPasswordInput = z.infer<typeof resetAccountantPasswordSchema>;
