import { z } from 'zod';

/*
 * Motorcycle validation (spec §9.3). We store only the fields the owner needs:
 * internal number, unique registration, make/model. No chassis/engine/insurance
 * etc. Registration is normalized (upper-case, single-spaced) so the unique
 * constraint catches "mc123abc" == "MC 123 ABC".
 */

export function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeMotorcycleNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, ' ');
}

const requiredText = z.string().trim().min(1).max(60);

export const motorcycleSchema = z.object({
  motorcycleNumber: requiredText.transform(normalizeMotorcycleNumber),
  registrationNumber: requiredText.transform(normalizeRegistration),
  make: z.string().trim().max(60).optional().or(z.literal('')),
  model: z.string().trim().max(60).optional().or(z.literal('')),
});

export type MotorcycleInput = z.infer<typeof motorcycleSchema>;
