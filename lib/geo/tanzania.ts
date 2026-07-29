/*
 * Tanzania regions (mikoa) and districts (wilaya), the single source of truth
 * for every region/district dropdown in the app (applicant onboarding, manual
 * rider creation, motorcycle registration, rider search filters — build spec
 * #5/#6/#7) and for motorcycle-code generation (#7).
 *
 * Coverage: ALL 31 regions — 26 mainland + the 5 Zanzibar regions (Unguja and
 * Pemba), which were missing entirely until 2026-07-29. The mainland base is the
 * owner-supplied "ORODHA YA MIKOA, WILAYA NA HALMASHAURI"; it was cross-checked
 * on 2026-07-29 against Wikipedia's "Districts of Tanzania" (which tracks the
 * TAMISEMI council list) and the districts it was missing were appended:
 * Itigi (Singida), Chalinze (Pwani), Buchosa (Mwanza), Msalala + Ushetu
 * (Shinyanga), Bumbuli (Tanga), Mpimbwe + Nsimbo (Katavi), Busokelo (Mbeya),
 * Madaba (Ruvuma), Tunduma (Songwe).
 *
 * The council (halmashauri) level is intentionally omitted — "X Urban" / "X
 * City" councils are administrative subdivisions of the district of the same
 * name, so listing them would double up every dropdown. Dropdowns are
 * region -> district only; ward/street stay free text.
 *
 * Region codes are curated 3-letter uppercase abbreviations (Dar es Salaam =
 * DSM per the spec example). District codes default to the first three letters
 * of the district name, upper-cased; the few first-three collisions inside a
 * region are pinned in DISTRICT_CODE_OVERRIDES.
 *
 * IMPORTANT — two rules keep live data valid:
 *   1. Once a motorcycle code has been generated for a region/district, its
 *      codes are frozen. Do NOT renumber or rename; only APPEND.
 *   2. Region/district are stored on riders and motorcycles as plain text, so a
 *      RENAME orphans existing rows. Existing spellings are therefore preserved
 *      verbatim even where another source spells them differently (e.g.
 *      "Nyang'wale", "Arumeru", "Hanang'", "Kibiti").
 */

export type TzZone = 'mainland' | 'zanzibar';

export type TzRegion = {
  /** Region name as it appears in official lists (mkoa). */
  name: string;
  /** Curated 3-letter region code, unique across regions. */
  code: string;
  /** Mainland Tanzania or Zanzibar — used to group the dropdowns. */
  zone: TzZone;
  /** District names (wilaya) within the region. */
  districts: string[];
};

export const TANZANIA_REGIONS: TzRegion[] = [
  { name: 'Arusha', code: 'ARU', zone: 'mainland', districts: ['Arusha', 'Arumeru', 'Ngorongoro', 'Longido', 'Monduli', 'Karatu'] },
  { name: 'Dar es Salaam', code: 'DSM', zone: 'mainland', districts: ['Kinondoni', 'Ilala', 'Temeke', 'Kigamboni', 'Ubungo'] },
  { name: 'Dodoma', code: 'DOD', zone: 'mainland', districts: ['Chamwino', 'Dodoma', 'Chemba', 'Kondoa', 'Bahi', 'Mpwapwa', 'Kongwa'] },
  { name: 'Geita', code: 'GEI', zone: 'mainland', districts: ['Bukombe', 'Mbogwe', "Nyang'wale", 'Geita', 'Chato'] },
  { name: 'Iringa', code: 'IRI', zone: 'mainland', districts: ['Mufindi', 'Kilolo', 'Iringa'] },
  { name: 'Kagera', code: 'KAG', zone: 'mainland', districts: ['Biharamulo', 'Karagwe', 'Muleba', 'Kyerwa', 'Bukoba', 'Ngara', 'Missenyi'] },
  { name: 'Katavi', code: 'KAT', zone: 'mainland', districts: ['Mlele', 'Mpanda', 'Tanganyika', 'Mpimbwe', 'Nsimbo'] },
  { name: 'Kigoma', code: 'KIG', zone: 'mainland', districts: ['Kigoma', 'Kasulu', 'Kakonko', 'Uvinza', 'Buhigwe', 'Kibondo'] },
  { name: 'Kilimanjaro', code: 'KIL', zone: 'mainland', districts: ['Siha', 'Moshi', 'Mwanga', 'Rombo', 'Hai', 'Same'] },
  { name: 'Lindi', code: 'LIN', zone: 'mainland', districts: ['Nachingwea', 'Ruangwa', 'Liwale', 'Lindi', 'Kilwa'] },
  { name: 'Manyara', code: 'MAN', zone: 'mainland', districts: ['Babati', 'Mbulu', "Hanang'", 'Kiteto', 'Simanjiro'] },
  { name: 'Mara', code: 'MAR', zone: 'mainland', districts: ['Rorya', 'Serengeti', 'Bunda', 'Butiama', 'Tarime', 'Musoma'] },
  { name: 'Mbeya', code: 'MBE', zone: 'mainland', districts: ['Chunya', 'Kyela', 'Mbeya', 'Rungwe', 'Mbarali', 'Busokelo'] },
  { name: 'Morogoro', code: 'MOR', zone: 'mainland', districts: ['Gairo', 'Kilombero', 'Mvomero', 'Morogoro', 'Ulanga', 'Kilosa', 'Malinyi'] },
  { name: 'Mtwara', code: 'MTW', zone: 'mainland', districts: ['Newala', 'Nanyumbu', 'Mtwara', 'Masasi', 'Tandahimba'] },
  { name: 'Mwanza', code: 'MWA', zone: 'mainland', districts: ['Ilemela', 'Kwimba', 'Sengerema', 'Nyamagana', 'Magu', 'Ukerewe', 'Misungwi', 'Buchosa'] },
  { name: 'Njombe', code: 'NJO', zone: 'mainland', districts: ['Njombe', 'Ludewa', "Wanging'ombe", 'Makete'] },
  { name: 'Pwani', code: 'PWA', zone: 'mainland', districts: ['Bagamoyo', 'Mkuranga', 'Rufiji', 'Mafia', 'Kibaha', 'Kisarawe', 'Kibiti', 'Chalinze'] },
  { name: 'Rukwa', code: 'RUK', zone: 'mainland', districts: ['Sumbawanga', 'Nkasi', 'Kalambo'] },
  { name: 'Ruvuma', code: 'RUV', zone: 'mainland', districts: ['Namtumbo', 'Mbinga', 'Nyasa', 'Tunduru', 'Songea', 'Madaba'] },
  { name: 'Shinyanga', code: 'SHY', zone: 'mainland', districts: ['Kishapu', 'Kahama', 'Shinyanga', 'Msalala', 'Ushetu'] },
  { name: 'Simiyu', code: 'SIM', zone: 'mainland', districts: ['Busega', 'Maswa', 'Bariadi', 'Meatu', 'Itilima'] },
  { name: 'Singida', code: 'SGD', zone: 'mainland', districts: ['Mkalama', 'Manyoni', 'Singida', 'Ikungi', 'Iramba', 'Itigi'] },
  { name: 'Songwe', code: 'SON', zone: 'mainland', districts: ['Songwe', 'Ileje', 'Mbozi', 'Momba', 'Tunduma'] },
  { name: 'Tabora', code: 'TAB', zone: 'mainland', districts: ['Nzega', 'Kaliua', 'Igunga', 'Sikonge', 'Tabora', 'Urambo', 'Uyui'] },
  { name: 'Tanga', code: 'TAN', zone: 'mainland', districts: ['Tanga', 'Muheza', 'Mkinga', 'Pangani', 'Handeni', 'Korogwe', 'Kilindi', 'Lushoto', 'Bumbuli'] },
  // ---- Zanzibar (Unguja + Pemba), added 2026-07-29 ------------------------
  { name: 'Kaskazini Unguja', code: 'KUN', zone: 'zanzibar', districts: ['Kaskazini A', 'Kaskazini B'] },
  { name: 'Kusini Unguja', code: 'KSU', zone: 'zanzibar', districts: ['Kati', 'Kusini'] },
  { name: 'Mjini Magharibi', code: 'MJM', zone: 'zanzibar', districts: ['Mjini', 'Magharibi A', 'Magharibi B'] },
  { name: 'Kaskazini Pemba', code: 'KPE', zone: 'zanzibar', districts: ['Micheweni', 'Wete'] },
  { name: 'Kusini Pemba', code: 'KSP', zone: 'zanzibar', districts: ['Chake Chake', 'Mkoani'] },
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
  'KUN:Kaskazini A': 'KSA', // vs Kaskazini B — both start "Kas"
  'KUN:Kaskazini B': 'KSB',
  'MJM:Magharibi A': 'MGA', // vs Magharibi B — both start "Mag"
  'MJM:Magharibi B': 'MGB',
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

/**
 * Regions grouped by zone, for `<optgroup>`-style dropdowns. Mainland first
 * (26 regions), then Zanzibar (5) — the order the owner reads them in.
 */
export const REGION_GROUPS: { zone: TzZone; label: string; regions: TzRegion[] }[] = [
  {
    zone: 'mainland',
    label: 'Tanzania Bara (Mainland)',
    regions: TANZANIA_REGIONS.filter((r) => r.zone === 'mainland'),
  },
  {
    zone: 'zanzibar',
    label: 'Zanzibar',
    regions: TANZANIA_REGIONS.filter((r) => r.zone === 'zanzibar'),
  },
];

/**
 * True when `district` belongs to `region`. Used by every server action that
 * accepts a region/district pair so a hand-crafted POST cannot store a district
 * from a different region. Case- and whitespace-insensitive.
 */
export function isDistrictOfRegion(
  regionName: string | null | undefined,
  districtName: string | null | undefined,
): boolean {
  const region = regionByName(regionName);
  if (!region || !districtName) return false;
  const d = districtName.trim().toLowerCase();
  return region.districts.some((x) => x.toLowerCase() === d);
}

/**
 * Canonical spelling for a stored region/district value, or the original string
 * when it is not in the dataset. Historical rows keep whatever was typed before
 * the dropdowns existed, so display code must never assume a match — this only
 * tidies casing/whitespace when we DO recognise the value.
 */
export function canonicalRegionName(name: string | null | undefined): string | null {
  if (!name) return null;
  return regionByName(name)?.name ?? name.trim();
}

export function canonicalDistrictName(
  regionName: string | null | undefined,
  districtName: string | null | undefined,
): string | null {
  if (!districtName) return null;
  const region = regionByName(regionName);
  const d = districtName.trim();
  return region?.districts.find((x) => x.toLowerCase() === d.toLowerCase()) ?? d;
}
