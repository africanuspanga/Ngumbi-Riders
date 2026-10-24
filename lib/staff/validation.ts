import { z } from 'zod';
import { tryNormalizePhone } from '@/lib/auth/phone';

/*
 * Accountant account creation (build spec #10). The owner sets an initial
 * password which the accountant should change; there is no self-signup and no
 * public invite link — the owner creates the account from their dashboard.
 */

// Deliberately stricter than the rider PIN rules: this is a full email/password
// back-office login with access to the whole payment ledger.
export const staffPassword = z
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
  password: staffPassword,
});

export type CreateAccountantInput = z.infer<typeof createAccountantSchema>;

export const resetAccountantPasswordSchema = z.object({
  profileId: z.string().uuid(),
  password: staffPassword,
});

export type ResetAccountantPasswordInput = z.infer<typeof resetAccountantPasswordSchema>;

export const setAccountantPhoneSchema = z.object({
  profileId: z.string().uuid(),
  phone: staffPhone,
});

/**
 * A staff member changing their OWN password. The current password is
 * required (a walked-away, still-signed-in laptop must not be enough), and the
 * new one must differ from it.
 */
export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: staffPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one',
  });

export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
