'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { editRiderSchema, type EditRiderInput } from '@/lib/riders/validation';
import { updateRider } from '@/lib/riders/actions';
import { TextField, SelectField } from '@/components/forms/Field';
import { RegionDistrictFields } from '@/components/forms/RegionDistrictFields';

/*
 * Owner edit of a rider's information (client request 2026-09-05).
 *
 * Deliberately NOT here: the temporary PIN and the motorcycle assignment.
 * A PIN is reset from the rider's page (it is a credential, not a field), and
 * assignment has its own action and history — editing a name must never move
 * a motorcycle as a side effect.
 *
 * The phone IS editable, because a mistyped number is the commonest
 * registration mistake. Changing it re-issues the rider's PIN, and the form
 * says so before and after, because the owner has to hand the new PIN over.
 */
export function EditRiderForm({
  riderId,
  riderNumber,
  defaults,
}: {
  riderId: string;
  riderNumber: string;
  defaults: EditRiderInput;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issuedPin, setIssuedPin] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EditRiderInput>({
    resolver: zodResolver(editRiderSchema),
    defaultValues: defaults,
  });

  const values = useWatch({ control });
  const region = values.region ?? '';
  const district = values.district ?? '';
  const phoneChanging = (values.phone ?? '').trim() !== defaults.phone;

  function setLocation(field: 'region' | 'district', value: string) {
    setValue(field, value, { shouldValidate: true });
    setValue('locationSource', 'manual');
  }

  async function onSubmit(v: EditRiderInput) {
    setError(null);
    try {
      const res = await updateRider(riderId, v);
      if (!res.ok) {
        const map: Record<string, string> = {
          validation: 'Please check the highlighted fields.',
          not_found: 'That rider no longer exists.',
          duplicate_phone: 'Another rider already uses that phone number.',
          auth_phone_failed:
            'The phone number could not be changed on the login account, so nothing was changed. Try again.',
          update_failed: 'Could not save the changes.',
        };
        setError(map[res.error] ?? 'Could not save the changes.');
        return;
      }
      if (res.data?.warnings?.length) {
        setError(
          `Saved, but these need checking on the rider's page: ${res.data.warnings.join(', ')}.`,
        );
      }
      // A new PIN must be shown before navigating away — it is displayed once
      // and the owner has to write it down for the rider.
      if (res.data?.phoneChanged && res.data.tempPin) {
        setIssuedPin(res.data.tempPin);
        router.refresh();
        return;
      }
      router.push(`/owner/riders/${riderId}`);
      router.refresh();
    } catch {
      setError('Network error — reopen the rider to check what was saved before retrying.');
    }
  }

  if (issuedPin) {
    return (
      <div className="flex flex-col gap-4 rounded-[--radius-card] border-2 border-primary bg-surface p-5">
        <div>
          <h2 className="font-semibold text-primary-dark">
            Saved — and the rider needs a new PIN
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The phone number is part of how the login is secured, so changing it
            replaced {riderNumber}&rsquo;s PIN. Give them this temporary PIN — it is
            shown once and they must change it when they next sign in.
          </p>
        </div>
        <p className="rounded-[--radius-card] border border-border bg-white px-5 py-4 text-center font-mono text-3xl font-bold tracking-[0.4em] text-primary-dark">
          {issuedPin}
        </p>
        <Link
          href={`/owner/riders/${riderId}`}
          className="self-start rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          I have written it down
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Identity</legend>
        <TextField label="First name" required error={errors.firstName?.message} {...register('firstName')} />
        <TextField label="Middle name" error={errors.middleName?.message} {...register('middleName')} />
        <TextField label="Last name" required error={errors.lastName?.message} {...register('lastName')} />
        <TextField
          label="Phone"
          type="tel"
          inputMode="tel"
          required
          hint="e.g. 0712 345 678"
          error={errors.phone?.message}
          {...register('phone')}
        />
        {phoneChanging && (
          <p className="-mt-2 rounded-[--radius-card] border border-[color:var(--color-warning)]/40 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Changing the phone number replaces this rider&rsquo;s PIN. A new
            temporary PIN will be shown once when you save — write it down and give
            it to them, or they will not be able to sign in.
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Contact &amp; address
        </legend>
        <TextField label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <TextField label="Date of birth" type="date" error={errors.dateOfBirth?.message} {...register('dateOfBirth')} />
        <SelectField label="Gender" error={errors.gender?.message} {...register('gender')}>
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
        />
        <TextField label="Ward" error={errors.ward?.message} {...register('ward')} />
        <TextField label="Street" error={errors.street?.message} {...register('street')} />
        <TextField label="Full address" error={errors.fullAddress?.message} {...register('fullAddress')} />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">Identifiers</legend>
        <TextField
          label="NIDA number"
          inputMode="numeric"
          hint="20 digits — encrypted at rest. Leave blank to keep what is on file."
          error={errors.nidaNumber?.message}
          {...register('nidaNumber')}
        />
        <TextField
          label="Driving licence number"
          error={errors.drivingLicenceNumber?.message}
          {...register('drivingLicenceNumber')}
        />
      </fieldset>

      {error && (
        <p role="alert" className="text-sm font-medium text-[color:var(--color-overdue)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </button>
        <Link
          href={`/owner/riders/${riderId}`}
          className="rounded-[--radius-card] border border-border bg-white px-4 py-3 font-semibold hover:bg-surface"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
