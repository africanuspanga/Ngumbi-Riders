'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motorcycleSchema, type MotorcycleInput } from '@/lib/motorcycles/validation';
import { createMotorcycle } from '@/lib/motorcycles/actions';
import { TextField } from '@/components/forms/Field';

export function NewMotorcycleForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MotorcycleInput>({ resolver: zodResolver(motorcycleSchema) });

  async function onSubmit(values: MotorcycleInput) {
    setError(null);
    try {
      const res = await createMotorcycle(values);
      if (res.ok && res.data) {
        router.push(`/owner/motorcycles/${res.data.id}`);
        router.refresh();
      } else {
        setError(
          !res.ok && res.error === 'duplicate'
            ? 'A motorcycle with this registration already exists.'
            : 'Could not create the motorcycle.',
        );
      }
    } catch {
      setError('Network error — check the register before retrying.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <TextField label="Internal number" required error={errors.motorcycleNumber?.message} placeholder="NGR-M-0001" {...register('motorcycleNumber')} />
      <TextField label="Registration number" required error={errors.registrationNumber?.message} placeholder="MC 123 ABC" {...register('registrationNumber')} />
      <TextField label="Make" error={errors.make?.message} placeholder="Bajaj" {...register('make')} />
      <TextField label="Model" error={errors.model?.message} placeholder="Boxer" {...register('model')} />
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
