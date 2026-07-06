'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { expenseSchema, type ExpenseInput, EXPENSE_CATEGORIES } from '@/lib/expenses/validation';
import { addExpense } from '@/lib/expenses/actions';
import { TextField, SelectField } from '@/components/forms/Field';

type Moto = { id: string; label: string };

export function ExpenseForm({ motorcycles, today }: { motorcycles: Moto[]; today: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseInput>({ resolver: zodResolver(expenseSchema), defaultValues: { expenseDate: today } });

  async function onSubmit(values: ExpenseInput) {
    setError(null);
    const res = await addExpense(values);
    if (res.ok) {
      reset({ expenseDate: today });
      router.refresh();
    } else {
      setError('Could not save the expense.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
      <SelectField label="Motorcycle" required error={errors.motorcycleId?.message} defaultValue="" {...register('motorcycleId')}>
        <option value="" disabled>Select…</option>
        {motorcycles.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </SelectField>
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Date" type="date" required error={errors.expenseDate?.message} {...register('expenseDate')} />
        <TextField label="Amount (TZS)" type="number" min={1} required error={errors.amount?.message} {...register('amount')} />
      </div>
      <SelectField label="Category" required error={errors.category?.message} defaultValue="" {...register('category')}>
        <option value="" disabled>Select…</option>
        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </SelectField>
      <TextField label="Note (optional)" error={errors.note?.message} {...register('note')} />
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <button type="submit" disabled={isSubmitting} className="self-start rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
        {isSubmitting ? 'Saving…' : 'Add expense'}
      </button>
    </form>
  );
}
