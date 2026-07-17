'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setMotorcycleRegistration } from '@/lib/motorcycles/actions';

const ERRORS: Record<string, string> = {
  required: 'Enter a registration number.',
  duplicate_registration: 'That registration is already used by another motorcycle.',
  update_failed: 'Could not save. Try again.',
};

/** Add or correct a registration number after it is issued (build spec #16). */
export function RegistrationForm({ id, current }: { id: string; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await setMotorcycleRegistration(id, value);
      if (res.ok) {
        router.refresh();
        setValue('');
      } else {
        setError(ERRORS[res.error] ?? 'Could not save.');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1"
          placeholder={current ? 'Correct registration…' : 'Add registration number'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !value.trim()}
          className="rounded-[--radius-card] bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : current ? 'Update' : 'Add'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
    </div>
  );
}
