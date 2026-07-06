import { z } from 'zod';
import { isValidPhone } from '@/lib/auth/phone';

/*
 * Shared validation for the public rider application (spec §8.2, §8.4). Used by
 * the multi-step form (react-hook-form + zodResolver) AND re-validated on the
 * server before insert — the client is never trusted.
 */

const phone = z
  .string()
  .trim()
  .refine(isValidPhone, { message: 'Namba ya simu si sahihi' });

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidPhone(v), {
    message: 'Namba ya simu si sahihi',
  })
  .optional()
  .or(z.literal(''));

// Tanzanian NIDA is 20 digits; tolerate spaces/dashes in input.
const nida = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^\d{20}$/.test(v), { message: 'Namba ya NIDA ni tarakimu 20' });

const licence = z
  .string()
  .trim()
  .min(5, 'Namba ya leseni si sahihi')
  .max(30);

const name = z.string().trim().min(2).max(80);
const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(1000);

// Applicant must be at least 18 (motorcycle lease).
const dateOfBirth = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Tarehe si sahihi' })
  .refine(
    (v) => {
      const dob = new Date(v);
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 18);
      return dob <= cutoff;
    },
    { message: 'Lazima uwe na umri wa miaka 18 au zaidi' },
  );

export const genderValues = ['male', 'female'] as const;

export const guarantorSchema = z.object({
  fullName: name,
  phone,
  nidaNumber: nida,
  residentialAddress: shortText,
  relationship: shortText,
  occupation: shortText,
  employer: z.string().trim().max(120).optional().or(z.literal('')),
});
export type GuarantorInput = z.infer<typeof guarantorSchema>;

export const applicationSchema = z.object({
  // Step 1 — personal
  firstName: name,
  middleName: z.string().trim().max(80).optional().or(z.literal('')),
  lastName: name,
  dateOfBirth,
  gender: z.enum(genderValues),
  // Step 2 — contact & address
  primaryPhone: phone,
  alternativePhone: optionalPhone,
  email: z.string().trim().email().optional().or(z.literal('')),
  region: shortText,
  district: shortText,
  ward: shortText,
  street: shortText,
  fullAddress: longText.min(1),
  // Step 3 — NIDA & driving
  nidaNumber: nida,
  drivingLicenceNumber: licence,
  // Step 4 — experience & emergency
  previousExperience: z.string().trim().max(1000).optional().or(z.literal('')),
  emergencyContactName: name,
  emergencyContactPhone: phone,
  emergencyContactRelationship: shortText,
  // Steps 5 & 6 — guarantors (exactly two)
  guarantorOne: guarantorSchema,
  guarantorTwo: guarantorSchema,
  // Step 8 — declaration & signature
  declarationAccepted: z.literal(true, {
    message: 'Lazima ukubali masharti',
  }),
  signature: z
    .string()
    .min(1, 'Sahihi inahitajika')
    .refine((v) => v.startsWith('data:image/'), {
      message: 'Sahihi si sahihi',
    }),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

// Field groups per wizard step — used to run partial validation on "Next".
export const STEP_FIELDS = [
  ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender'],
  ['primaryPhone', 'alternativePhone', 'email', 'region', 'district', 'ward', 'street', 'fullAddress'],
  ['nidaNumber', 'drivingLicenceNumber'],
  ['previousExperience', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship'],
  ['guarantorOne'],
  ['guarantorTwo'],
  [], // documents step — validated separately (files, not RHF fields)
  ['declarationAccepted', 'signature'],
  [], // review step
] as const;
