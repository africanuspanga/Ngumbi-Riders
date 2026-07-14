'use client';

import Link from 'next/link';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  contractBuilderSchema,
  type ContractBuilderInput,
  type ContractBuilderFormInput,
  WEEKDAY_LABELS,
} from '@/lib/contracts/validation';
import { createContract } from '@/lib/contracts/actions';
import {
  endDateFromDuration,
  scheduleSummary,
} from '@/lib/obligations/schedule';
import { formatTZS } from '@/lib/money/format';
import { TextField, SelectField, TextAreaField } from '@/components/forms/Field';

// Server-side createContract rejections mapped to owner-facing copy.
const CONTRACT_ERRORS: Record<string, string> = {
  motorcycle_assigned_to_other:
    'That motorcycle is assigned to a different rider. Pick the rider it is assigned to, or release the assignment on their rider page first.',
  motorcycle_in_contract: 'That motorcycle is already under a contract.',
  motorcycle_unavailable: 'That motorcycle is inactive and cannot be leased.',
  motorcycle_not_found: 'That motorcycle no longer exists — reload and try again.',
};

type Option = { id: string; label: string };
type MotoOption = {
  id: string;
  label: string;
  assignedRiderId: string | null;
  assignedRiderLabel: string | null;
};

export function ContractBuilder({
  riders,
  motorcycles,
  defaultAmount,
}: {
  riders: Option[];
  motorcycles: MotoOption[];
  defaultAmount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContractBuilderFormInput, unknown, ContractBuilderInput>({
    resolver: zodResolver(contractBuilderSchema),
    defaultValues: {
      scheduleType: 'daily',
      selectedWeekdays: [],
      ownershipTransfers: false,
      installmentAmount: defaultAmount || undefined,
      paymentDeadlineTime: '18:00',
    },
  });

  const values = useWatch({ control });
  const weekdays = values.selectedWeekdays ?? [];

  // A bike already assigned to a rider can only be leased to THAT rider, so it
  // only appears once that rider is selected. Available (unassigned) bikes
  // always appear. Bikes assigned to a different rider are surfaced as a hint.
  const selectedRiderId = values.riderId;
  const visibleMotorcycles = motorcycles.filter(
    (m) => m.assignedRiderId === null || m.assignedRiderId === selectedRiderId,
  );
  const assignedToOthers = motorcycles.filter(
    (m) => m.assignedRiderId !== null && m.assignedRiderId !== selectedRiderId,
  );

  function toggleWeekday(day: number) {
    const next = weekdays.includes(day)
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].sort();
    setValue('selectedWeekdays', next, { shouldValidate: true });
  }

  // Live preview (spec §10.3 step 3).
  let preview: { count: number; total: number; endDate: string } | null = null;
  try {
    if (values.startDate && values.durationMonths && values.installmentAmount) {
      const endDate = endDateFromDuration(values.startDate, Number(values.durationMonths));
      const { count, total } = scheduleSummary(
        {
          startDate: values.startDate,
          endDate,
          scheduleType: values.scheduleType ?? 'daily',
          selectedWeekdays: weekdays,
          deadlineTime: values.paymentDeadlineTime || '18:00',
        },
        Number(values.installmentAmount),
      );
      preview = { count, total, endDate };
    }
  } catch {
    preview = null;
  }

  async function onSubmit(v: ContractBuilderInput) {
    setError(null);
    try {
      const res = await createContract(v);
      if (res.ok && res.data) {
        router.push(`/owner/contracts/${res.data.id}`);
        router.refresh();
      } else {
        setError(
          !res.ok
            ? CONTRACT_ERRORS[res.error] ?? 'Could not create the contract. Check the fields.'
            : 'Could not create the contract. Check the fields.',
        );
      }
    } catch {
      setError('Network error — check the contract register before retrying.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {motorcycles.length === 0 && (
        <p role="alert" className="rounded-[--radius-card] border border-warning bg-surface p-3 text-sm text-primary-dark">
          No motorcycles are free to lease. A bike appears here when it is{' '}
          <em>available</em>, or already assigned to a rider but not yet under a
          contract; bikes that are inactive or under a live contract are hidden.{' '}
          <Link href="/owner/motorcycles" className="font-semibold underline">
            Check the motorcycle register
          </Link>{' '}
          — or register one at{' '}
          <Link href="/owner/motorcycles/new" className="font-semibold underline">
            Add motorcycle
          </Link>
          .
        </p>
      )}
      {riders.length === 0 && (
        <p role="alert" className="rounded-[--radius-card] border border-warning bg-surface p-3 text-sm text-primary-dark">
          No eligible riders (only <em>active</em> or <em>onboarding</em> riders
          can hold a contract).{' '}
          <Link href="/owner/riders" className="font-semibold underline">
            Open the rider register
          </Link>
          .
        </p>
      )}
      <SelectField label="Rider" required error={errors.riderId?.message} defaultValue="" {...register('riderId')}>
        <option value="" disabled>Select rider…</option>
        {riders.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </SelectField>
      <SelectField label="Motorcycle" required error={errors.motorcycleId?.message} defaultValue="" {...register('motorcycleId')}>
        <option value="" disabled>Select motorcycle…</option>
        {visibleMotorcycles.map((m) => (
          <option key={m.id} value={m.id}>
            {m.assignedRiderId ? `${m.label} — already assigned to this rider` : m.label}
          </option>
        ))}
      </SelectField>
      {assignedToOthers.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Hidden: {assignedToOthers.map((m) => `${m.label} (assigned to ${m.assignedRiderLabel})`).join('; ')}.
          A bike assigned to a rider can only be leased to that rider — select
          them, or release the assignment on their rider page first.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Start date" type="date" required error={errors.startDate?.message} {...register('startDate')} />
        <TextField label="Duration (months)" type="number" min={1} required error={errors.durationMonths?.message} {...register('durationMonths')} />
      </div>

      <SelectField label="Schedule" required error={errors.scheduleType?.message} {...register('scheduleType')}>
        <option value="daily">Every day</option>
        <option value="selected_weekdays">Selected weekdays</option>
      </SelectField>

      {values.scheduleType === 'selected_weekdays' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Weekdays</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleWeekday(day)}
                className={`min-h-11 rounded-[--radius-card] border px-3 text-sm font-semibold ${
                  weekdays.includes(day) ? 'border-primary bg-primary text-white' : 'border-border bg-white text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {errors.selectedWeekdays && (
            <span className="text-xs text-overdue">{errors.selectedWeekdays.message}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Installment amount (TZS)" type="number" min={1} required error={errors.installmentAmount?.message} {...register('installmentAmount')} />
        <TextField label="Payment deadline" type="time" required error={errors.paymentDeadlineTime?.message} {...register('paymentDeadlineTime')} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" {...register('ownershipTransfers')} />
        <span>Ownership transfers to rider at completion</span>
      </label>
      {values.ownershipTransfers && (
        <TextAreaField label="Ownership transfer notes" error={errors.ownershipTransferNotes?.message} {...register('ownershipTransferNotes')} />
      )}
      <TextAreaField label="Special terms" error={errors.specialTerms?.message} {...register('specialTerms')} />

      {preview && (
        <div className="rounded-[--radius-card] border border-primary bg-surface p-4 text-sm">
          <p className="font-semibold text-primary-dark">Preview</p>
          <p className="text-foreground">
            {preview.count} obligations · total {formatTZS(preview.total)} · ends {preview.endDate}
          </p>
        </div>
      )}

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {isSubmitting ? 'Creating…' : 'Create draft contract'}
      </button>
    </form>
  );
}
