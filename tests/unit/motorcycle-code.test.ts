import { describe, it, expect } from 'vitest';
import { buildMotorcycleCode } from '@/lib/motorcycles/code';

describe('buildMotorcycleCode (#7)', () => {
  it('matches the spec example NGR-DSM-KIN-M-0001', () => {
    expect(
      buildMotorcycleCode({ regionName: 'Dar es Salaam', districtName: 'Kinondoni', sequence: 1 }),
    ).toBe('NGR-DSM-KIN-M-0001');
  });

  it('zero-pads the sequence to 4 digits', () => {
    expect(buildMotorcycleCode({ regionName: 'Arusha', districtName: 'Karatu', sequence: 42 })).toBe(
      'NGR-ARU-KAR-M-0042',
    );
  });

  it('falls back to XXX when region/district are missing (#7 safe fallback)', () => {
    expect(buildMotorcycleCode({ sequence: 1 })).toBe('NGR-XXX-XXX-M-0001');
    expect(buildMotorcycleCode({ regionName: 'Dar es Salaam', districtName: null, sequence: 3 })).toBe(
      'NGR-DSM-XXX-M-0003',
    );
    expect(buildMotorcycleCode({ regionName: 'Nowhere', districtName: 'Nowhere', sequence: 1 })).toBe(
      'NGR-XXX-XXX-M-0001',
    );
  });

  it('never produces a sequence below 0001', () => {
    expect(buildMotorcycleCode({ regionName: 'Dodoma', districtName: 'Dodoma', sequence: 0 })).toBe(
      'NGR-DOD-DOD-M-0001',
    );
  });
});
