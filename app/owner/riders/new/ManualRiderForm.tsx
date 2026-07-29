'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { manualRiderSchema, type ManualRiderInput } from '@/lib/riders/validation';
import { createRiderManually } from '@/lib/riders/actions';
import { TextField, SelectField } from '@/components/forms/Field';
import { RegionDistrictFields } from '@/components/forms/RegionDistrictFields';

type MotoOption = {
  id: string;
  registration_number: string | null;
  motorcycle_number: string;
  region: string | null;
  district: string | null;
};

// A quick temp PIN that avoids trivially weak values (final check is server-side).
function suggestPin(): string {
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const seq = pin.split('').every((d, i, a) => i === 0 || Number(d) === Number(a[i - 1]) + 1);
  const same = new Set(pin).size === 1;
  return seq || same ? '4827' : pin;
}

export function ManualRiderForm({ motorcycles }: { motorcycles: MotoOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ManualRiderInput>({
    resolver: zodResolver(manualRiderSchema),
    defaultValues: { region: '', district: '', locationSource: 'manual' },
  });

  const values = useWatch({ control });
  const region = values.region ?? '';
  const district = values.district ?? '';
  const motorcycleId = values.motorcycleId ?? '';
  const selectedMoto = motorcycles.find((m) => m.id === motorcycleId) ?? null;

  /*
   * Build spec #7: the motorcycle record is the source of truth for where a
   * bike operates, so selecting one fills the rider's region/district instead
   * of making the owner type them again.
   *
   * It only auto-fills while the location is still MOTORCYCLE-derived (or
   * empty). Once the owner edits the fields by hand, location_source flips to
   * 'manual' and a later motorcycle change no longer overwrites their typing —
   * a rider's home address may legitimately differ from the bike's operating
   * area, and silently clobbering it would be a data-loss bug.
   */
  const lastAppliedMoto = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedMoto) return;
    if (lastAppliedMoto.current === selectedMoto.id) return;
    const derived = values.locationSource !== 'manual';
    const empty = !region && !district;
    if (!derived && !empty) return;
    if (!selectedMoto.region) return;

    lastAppliedMoto.current = selectedMoto.id;
    setValue('region', selectedMoto.region, { shouldValidate: true });
    setValue('district', selectedMoto.district ?? '', { shouldValidate: true });
    setValue('locationSource', 'motorcycle');
  }, [selectedMoto, region, district, values.locationSource, setValue]);

  /** A hand edit means the location is the rider's own, not the bike's. */
  function setLocation(field: 'region' | 'district', value: string) {
    setValue(field, value, { shouldValidate: true });
    setValue('locationSource', 'manual');
    lastAppliedMoto.current = null;
  }

  async function onSubmit(values: ManualRiderInput) {
    setError(null);
    try {
      const res = await createRiderManually(values);
      if (res.ok && res.data) {
        if (res.data.warnings?.length) {
          // The rider + login exist, but part of the record failed to save —
          // land on the rider page with a visible flag instead of a silent gap.
          alert(`Rider created, but these need re-entry on their page: ${res.data.warnings.join(', ')}.`);
        }
        router.push(`/owner/riders/${res.data.riderId}`);
        router.refresh();
      } else if (!res.ok) {
        const map: Record<string, string> = {
          weak_pin: 'Temporary PIN is too easy to guess. Choose another.',
          duplicate: 'A rider with this phone already exists.',
          validation: 'Please check the highlighted fields.',
        };
        setError(map[res.error] ?? 'Could not create the rider.');
      }
    } catch {
      setError('Network error — check the rider register before retrying.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Identity</legend>
        <TextField label="First name" required error={errors.firstName?.message} {...register('firstName')} />
        <TextField label="Middle name" error={errors.middleName?.message} {...register('middleName')} />
        <TextField label="Last name" required error={errors.lastName?.message} {...register('lastName')} />
        <TextField label="Phone" type="tel" inputMode="tel" required hint="e.g. 0712 345 678" error={errors.phone?.message} {...register('phone')} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField label="Temporary PIN" inputMode="numeric" maxLength={4} required hint="Rider must change on first login" error={errors.tempPin?.message} {...register('tempPin')} />
          </div>
          <button
            type="button"
            onClick={() => setValue('tempPin', suggestPin(), { shouldValidate: true })}
            className="mb-[2px] rounded-[--radius-card] border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-surface"
          >
            Suggest
          </button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Contact & address (optional)</legend>
        <TextField label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <TextField label="Date of birth" type="date" error={errors.dateOfBirth?.message} {...register('dateOfBirth')} />
        <SelectField label="Gender" error={errors.gender?.message} defaultValue="" {...register('gender')}>
          <option value="">—</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </SelectField>
        <RegionDistrictFields
          region={region}
          district={district}
          onRegionChange={(v) => setLocation('region', v)}
          onDistrictChange={(v) => setLocation('district', v)}
          regionError={errors.region?.message}
          districtError={errors.district?.message}
          regionLabel="Region (rider's home)"
          districtLabel="District (rider's home)"
          hint={
            values.locationSource === 'motorcycle'
              ? "Filled from the selected motorcycle's operating area — edit if the rider lives elsewhere."
              : undefined
          }
        />
        <TextField label="Ward" error={errors.ward?.message} {...register('ward')} />
        <TextField label="Street" error={errors.street?.message} {...register('street')} />
        <TextField label="Full address" error={errors.fullAddress?.message} {...register('fullAddress')} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Identifiers (optional)</legend>
        <TextField label="NIDA number" inputMode="numeric" hint="20 digits — encrypted at rest" error={errors.nidaNumber?.message} {...register('nidaNumber')} />
        <TextField label="Driving licence number" error={errors.drivingLicenceNumber?.message} {...register('drivingLicenceNumber')} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Assign a motorcycle (optional)</legend>
        <SelectField
          label="Motorcycle"
          error={errors.motorcycleId?.message}
          defaultValue=""
          hint="Selecting a motorcycle fills the rider's region and district from its operating area."
          {...register('motorcycleId')}
        >
          <option value="">— none —</option>
          {motorcycles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.motorcycle_number}
              {m.registration_number ? ` · ${m.registration_number}` : ''}
              {m.region ? ` · ${[m.district, m.region].filter(Boolean).join(', ')}` : ''}
            </option>
          ))}
        </SelectField>
        {selectedMoto && !selectedMoto.region && (
          <p className="-mt-2 text-xs text-muted-foreground">
            This motorcycle has no region on file, so nothing was filled in. Add
            it on the motorcycle&rsquo;s page to reuse it next time.
          </p>
        )}
        <TextField label="Assignment start date" type="date" error={errors.assignmentStartDate?.message} {...register('assignmentStartDate')} />
      </fieldset>

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {isSubmitting ? 'Creating…' : 'Create rider'}
      </button>
    </form>
  );
}
