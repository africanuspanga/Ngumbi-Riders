'use client';

import { REGION_GROUPS, districtsOf } from '@/lib/geo/tanzania';
import { SelectField } from '@/components/forms/Field';

/*
 * Dependent region → district dropdowns (build spec #6/#7), backed by the ONE
 * central dataset in lib/geo/tanzania.ts — all 31 regions (26 mainland + 5
 * Zanzibar) and their districts. No form anywhere in the app should hand-roll
 * its own list.
 *
 * Historical rows may hold a region or district that predates the dataset (they
 * were free text before the dropdowns existed). Such a value is kept as an
 * extra option rather than silently discarded, so opening and saving an old
 * record does not blank its location.
 */
export function RegionDistrictFields({
  region,
  district,
  onRegionChange,
  onDistrictChange,
  regionError,
  districtError,
  required = false,
  disabled = false,
  regionLabel = 'Region',
  districtLabel = 'District',
  hint,
}: {
  region: string;
  district: string;
  onRegionChange: (value: string) => void;
  onDistrictChange: (value: string) => void;
  regionError?: string;
  districtError?: string;
  required?: boolean;
  disabled?: boolean;
  regionLabel?: string;
  districtLabel?: string;
  hint?: string;
}) {
  const known = REGION_GROUPS.some((g) => g.regions.some((r) => r.name === region));
  const districts = districtsOf(region);
  const districtKnown = !district || districts.includes(district);

  return (
    <>
      <SelectField
        label={regionLabel}
        required={required}
        disabled={disabled}
        error={regionError}
        hint={hint}
        value={region}
        onChange={(e) => {
          onRegionChange(e.target.value);
          // Districts belong to a region — a leftover district from the previous
          // region would be saved against the wrong one (the server rejects it,
          // which reads to the owner as an unexplained failure).
          onDistrictChange('');
        }}
      >
        <option value="">Select region…</option>
        {REGION_GROUPS.map((group) => (
          <optgroup key={group.zone} label={group.label}>
            {group.regions.map((r) => (
              <option key={r.code} value={r.name}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ))}
        {region && !known && (
          <option value={region}>{region} (existing record)</option>
        )}
      </SelectField>

      <SelectField
        label={districtLabel}
        required={required}
        disabled={disabled || !region}
        error={districtError}
        hint={!region ? 'Choose a region first' : undefined}
        value={district}
        onChange={(e) => onDistrictChange(e.target.value)}
      >
        <option value="">{region ? 'Select district…' : '—'}</option>
        {districts.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
        {district && !districtKnown && (
          <option value={district}>{district} (existing record)</option>
        )}
      </SelectField>
    </>
  );
}
