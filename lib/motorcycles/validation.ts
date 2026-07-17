import { z } from 'zod';
import { regionByName } from '@/lib/geo/tanzania';

/*
 * Motorcycle validation (spec §9.3; build spec #16). Identifying fields are
 * chassis number, engine number, colour and make/model — all mandatory.
 * Registration number is OPTIONAL (issued after purchase, spec #16). The
 * internal code (motorcycle_number) is auto-generated (spec #7), never typed.
 * Chassis/engine/registration are normalized (upper-case, single-spaced) so the
 * unique constraints catch "mc123abc" == "MC 123 ABC".
 */

export function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeMotorcycleNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeSerial(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

const requiredText = z.string().trim().min(1).max(60);
const optionalText = z.string().trim().max(60).optional().or(z.literal(''));

export const motorcycleSchema = z
  .object({
    // Mandatory identifying fields (build spec #16).
    chassisNumber: requiredText.transform(normalizeSerial),
    engineNumber: requiredText.transform(normalizeSerial),
    colour: requiredText,
    make: requiredText,
    model: requiredText,
    // Optional — registration comes later; region/district feed the code (#7).
    registrationNumber: z
      .string()
      .trim()
      .max(60)
      .optional()
      .or(z.literal(''))
      .transform((v) => (v ? normalizeRegistration(v) : '')),
    region: optionalText,
    district: optionalText,
  })
  .superRefine((val, ctx) => {
    // If a region is given it must be valid, and a given district must belong to
    // it — a wrong pairing would produce a misleading motorcycle code.
    if (val.region) {
      const region = regionByName(val.region);
      if (!region) {
        ctx.addIssue({ code: 'custom', message: 'region', path: ['region'] });
      } else if (val.district && !region.districts.some((d) => d.toLowerCase() === val.district!.trim().toLowerCase())) {
        ctx.addIssue({ code: 'custom', message: 'district', path: ['district'] });
      }
    }
  });

// Output (after transforms) — what createMotorcycle receives.
export type MotorcycleInput = z.output<typeof motorcycleSchema>;
// Input (raw form values, before transforms) — what react-hook-form binds to.
export type MotorcycleFormInput = z.input<typeof motorcycleSchema>;
