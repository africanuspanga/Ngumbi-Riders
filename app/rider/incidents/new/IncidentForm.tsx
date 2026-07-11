'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { incidentSchema, type IncidentInput, INCIDENT_CATEGORIES, INCIDENT_LABELS } from '@/lib/incidents/validation';
import { createIncident } from '@/lib/incidents/actions';
import { TextField, TextAreaField, SelectField } from '@/components/forms/Field';

export function IncidentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IncidentInput>({ resolver: zodResolver(incidentSchema) });

  async function onSubmit(values: IncidentInput) {
    setError(null);
    try {
      const res = await createIncident(values);
      if (res.ok) {
        router.push('/rider/incidents');
        router.refresh();
      } else {
        setError('Imeshindikana kutuma. Jaribu tena.');
      }
    } catch {
      setError('Imeshindikana kutuma. Angalia mtandao kisha jaribu tena.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <SelectField label="Aina ya tukio" required error={errors.category?.message} defaultValue="" {...register('category')}>
        <option value="" disabled>Chagua…</option>
        {INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{INCIDENT_LABELS[c]}</option>)}
      </SelectField>
      <TextField label="Tarehe na muda" type="datetime-local" required error={errors.occurredAt?.message} {...register('occurredAt')} />
      <TextAreaField label="Maelezo" required error={errors.description?.message} {...register('description')} />
      <TextField label="Mahali (hiari)" error={errors.locationText?.message} {...register('locationText')} />
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <button type="submit" disabled={isSubmitting} className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
        {isSubmitting ? 'Inatuma…' : 'Tuma taarifa'}
      </button>
    </form>
  );
}
