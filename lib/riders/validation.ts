import { z } from 'zod';
import { isValidPhone } from '@/lib/auth/phone';

/*
 * Manual rider creation (spec §9.2). The owner adds an existing/new rider
 * directly. NIDA, licence, address and documents may be incomplete for
 * historical riders (a compliance warning is shown until provided), so only
 * name, phone and a temporary PIN are required here.
 */

const name = z.string().trim().min(2, 'Required').max(80);
const optionalText = z.string().trim().max(120).optional().or(z.literal(''));

const optionalNida = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => v === '' || /^\d{20}$/.test(v), {
    message: 'NIDA must be 20 digits',
  })
  .optional()
  .or(z.literal(''));

export const manualRiderSchema = z.object({
  firstName: name,
  middleName: z.string().trim().max(80).optional().or(z.literal('')),
  lastName: name,
  phone: z.string().trim().refine(isValidPhone, { message: 'Invalid phone number' }),
  tempPin: z.string().regex(/^\d{4}$/, 'Temporary PIN must be 4 digits'),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  dateOfBirth: z
    .string()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), { message: 'Invalid date' })
    .optional()
    .or(z.literal('')),
  gender: z.enum(['male', 'female']).optional(),
  region: optionalText,
  district: optionalText,
  ward: optionalText,
  street: optionalText,
  fullAddress: z.string().trim().max(1000).optional().or(z.literal('')),
  nidaNumber: optionalNida,
  drivingLicenceNumber: z.string().trim().max(30).optional().or(z.literal('')),
  // Optional immediate assignment.
  motorcycleId: z.string().uuid().optional().or(z.literal('')),
  assignmentStartDate: z
    .string()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), { message: 'Invalid date' })
    .optional()
    .or(z.literal('')),
});

export type ManualRiderInput = z.infer<typeof manualRiderSchema>;
