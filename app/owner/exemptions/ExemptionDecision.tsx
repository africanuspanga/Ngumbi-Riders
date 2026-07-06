'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setExemptionUnderReview,
  waiveExemption,
  postponeExemption,
  rejectExemption,
} from '@/lib/exemptions/actions';

export function ExemptionDecision({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newDate, setNewDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const decided = ['approved_waived', 'approved_postponed', 'rejected', 'cancelled'].includes(status);
  if (decided) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? 'failed');
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <div className="flex flex-wrap gap-2">
        {status === 'submitted' && (
          <button type="button" disabled={pending} onClick={() => run(() => setExemptionUnderReview(id))} className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface">
            Kagua
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => run(() => waiveExemption(id))} className="rounded-[--radius-card] bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover">
          Samehe
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => rejectExemption(id))} className="rounded-[--radius-card] border border-border bg-white px-3 py-1.5 text-sm font-semibold text-overdue hover:bg-surface">
          Kataa
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input type="date" className="input max-w-[10rem]" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        <button type="button" disabled={pending || !newDate} onClick={() => run(() => postponeExemption(id, newDate))} className="rounded-[--radius-card] border border-primary bg-white px-3 py-1.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60">
          Ahirisha
        </button>
      </div>
      {error && <p className="text-xs text-overdue">{error === 'date_conflict' ? 'Tarehe hiyo tayari ina malipo.' : error}</p>}
    </div>
  );
}
