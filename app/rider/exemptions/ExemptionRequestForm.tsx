'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createExemptionRequest } from '@/lib/exemptions/actions';

type Obligation = { id: string; dueDate: string; amount: number };

export function ExemptionRequestForm({ obligations }: { obligations: Obligation[] }) {
  const router = useRouter();
  const [obligationId, setObligationId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!obligationId || reason.trim().length < 5) {
      setError('Chagua siku na eleza sababu.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createExemptionRequest({ obligationId, reason });
    setBusy(false);
    if (res.ok) {
      setObligationId('');
      setReason('');
      router.refresh();
    } else {
      setError('Imeshindikana kutuma ombi.');
    }
  }

  if (obligations.length === 0) {
    return <p className="text-sm text-muted">Huna malipo yanayoweza kuombewa msamaha.</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
      <p className="text-sm font-semibold text-primary-dark">Omba msamaha</p>
      <select className="input bg-white" value={obligationId} onChange={(e) => setObligationId(e.target.value)}>
        <option value="">Chagua siku ya malipo…</option>
        {obligations.map((o) => (
          <option key={o.id} value={o.id}>{o.dueDate} · TZS {o.amount.toLocaleString('en-US')}</option>
        ))}
      </select>
      <textarea className="input min-h-20" placeholder="Sababu (mf. pikipiki imeharibika)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="text-xs text-overdue">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="self-start rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? 'Inatuma…' : 'Tuma ombi'}
      </button>
    </div>
  );
}
