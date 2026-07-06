import { z } from 'zod';
import { isValidPhone, tryNormalizePhone } from '@/lib/auth/phone';
import { normalizeRegistration, normalizeMotorcycleNumber } from '@/lib/motorcycles/validation';

/*
 * Import type registry (spec §21). Phase 3 supports the two types needed to
 * load an existing fleet safely: motorcycles and riders. Each definition owns
 * its template columns, a row schema that normalizes input, and the field used
 * for duplicate detection so imported data passes the same invariants as
 * manual entry (§21.3).
 */
export type ImportType = 'motorcycles' | 'riders';

export type ColumnDef = {
  key: string;
  header: string;
  required: boolean;
  example: string;
};

export type RowResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

export type ImportDef<T> = {
  type: ImportType;
  label: string;
  columns: ColumnDef[];
  dupTable: 'motorcycles' | 'riders';
  dupField: string; // DB column to check for existing duplicates
  validateRow: (raw: Record<string, string>) => RowResult<T>;
  dupValue: (data: T) => string; // normalized value for dedupe
};

function collectErrors(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`);
}

// ---- Motorcycles ---------------------------------------------------------
export type MotorcycleRow = {
  motorcycle_number: string;
  registration_number: string;
  make: string | null;
  model: string | null;
};

const motorcycleRowSchema = z.object({
  motorcycle_number: z.string().trim().min(1, 'required').transform(normalizeMotorcycleNumber),
  registration_number: z.string().trim().min(1, 'required').transform(normalizeRegistration),
  make: z.string().trim().optional().transform((v) => v || null),
  model: z.string().trim().optional().transform((v) => v || null),
});

const motorcyclesDef: ImportDef<MotorcycleRow> = {
  type: 'motorcycles',
  label: 'Motorcycles',
  dupTable: 'motorcycles',
  dupField: 'registration_number',
  columns: [
    { key: 'motorcycle_number', header: 'motorcycle_number', required: true, example: 'NGR-M-0001' },
    { key: 'registration_number', header: 'registration_number', required: true, example: 'MC 123 ABC' },
    { key: 'make', header: 'make', required: false, example: 'Bajaj' },
    { key: 'model', header: 'model', required: false, example: 'Boxer' },
  ],
  validateRow(raw) {
    const res = motorcycleRowSchema.safeParse(raw);
    return res.success
      ? { ok: true, data: res.data }
      : { ok: false, errors: collectErrors(res.error) };
  },
  dupValue: (d) => d.registration_number,
};

// ---- Riders --------------------------------------------------------------
export type RiderRow = {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  phone: string; // canonical E.164
  temp_pin: string | null;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  region: string | null;
  district: string | null;
  ward: string | null;
  street: string | null;
  full_address: string | null;
  nida_number: string | null;
  driving_licence_number: string | null;
};

const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

const riderRowSchema = z
  .object({
    first_name: z.string().trim().min(2, 'first_name required'),
    middle_name: z.string().trim().optional(),
    last_name: z.string().trim().min(2, 'last_name required'),
    phone: z.string().trim().refine(isValidPhone, { message: 'invalid phone' }),
    temp_pin: z.string().trim().optional(),
    email: z.string().trim().optional(),
    date_of_birth: z.string().trim().optional(),
    gender: z.string().trim().optional(),
    region: z.string().trim().optional(),
    district: z.string().trim().optional(),
    ward: z.string().trim().optional(),
    street: z.string().trim().optional(),
    full_address: z.string().trim().optional(),
    nida_number: z.string().trim().optional(),
    driving_licence_number: z.string().trim().optional(),
  })
  .transform((r): RiderRow => ({
    first_name: r.first_name,
    middle_name: opt(r.middle_name),
    last_name: r.last_name,
    phone: tryNormalizePhone(r.phone)!,
    temp_pin: opt(r.temp_pin),
    email: opt(r.email),
    date_of_birth: opt(r.date_of_birth),
    gender: opt(r.gender),
    region: opt(r.region),
    district: opt(r.district),
    ward: opt(r.ward),
    street: opt(r.street),
    full_address: opt(r.full_address),
    nida_number: opt(r.nida_number),
    driving_licence_number: opt(r.driving_licence_number),
  }))
  .refine((r) => !r.nida_number || /^\d{20}$/.test(r.nida_number.replace(/[\s-]/g, '')), {
    message: 'nida_number must be 20 digits',
    path: ['nida_number'],
  });

const ridersDef: ImportDef<RiderRow> = {
  type: 'riders',
  label: 'Riders',
  dupTable: 'riders',
  dupField: 'phone',
  columns: [
    { key: 'first_name', header: 'first_name', required: true, example: 'Juma' },
    { key: 'middle_name', header: 'middle_name', required: false, example: '' },
    { key: 'last_name', header: 'last_name', required: true, example: 'Mwinyi' },
    { key: 'phone', header: 'phone', required: true, example: '0712345678' },
    { key: 'temp_pin', header: 'temp_pin', required: false, example: '(auto if blank)' },
    { key: 'email', header: 'email', required: false, example: '' },
    { key: 'date_of_birth', header: 'date_of_birth', required: false, example: '1995-05-20' },
    { key: 'gender', header: 'gender', required: false, example: 'male' },
    { key: 'region', header: 'region', required: false, example: 'Dar es Salaam' },
    { key: 'district', header: 'district', required: false, example: 'Ilala' },
    { key: 'ward', header: 'ward', required: false, example: 'Upanga' },
    { key: 'street', header: 'street', required: false, example: '' },
    { key: 'full_address', header: 'full_address', required: false, example: '' },
    { key: 'nida_number', header: 'nida_number', required: false, example: '' },
    { key: 'driving_licence_number', header: 'driving_licence_number', required: false, example: '' },
  ],
  validateRow(raw) {
    const res = riderRowSchema.safeParse(raw);
    return res.success
      ? { ok: true, data: res.data }
      : { ok: false, errors: collectErrors(res.error) };
  },
  dupValue: (d) => d.phone,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const IMPORT_DEFS: Record<ImportType, ImportDef<any>> = {
  motorcycles: motorcyclesDef,
  riders: ridersDef,
};

export function isImportType(v: string | undefined | null): v is ImportType {
  return v === 'motorcycles' || v === 'riders';
}
