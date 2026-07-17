'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { manualRiderSchema, type ManualRiderInput } from '@/lib/riders/validation';
import { createRiderManually } from '@/lib/riders/actions';
import { TextField, SelectField } from '@/components/forms/Field';

type MotoOption = { id: string; registration_number: string | null; motorcycle_number: string };

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
    formState: { errors, isSubmitting },
  } = useForm<ManualRiderInput>({ resolver: zodResolver(manualRiderSchema) });

  async function onSubmit(values: ManualRiderInput) {
    setError(null);
    try {
      const res = await createRiderManually(values);
      if (res.ok && res.data) {
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
        <TextField label="Region" error={errors.region?.message} {...register('region')} />
        <TextField label="District" error={errors.district?.message} {...register('district')} />
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
        <SelectField label="Motorcycle" error={errors.motorcycleId?.message} defaultValue="" {...register('motorcycleId')}>
          <option value="">— none —</option>
          {motorcycles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.motorcycle_number}{m.registration_number ? ` · ${m.registration_number}` : ''}
            </option>
          ))}
        </SelectField>
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
