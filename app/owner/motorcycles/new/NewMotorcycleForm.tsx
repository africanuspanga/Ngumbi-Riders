'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motorcycleSchema, type MotorcycleInput, type MotorcycleFormInput } from '@/lib/motorcycles/validation';
import { createMotorcycle } from '@/lib/motorcycles/actions';
import { REGION_NAMES, districtsOf } from '@/lib/geo/tanzania';
import { TextField, SelectField } from '@/components/forms/Field';

const ERROR_MESSAGES: Record<string, string> = {
  duplicate_chassis: 'A motorcycle with this chassis number already exists.',
  duplicate_engine: 'A motorcycle with this engine number already exists.',
  duplicate_registration: 'A motorcycle with this registration already exists.',
  duplicate: 'A motorcycle with these details already exists.',
  validation: 'Please check the required fields.',
};

export function NewMotorcycleForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MotorcycleFormInput, unknown, MotorcycleInput>({
    resolver: zodResolver(motorcycleSchema),
    defaultValues: { region: '', district: '' },
  });

  const region = watch('region') ?? '';

  async function onSubmit(values: MotorcycleInput) {
    setError(null);
    try {
      const res = await createMotorcycle(values);
      if (res.ok && res.data) {
        router.push(`/owner/motorcycles/${res.data.id}`);
        router.refresh();
      } else {
        setError((!res.ok && ERROR_MESSAGES[res.error]) || 'Could not create the motorcycle.');
      }
    } catch {
      setError('Network error — check the register before retrying.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {/* The internal code (NGR-REGION-DIST-M-####) is generated automatically. */}
      <p className="rounded-[--radius-card] bg-surface p-3 text-sm text-muted-foreground">
        The motorcycle code is generated automatically from the region, district and a
        sequence number. Registration number is optional — you can add it later once it is issued.
      </p>
      <TextField label="Chassis number" required error={errors.chassisNumber?.message} placeholder="MD2A..." {...register('chassisNumber')} />
      <TextField label="Engine number" required error={errors.engineNumber?.message} placeholder="OJEA..." {...register('engineNumber')} />
      <TextField label="Colour" required error={errors.colour?.message} placeholder="Red" {...register('colour')} />
      <TextField label="Make" required error={errors.make?.message} placeholder="Bajaj" {...register('make')} />
      <TextField label="Model" required error={errors.model?.message} placeholder="Boxer" {...register('model')} />
      <SelectField
        label="Region"
        error={errors.region?.message}
        defaultValue=""
        {...register('region', { onChange: () => setValue('district', '', { shouldValidate: false }) })}
      >
        <option value="">Choose region… (optional)</option>
        {REGION_NAMES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </SelectField>
      <SelectField label="District" error={errors.district?.message} defaultValue="" disabled={!region} {...register('district')}>
        <option value="">{region ? 'Choose district… (optional)' : 'Choose a region first'}</option>
        {districtsOf(region).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </SelectField>
      <TextField label="Registration number (optional)" error={errors.registrationNumber?.message} placeholder="MC 123 ABC" {...register('registrationNumber')} />
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {isSubmitting ? 'Saving…' : 'Save motorcycle'}
      </button>
    </form>
  );
}
