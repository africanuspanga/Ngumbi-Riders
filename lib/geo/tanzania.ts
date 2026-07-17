/*
 * Tanzania regions (mikoa) and districts (wilaya), the single source of truth
 * for the applicant region/district dropdowns (build spec #5) and for
 * motorcycle-code generation (#7). Derived verbatim from the owner-supplied
 * "ORODHA YA MIKOA, WILAYA NA HALMASHAURI" (verified 15 May 2019) — 26 mainland
 * regions. The council (halmashauri) level is intentionally omitted; the
 * dropdowns are region -> district only, ward/street stay free text.
 *
 * Region codes are curated 3-letter uppercase abbreviations (Dar es Salaam =
 * DSM per the spec example). District codes default to the first three letters
 * of the district name, upper-cased; the few first-three collisions inside a
 * region are pinned in DISTRICT_CODE_OVERRIDES.
 *
 * IMPORTANT: once a motorcycle code has been generated for a region/district,
 * its region/district codes are effectively frozen — do NOT renumber or rename
 * these codes, only append new regions/districts.
 */

export type TzRegion = {
  /** Region name as it appears in official lists (mkoa). */
  name: string;
  /** Curated 3-letter region code, unique across regions. */
  code: string;
  /** District names (wilaya) within the region. */
  districts: string[];
};

export const TANZANIA_REGIONS: TzRegion[] = [
  { name: 'Arusha', code: 'ARU', districts: ['Arusha', 'Arumeru', 'Ngorongoro', 'Longido', 'Monduli', 'Karatu'] },
  { name: 'Dar es Salaam', code: 'DSM', districts: ['Kinondoni', 'Ilala', 'Temeke', 'Kigamboni', 'Ubungo'] },
  { name: 'Dodoma', code: 'DOD', districts: ['Chamwino', 'Dodoma', 'Chemba', 'Kondoa', 'Bahi', 'Mpwapwa', 'Kongwa'] },
  { name: 'Geita', code: 'GEI', districts: ['Bukombe', 'Mbogwe', "Nyang'wale", 'Geita', 'Chato'] },
  { name: 'Iringa', code: 'IRI', districts: ['Mufindi', 'Kilolo', 'Iringa'] },
  { name: 'Kagera', code: 'KAG', districts: ['Biharamulo', 'Karagwe', 'Muleba', 'Kyerwa', 'Bukoba', 'Ngara', 'Missenyi'] },
  { name: 'Katavi', code: 'KAT', districts: ['Mlele', 'Mpanda', 'Tanganyika'] },
  { name: 'Kigoma', code: 'KIG', districts: ['Kigoma', 'Kasulu', 'Kakonko', 'Uvinza', 'Buhigwe', 'Kibondo'] },
  { name: 'Kilimanjaro', code: 'KIL', districts: ['Siha', 'Moshi', 'Mwanga', 'Rombo', 'Hai', 'Same'] },
  { name: 'Lindi', code: 'LIN', districts: ['Nachingwea', 'Ruangwa', 'Liwale', 'Lindi', 'Kilwa'] },
  { name: 'Manyara', code: 'MAN', districts: ['Babati', 'Mbulu', "Hanang'", 'Kiteto', 'Simanjiro'] },
  { name: 'Mara', code: 'MAR', districts: ['Rorya', 'Serengeti', 'Bunda', 'Butiama', 'Tarime', 'Musoma'] },
  { name: 'Mbeya', code: 'MBE', districts: ['Chunya', 'Kyela', 'Mbeya', 'Rungwe', 'Mbarali'] },
  { name: 'Morogoro', code: 'MOR', districts: ['Gairo', 'Kilombero', 'Mvomero', 'Morogoro', 'Ulanga', 'Kilosa', 'Malinyi'] },
  { name: 'Mtwara', code: 'MTW', districts: ['Newala', 'Nanyumbu', 'Mtwara', 'Masasi', 'Tandahimba'] },
  { name: 'Mwanza', code: 'MWA', districts: ['Ilemela', 'Kwimba', 'Sengerema', 'Nyamagana', 'Magu', 'Ukerewe', 'Misungwi'] },
  { name: 'Njombe', code: 'NJO', districts: ['Njombe', 'Ludewa', "Wanging'ombe", 'Makete'] },
  { name: 'Pwani', code: 'PWA', districts: ['Bagamoyo', 'Mkuranga', 'Rufiji', 'Mafia', 'Kibaha', 'Kisarawe', 'Kibiti'] },
  { name: 'Rukwa', code: 'RUK', districts: ['Sumbawanga', 'Nkasi', 'Kalambo'] },
  { name: 'Ruvuma', code: 'RUV', districts: ['Namtumbo', 'Mbinga', 'Nyasa', 'Tunduru', 'Songea'] },
  { name: 'Shinyanga', code: 'SHY', districts: ['Kishapu', 'Kahama', 'Shinyanga'] },
  { name: 'Simiyu', code: 'SIM', districts: ['Busega', 'Maswa', 'Bariadi', 'Meatu', 'Itilima'] },
  { name: 'Singida', code: 'SGD', districts: ['Mkalama', 'Manyoni', 'Singida', 'Ikungi', 'Iramba'] },
  { name: 'Songwe', code: 'SON', districts: ['Songwe', 'Ileje', 'Mbozi', 'Momba'] },
  { name: 'Tabora', code: 'TAB', districts: ['Nzega', 'Kaliua', 'Igunga', 'Sikonge', 'Tabora', 'Urambo', 'Uyui'] },
  { name: 'Tanga', code: 'TAN', districts: ['Tanga', 'Muheza', 'Mkinga', 'Pangani', 'Handeni', 'Korogwe', 'Kilindi', 'Lushoto'] },
];

/*
 * District codes: default is the first three alphabetic characters of the name,
 * upper-cased. These overrides pin the first-three collisions that occur inside
 * the SAME region (keyed by `${regionCode}:${districtName}`), so every district
 * code is unique within its region.
 */
const DISTRICT_CODE_OVERRIDES: Record<string, string> = {
  'ARU:Arumeru': 'ARM', // vs Arusha=ARU
  'DOD:Kongwa': 'KNG', // vs Kondoa=KON
  'MOR:Kilosa': 'KLS', // vs Kilombero=KIL
  'PWA:Kibiti': 'KBT', // vs Kibaha=KIB
};

/** Uppercase 3-letter code from a name (letters only; apostrophes/spaces dropped). */
export function shortCode(name: string, length = 3): string {
  return name
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, length);
}

export function regionByName(name: string | null | undefined): TzRegion | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return TANZANIA_REGIONS.find((r) => r.name.toLowerCase() === n);
}

export function regionCode(regionName: string | null | undefined): string | null {
  return regionByName(regionName)?.code ?? null;
}

export function districtCode(
  regionName: string | null | undefined,
  districtName: string | null | undefined,
): string | null {
  const region = regionByName(regionName);
  if (!region || !districtName) return null;
  const district = region.districts.find((d) => d.toLowerCase() === districtName.trim().toLowerCase());
  if (!district) return null;
  return DISTRICT_CODE_OVERRIDES[`${region.code}:${district}`] ?? shortCode(district);
}

export function districtsOf(regionName: string | null | undefined): string[] {
  return regionByName(regionName)?.districts ?? [];
}

export const REGION_NAMES: string[] = TANZANIA_REGIONS.map((r) => r.name);
