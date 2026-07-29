import { describe, it, expect } from 'vitest';
import {
  TANZANIA_REGIONS,
  REGION_GROUPS,
  regionCode,
  districtCode,
  districtsOf,
  shortCode,
  isDistrictOfRegion,
  canonicalRegionName,
  canonicalDistrictName,
} from '@/lib/geo/tanzania';

describe('Tanzania geo dataset', () => {
  it('has all 31 regions (26 mainland + 5 Zanzibar) with unique region codes', () => {
    expect(TANZANIA_REGIONS).toHaveLength(31);
    expect(TANZANIA_REGIONS.filter((r) => r.zone === 'mainland')).toHaveLength(26);
    expect(TANZANIA_REGIONS.filter((r) => r.zone === 'zanzibar')).toHaveLength(5);
    const codes = TANZANIA_REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z]{3}$/));
  });

  it('has no duplicate region names and never an empty district list', () => {
    const names = TANZANIA_REGIONS.map((r) => r.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const r of TANZANIA_REGIONS) {
      expect(r.districts.length, `${r.name} has no districts`).toBeGreaterThan(0);
      expect(new Set(r.districts).size, `duplicate district in ${r.name}`).toBe(r.districts.length);
    }
  });

  it('exposes the five Zanzibar regions with their districts', () => {
    expect(districtsOf('Mjini Magharibi')).toEqual(['Mjini', 'Magharibi A', 'Magharibi B']);
    expect(districtsOf('Kaskazini Unguja')).toEqual(['Kaskazini A', 'Kaskazini B']);
    expect(districtsOf('Kusini Unguja')).toEqual(['Kati', 'Kusini']);
    expect(districtsOf('Kaskazini Pemba')).toEqual(['Micheweni', 'Wete']);
    expect(districtsOf('Kusini Pemba')).toEqual(['Chake Chake', 'Mkoani']);
  });

  it('keeps districts that were previously missing from the mainland list', () => {
    expect(districtsOf('Singida')).toContain('Itigi');
    expect(districtsOf('Pwani')).toContain('Chalinze');
    expect(districtsOf('Mwanza')).toContain('Buchosa');
    expect(districtsOf('Shinyanga')).toEqual(expect.arrayContaining(['Msalala', 'Ushetu']));
    expect(districtsOf('Tanga')).toContain('Bumbuli');
    expect(districtsOf('Katavi')).toEqual(expect.arrayContaining(['Mpimbwe', 'Nsimbo']));
    expect(districtsOf('Mbeya')).toContain('Busokelo');
    expect(districtsOf('Ruvuma')).toContain('Madaba');
    expect(districtsOf('Songwe')).toContain('Tunduma');
  });

  it('preserves the district names that older rows were saved with', () => {
    // Renaming these would orphan live rider/motorcycle rows (stored as text).
    expect(districtsOf('Geita')).toContain("Nyang'wale");
    expect(districtsOf('Arusha')).toContain('Arumeru');
    expect(districtsOf('Manyara')).toContain("Hanang'");
    expect(districtsOf('Pwani')).toContain('Kibiti');
  });

  it('groups regions into mainland and Zanzibar covering every region', () => {
    expect(REGION_GROUPS).toHaveLength(2);
    expect(REGION_GROUPS.flatMap((g) => g.regions)).toHaveLength(TANZANIA_REGIONS.length);
  });

  it('validates region/district pairing', () => {
    expect(isDistrictOfRegion('Dar es Salaam', 'Kinondoni')).toBe(true);
    expect(isDistrictOfRegion('dar es salaam', ' kinondoni ')).toBe(true);
    expect(isDistrictOfRegion('Dar es Salaam', 'Micheweni')).toBe(false);
    expect(isDistrictOfRegion('Nowhere', 'Kinondoni')).toBe(false);
    expect(isDistrictOfRegion('Dar es Salaam', null)).toBe(false);
  });

  it('canonicalises known names and passes unknown ones through', () => {
    expect(canonicalRegionName('  dar es salaam ')).toBe('Dar es Salaam');
    expect(canonicalRegionName('Legacy Region')).toBe('Legacy Region');
    expect(canonicalRegionName(null)).toBeNull();
    expect(canonicalDistrictName('Dar es Salaam', 'kinondoni')).toBe('Kinondoni');
    expect(canonicalDistrictName('Dar es Salaam', 'Old Ward')).toBe('Old Ward');
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
    expect(regionCode('Atlantis')).toBeNull();
    expect(districtCode('Dar es Salaam', 'Nowhere')).toBeNull();
  });

  it('shortCode strips apostrophes and non-letters', () => {
    expect(shortCode("Nyang'wale")).toBe('NYA');
    expect(shortCode('Wanging’ombe')).toBe('WAN');
  });
});
