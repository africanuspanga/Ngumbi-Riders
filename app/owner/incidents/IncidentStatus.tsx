'use client';

import { useTransition } from 'react';
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
  const actions = NEXT[status] ?? [];
  if (actions.length === 0) return null;
  return (
    <div className="flex gap-2">
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await updateIncidentStatus(id, a.key); router.refresh(); })}
          className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
