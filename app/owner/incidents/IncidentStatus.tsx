'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateIncidentStatus } from '@/lib/incidents/actions';

const NEXT: Record<string, { key: string; label: string }[]> = {
  open: [{ key: 'in_progress', label: 'Start' }, { key: 'resolved', label: 'Resolve' }],
  in_progress: [{ key: 'resolved', label: 'Resolve' }],
  resolved: [],
};

export function IncidentStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = NEXT[status] ?? [];
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              setError(null);
              try {
                const res = await updateIncidentStatus(id, a.key);
                if (res.ok) router.refresh();
                else setError(`Could not ${a.label.toLowerCase()} this report. Please try again.`);
              } catch {
                setError(`Could not ${a.label.toLowerCase()} this report — network error.`);
              }
            })}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
    </div>
  );
}
