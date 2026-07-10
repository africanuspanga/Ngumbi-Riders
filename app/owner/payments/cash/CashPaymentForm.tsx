'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordCashPayment } from '@/lib/payments/actions';
import type { CashCandidate } from '@/lib/payments/queries';

function tzs(n: number) {
  return `TZS ${Math.round(n).toLocaleString('en-US')}`;
}

export function CashPaymentForm({ candidates, today }: { candidates: CashCandidate[]; today: string }) {
  const router = useRouter();
  const [riderId, setRiderId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidate = candidates.find((c) => c.riderId === riderId) ?? null;
  const total = candidate
    ? candidate.obligations.filter((o) => selected.has(o.id)).reduce((s, o) => s + o.amount, 0)
    : 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!candidate || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recordCashPayment({
        riderId: candidate.riderId,
        contractId: candidate.contractId,
        obligationIds: [...selected],
        paymentDate: date,
        note,
      });
      if (res.ok) {
        router.push('/owner/payments');
        router.refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Rider</span>
        <select className="input bg-white" value={riderId} onChange={(e) => { setRiderId(e.target.value); setSelected(new Set()); }}>
          <option value="">Select rider…</option>
          {candidates.map((c) => (
            <option key={c.riderId} value={c.riderId}>{c.riderName} ({c.obligations.length} due)</option>
          ))}
        </select>
      </label>

      {candidate && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Outstanding obligations (oldest first)</span>
          {candidate.obligations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
              {candidate.obligations.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-center justify-between px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" className="h-5 w-5" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                      <span className={o.dueDate < today ? 'text-overdue' : ''}>{o.dueDate}</span>
                    </span>
                    <span className="font-medium">{tzs(o.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Payment date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Note (optional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}

      <button
        type="button"
        disabled={busy || selected.size === 0}
        onClick={submit}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Recording…' : `Record cash payment ${total ? `· ${tzs(total)}` : ''}`}
      </button>
    </div>
  );
}
