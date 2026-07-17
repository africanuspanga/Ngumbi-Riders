import { describe, it, expect } from 'vitest';
import {
  TANZANIA_REGIONS,
  regionCode,
  districtCode,
  districtsOf,
  shortCode,
} from '@/lib/geo/tanzania';

describe('Tanzania geo dataset', () => {
  it('has the 26 mainland regions with unique region codes', () => {
    expect(TANZANIA_REGIONS).toHaveLength(26);
    const codes = TANZANIA_REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z]{3}$/));
  });

  it('gives every district a code that is unique within its region', () => {
    for (const region of TANZANIA_REGIONS) {
      const codes = region.districts.map((d) => districtCode(region.name, d));
      codes.forEach((c) => expect(c).toBeTruthy());
      expect(new Set(codes).size, `duplicate district code in ${region.name}`).toBe(codes.length);
    }
  });

  it('matches the spec example NGR-DSM-KIN', () => {
    expect(regionCode('Dar es Salaam')).toBe('DSM');
    expect(districtCode('Dar es Salaam', 'Kinondoni')).toBe('KIN');
  });

  it('resolves first-three collisions via overrides', () => {
    expect(districtCode('Arusha', 'Arusha')).toBe('ARU');
    expect(districtCode('Arusha', 'Arumeru')).toBe('ARM');
    expect(districtCode('Pwani', 'Kibaha')).toBe('KIB');
    expect(districtCode('Pwani', 'Kibiti')).toBe('KBT');
  });

  it('is case-insensitive and tolerant of whitespace', () => {
    expect(regionCode('  dar es salaam ')).toBe('DSM');
    expect(districtsOf('MWANZA')).toContain('Ilemela');
  });

  it('returns null for unknown region/district', () => {
    expect(regionCode('Zanzibar Urban')).toBeNull();
    expect(districtCode('Dar es Salaam', 'Nowhere')).toBeNull();
  });

  it('shortCode strips apostrophes and non-letters', () => {
    expect(shortCode("Nyang'wale")).toBe('NYA');
    expect(shortCode('Wanging’ombe')).toBe('WAN');
  });
});
