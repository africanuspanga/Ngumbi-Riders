import { z } from 'zod';

// Shared request schemas — used by both the client forms and the server routes
// so validation can never diverge. Amounts, roles and ids are never accepted
// from the client for auth; only phone + PIN (rider) or email + password (owner).

export const riderLoginSchema = z.object({
  phone: z.string().min(7).max(20),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly four digits'),
});
export type RiderLoginInput = z.infer<typeof riderLoginSchema>;

export const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/),
  newPin: z.string().regex(/^\d{4}$/),
  confirmPin: z.string().regex(/^\d{4}$/),
});
export type ChangePinInput = z.infer<typeof changePinSchema>;

export const ownerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type OwnerLoginInput = z.infer<typeof ownerLoginSchema>;
