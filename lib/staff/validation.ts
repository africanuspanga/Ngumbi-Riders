import { z } from 'zod';
import { tryNormalizePhone } from '@/lib/auth/phone';

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

// Where the SMS sign-in code goes (D-053). Stored canonical E.164.
const staffPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const phone = tryNormalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return phone;
  });

export const createAccountantSchema = z.object({
  fullName: z.string().trim().min(2, 'Required').max(120),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  phone: staffPhone,
  password,
});

export type CreateAccountantInput = z.infer<typeof createAccountantSchema>;

export const resetAccountantPasswordSchema = z.object({
  profileId: z.string().uuid(),
  password,
});

export type ResetAccountantPasswordInput = z.infer<typeof resetAccountantPasswordSchema>;

export const setAccountantPhoneSchema = z.object({
  profileId: z.string().uuid(),
  phone: staffPhone,
});
