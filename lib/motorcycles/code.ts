import { regionCode, districtCode } from '@/lib/geo/tanzania';

/*
 * Automatic motorcycle code generation (build spec #7):
 *
 *   NGR-{REGION_CODE}-{DISTRICT_CODE}-{VEHICLE_CODE}-{SEQUENCE}
 *   e.g. NGR-DSM-KIN-M-0001  (Dar es Salaam / Kinondoni / motorcycle / #1)
 *
 * The code is generated automatically — the owner never types it. If the region
 * or district is missing/unknown, a safe placeholder ('XXX') is used so a bike
 * bought before its location is recorded still gets a unique code. The sequence
 * is zero-padded to 4 digits. Uniqueness is enforced by the motorcycle_number
 * UNIQUE constraint; the caller retries the sequence on a collision.
 */
export const VEHICLE_CODE_MOTORCYCLE = 'M';
const FALLBACK = 'XXX';

export function buildMotorcycleCode(input: {
  regionName?: string | null;
  districtName?: string | null;
  sequence: number;
  vehicleCode?: string;
}): string {
  const r = regionCode(input.regionName) ?? FALLBACK;
  const d = districtCode(input.regionName, input.districtName) ?? FALLBACK;
  const v = (input.vehicleCode ?? VEHICLE_CODE_MOTORCYCLE).toUpperCase();
  const seq = String(Math.max(1, Math.trunc(input.sequence))).padStart(4, '0');
  return `NGR-${r}-${d}-${v}-${seq}`;
}
