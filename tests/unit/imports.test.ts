import { describe, it, expect } from 'vitest';
import { IMPORT_DEFS, isImportType } from '@/lib/imports/definitions';
import { validateRows } from '@/lib/imports/validate';
import { buildTemplateCsv } from '@/lib/imports/template';

describe('import definitions', () => {
  it('validates + normalizes a motorcycle row (0021 shape)', () => {
    const res = IMPORT_DEFS.motorcycles.validateRow({
      chassis_number: 'md2a18az xjwc12345',
      engine_number: 'azwjc 1234567',
      colour: 'Red',
      make: 'Bajaj',
      model: 'Boxer',
      registration_number: 'mc 123 abc',
      region: 'Dar es Salaam',
      district: 'Kinondoni',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.chassis_number).toBe('MD2A18AZXJWC12345'); // serials lose ALL whitespace
      expect(res.data.engine_number).toBe('AZWJC1234567');
      expect(res.data.registration_number).toBe('MC 123 ABC');
    }
  });

  it('motorcycle registration is OPTIONAL; chassis/engine/colour are required', () => {
    const noReg = IMPORT_DEFS.motorcycles.validateRow({
      chassis_number: 'CH1',
      engine_number: 'EN1',
      colour: 'Blue',
      make: 'Bajaj',
      model: 'Boxer',
    });
    expect(noReg.ok).toBe(true);
    if (noReg.ok) expect(noReg.data.registration_number).toBeNull();

    expect(
      IMPORT_DEFS.motorcycles.validateRow({
        registration_number: 'MC 9',
        make: 'Bajaj',
        model: 'Boxer',
      }).ok,
    ).toBe(false); // missing chassis/engine/colour
  });

  it('rejects a district that does not belong to the region', () => {
    expect(
      IMPORT_DEFS.motorcycles.validateRow({
        chassis_number: 'CH2',
        engine_number: 'EN2',
        colour: 'Black',
        make: 'Bajaj',
        model: 'Boxer',
        region: 'Dar es Salaam',
        district: 'Nyamagana', // Mwanza district
      }).ok,
    ).toBe(false);
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
  it('flags duplicate chassis numbers within the file', () => {
    const base = { engine_number: 'EN', colour: 'Red', make: 'Bajaj', model: 'Boxer' };
    const { rows, summary } = validateRows('motorcycles', [
      { ...base, chassis_number: 'CHAS 1', engine_number: 'EN1' },
      { ...base, chassis_number: 'chas1', engine_number: 'EN2' }, // same after normalize
      { ...base, chassis_number: 'CHAS 3', engine_number: 'EN3' },
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
  it('produces a header row and an example row with the 0021 columns', () => {
    const csv = buildTemplateCsv('motorcycles');
    const [header, example] = csv.trim().split('\n');
    expect(header).toContain('chassis_number');
    expect(header).toContain('engine_number');
    expect(header).toContain('registration_number');
    expect(header).not.toContain('motorcycle_number'); // auto-generated, never typed
    expect(example).toContain('MC 123 ABC');
  });
});
