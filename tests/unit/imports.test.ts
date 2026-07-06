import { describe, it, expect } from 'vitest';
import { IMPORT_DEFS, isImportType } from '@/lib/imports/definitions';
import { validateRows } from '@/lib/imports/validate';
import { buildTemplateCsv } from '@/lib/imports/template';

describe('import definitions', () => {
  it('validates + normalizes a motorcycle row', () => {
    const res = IMPORT_DEFS.motorcycles.validateRow({
      motorcycle_number: 'ngr-m-0001',
      registration_number: 'mc 123 abc',
      make: 'Bajaj',
      model: '',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.registration_number).toBe('MC 123 ABC');
      expect(res.data.model).toBeNull();
    }
  });

  it('validates + normalizes a rider row (phone to E.164)', () => {
    const res = IMPORT_DEFS.riders.validateRow({
      first_name: 'Juma',
      last_name: 'Mwinyi',
      phone: '0712345678',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.phone).toBe('+255712345678');
  });

  it('rejects a rider row with a bad phone or short NIDA', () => {
    expect(IMPORT_DEFS.riders.validateRow({ first_name: 'A', last_name: 'B', phone: '123' }).ok).toBe(false);
    expect(
      IMPORT_DEFS.riders.validateRow({
        first_name: 'Juma',
        last_name: 'Mwinyi',
        phone: '0712345678',
        nida_number: '123',
      }).ok,
    ).toBe(false);
  });

  it('isImportType guards the type param', () => {
    expect(isImportType('riders')).toBe(true);
    expect(isImportType('contracts')).toBe(false);
    expect(isImportType(undefined)).toBe(false);
  });
});

describe('validateRows (with in-batch dedupe)', () => {
  it('flags duplicates within the file', () => {
    const { rows, summary } = validateRows('motorcycles', [
      { motorcycle_number: 'M1', registration_number: 'MC 1' },
      { motorcycle_number: 'M2', registration_number: 'mc 1' }, // same after normalize
      { motorcycle_number: 'M3', registration_number: 'MC 3' },
    ]);
    expect(summary.valid).toBe(2);
    expect(summary.duplicatesInBatch).toBe(1);
    expect(rows[1]!.status).toBe('duplicate_in_batch');
  });

  it('separates error rows from valid rows', () => {
    const { summary } = validateRows('riders', [
      { first_name: 'Juma', last_name: 'Mwinyi', phone: '0712345678' },
      { first_name: 'X', last_name: 'Y', phone: 'nope' },
    ]);
    expect(summary.valid).toBe(1);
    expect(summary.errors).toBe(1);
  });
});

describe('buildTemplateCsv', () => {
  it('produces a header row and an example row', () => {
    const csv = buildTemplateCsv('motorcycles');
    const [header, example] = csv.trim().split('\n');
    expect(header).toContain('registration_number');
    expect(example).toContain('MC 123 ABC');
  });
});
