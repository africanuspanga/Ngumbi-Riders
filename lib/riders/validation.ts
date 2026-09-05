import { z } from 'zod';
import { isValidPhone } from '@/lib/auth/phone';
import { isDistrictOfRegion, regionByName } from '@/lib/geo/tanzania';

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
  // '' must be accepted: the form's "—" option submits an empty string, and a
  // bare .optional() enum rejects it with raw English zod text under a field
  // explicitly labelled optional (the createRiderManually action maps '' → null).
  gender: z.enum(['male', 'female']).optional().or(z.literal('')),
  // The rider's PERSONAL/home location (#7). The motorcycle's OPERATIONAL
  // location lives on the motorcycle record; the form copies it as a default
  // and records which of the two this value came from.
  region: optionalText,
  district: optionalText,
  locationSource: z.enum(['manual', 'motorcycle']).optional(),
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

/*
 * Region/district must be a real pair. Enforced HERE (so it runs server-side in
 * createRiderManually too, not just in the dropdown) but tolerant of historical
 * free-text values: a region the dataset does not know is left alone, because
 * rows created before the dropdowns existed must stay editable. Only a
 * recognised region with a district that does NOT belong to it is rejected —
 * that combination can only come from a tampered request or a stale form.
 */
export const manualRiderSchemaWithGeo = manualRiderSchema.superRefine((v, ctx) => {
  if (!v.region || !v.district) return;
  if (!regionByName(v.region)) return; // legacy/unknown region — accept as typed
  if (!isDistrictOfRegion(v.region, v.district)) {
    ctx.addIssue({
      code: 'custom',
      path: ['district'],
      message: `${v.district} is not a district of ${v.region}`,
    });
  }
});

export type ManualRiderInput = z.infer<typeof manualRiderSchema>;

/*
 * Owner edit of an existing rider (client request 2026-09-05: "on viewing all
 * riders he should be able to edit driver information").
 *
 * Same fields as manual creation MINUS the ones that are not edits:
 *   • `tempPin` — a PIN is reset through `resetRiderPin`, never typed here;
 *   • `motorcycleId` / `assignmentStartDate` — assignment is its own action
 *     with its own history, so editing a rider must not silently move a bike.
 *
 * `phone` stays editable because a mistyped number is the most common
 * registration error — but changing it has a consequence the action handles
 * explicitly: the Supabase password is derived from the phone
 * (`HMAC(pepper, phone:pin)`), so a new number invalidates the rider's current
 * PIN and forces a reset. See `updateRider`.
 */
export const editRiderSchema = manualRiderSchema
  .omit({ tempPin: true, motorcycleId: true, assignmentStartDate: true })
  .superRefine((v, ctx) => {
    if (!v.region || !v.district) return;
    if (!regionByName(v.region)) return; // legacy/unknown region — accept as typed
    if (!isDistrictOfRegion(v.region, v.district)) {
      ctx.addIssue({
        code: 'custom',
        path: ['district'],
        message: `${v.district} is not a district of ${v.region}`,
      });
    }
  });

export type EditRiderInput = z.infer<typeof editRiderSchema>;
