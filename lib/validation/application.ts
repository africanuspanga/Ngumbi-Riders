import { z } from 'zod';
import { isValidPhone } from '@/lib/auth/phone';
import { regionByName } from '@/lib/geo/tanzania';

/*
 * Shared validation for the public rider application (spec §8.2, §8.4; build
 * spec #3/#4/#5). Used by the multi-step form (react-hook-form + zodResolver)
 * AND re-validated on the server before insert — the client is never trusted.
 *
 * Error messages are stable KEYS (not localized strings) so the UI can render
 * them in the current language via the `apply.errors.*` i18n namespace. The
 * server does not surface these to users (it returns a generic 'validation').
 */

const phone = z
  .string()
  .trim()
  .refine(isValidPhone, { message: 'phone' });

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidPhone(v), { message: 'phone' })
  .optional()
  .or(z.literal(''));

// Tanzanian NIDA is 20 digits; tolerate spaces/dashes in input.
const nida = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^\d{20}$/.test(v), { message: 'nida' });

const name = z.string().trim().min(2, 'name').max(80, 'name');
const shortText = z.string().trim().min(1, 'required').max(120, 'required');
const longText = z.string().trim().max(1000, 'required');

// Applicant must be at least 18 (motorcycle lease).
const dateOfBirth = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'date' })
  .refine(
    (v) => {
      const dob = new Date(v);
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 18);
      return dob <= cutoff;
    },
    { message: 'age' },
  );

export const genderValues = ['male', 'female'] as const;

// Build spec #3 — the applicant's primary identity document. Driving licence is
// one option, but is NEVER mandatory: an applicant can submit with NIDA or Voter
// ID alone.
export const identityTypeValues = ['nida', 'driving_licence', 'voter_id'] as const;
export type IdentityType = (typeof identityTypeValues)[number];

/** Per-type validity of the primary identity number (NIDA = 20 digits). */
export function isValidIdentityNumber(type: IdentityType, raw: string): boolean {
  const v = raw.replace(/[\s-]/g, '').trim();
  if (type === 'nida') return /^\d{20}$/.test(v);
  // Driving licence / voter ID formats vary; require a sane minimum length.
  return v.length >= 5 && v.length <= 30;
}

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

export const applicationSchema = z
  .object({
    // Step 1 — personal
    firstName: name,
    middleName: z.string().trim().max(80).optional().or(z.literal('')),
    lastName: name,
    dateOfBirth,
    gender: z.enum(genderValues, { message: 'required' }),
    // Step 2 — contact & address (region/district are dropdowns, build spec #5)
    primaryPhone: phone,
    alternativePhone: optionalPhone,
    email: z.string().trim().email('email').optional().or(z.literal('')),
    region: shortText,
    district: shortText,
    ward: shortText,
    street: shortText,
    fullAddress: longText.min(1, 'required'),
    // Step 3 — identity (build spec #3)
    identityType: z.enum(identityTypeValues, { message: 'required' }),
    identityNumber: z.string().trim().min(1, 'required').max(40, 'identityNumber'),
    // Driving licence is always OPTIONAL (a NIDA/voter applicant may still hold
    // one) — it must never block submission.
    drivingLicenceNumber: z
      .string()
      .trim()
      .max(30, 'licence')
      .optional()
      .or(z.literal('')),
    // Step 4 — experience & emergency
    previousExperience: z.string().trim().max(1000).optional().or(z.literal('')),
    emergencyContactName: name,
    emergencyContactPhone: phone,
    emergencyContactRelationship: shortText,
    // Step 5 — guarantor (build spec #4: exactly one required)
    guarantor: guarantorSchema,
    // Step 7 — declaration & signature
    declarationAccepted: z.literal(true, { message: 'declaration' }),
    signature: z
      .string()
      .min(1, 'signature')
      .refine((v) => v.startsWith('data:image/'), { message: 'signature' }),
  })
  .superRefine((val, ctx) => {
    // Region must be a known Tanzanian region, and district must belong to it.
    const region = regionByName(val.region);
    if (!region) {
      ctx.addIssue({ code: 'custom', message: 'region', path: ['region'] });
    } else if (!region.districts.some((d) => d.toLowerCase() === val.district.trim().toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: 'district', path: ['district'] });
    }
    // The primary identity number must match the chosen type.
    if (!isValidIdentityNumber(val.identityType, val.identityNumber)) {
      ctx.addIssue({ code: 'custom', message: 'identityNumber', path: ['identityNumber'] });
    }
    // If a licence number was ALSO supplied (optional), sanity-check length.
    if (val.drivingLicenceNumber && val.drivingLicenceNumber.trim().length < 5) {
      ctx.addIssue({ code: 'custom', message: 'licence', path: ['drivingLicenceNumber'] });
    }
  });

export type ApplicationInput = z.infer<typeof applicationSchema>;

// Field groups per wizard step — used to run partial validation on "Next".
// (Cross-field checks in superRefine run on full-form validation at submit; the
// region/district/identity dropdowns are constrained in the UI so partial
// validation staying field-level is fine.)
export const STEP_FIELDS = [
  ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender'],
  ['primaryPhone', 'alternativePhone', 'email', 'region', 'district', 'ward', 'street', 'fullAddress'],
  ['identityType', 'identityNumber', 'drivingLicenceNumber'],
  ['previousExperience', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship'],
  ['guarantor'],
  [], // documents step — validated separately (files, not RHF fields)
  ['declarationAccepted', 'signature'],
  [], // review step
] as const;
