'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { recordCashPayment } from '@/lib/payments/actions';
import type { CashCandidate } from '@/lib/payments/queries';

type Recorded = { riderName: string; amount: number; days: number; date: string };

function tzs(n: number) {
  return `TZS ${Math.round(n).toLocaleString('en-US')}`;
}

// Server error codes → owner-facing copy. These guards fire in NORMAL use
// (ticking a later day without the earlier one, cash during an in-flight
// mobile payment) — raw snake_case codes are cryptic at the moment the owner
// is holding physical money.
const CASH_ERRORS: Record<string, string> = {
  not_oldest_first: 'Payments must cover the OLDEST outstanding days first — tick the days from the top without gaps.',
  reserved_by_pending_payment:
    'One of those days has a mobile payment in progress. Wait for it to complete or fail (stale attempts clear within the hour), then record the cash.',
  future_date: 'The payment date cannot be in the future.',
  invalid_date: 'The payment date is not valid.',
  not_outstanding: 'One of those days is no longer owed (already paid, waived or postponed) — reload the page.',
  invalid_obligations: 'The selected days no longer match this rider — reload the page.',
  contract_rider_mismatch: 'Those days do not belong to this rider — reload the page.',
  settlement_failed: 'Recording failed at the settlement step. Nothing was recorded — check the payments list, then retry.',
  no_obligations: 'Select at least one day.',
  invalid_amount: 'The selected days have no amount due.',
  server_error: 'A server error occurred. Check the payments list before retrying so the payment is not recorded twice.',
};

export function CashPaymentForm({ candidates, today }: { candidates: CashCandidate[]; today: string }) {
  const router = useRouter();
  const [riderId, setRiderId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);

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
        // Confirm what was recorded (proof-of-record after the highest-stakes
        // owner action) rather than redirecting to a list with no feedback.
        setRecorded({
          riderName: candidate.riderName,
          amount: total,
          days: selected.size,
          date,
        });
        setRiderId('');
        setSelected(new Set());
        setNote('');
        router.refresh();
      } else {
        setError(CASH_ERRORS[res.error] ?? 'Could not record the payment. Reload the page and try again.');
      }
    } catch {
      // Money mutation: the request may or may not have reached the server.
      setError('Network error — check the payments list before retrying so the payment is not recorded twice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {recorded && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[--radius-card] border border-[color:var(--color-paid)] bg-[color:var(--color-paid)]/5 p-4"
        >
          <span className="font-semibold text-[color:var(--color-paid)]">✓ Cash payment recorded</span>
          <span className="text-sm text-foreground">
            {recorded.riderName} · {tzs(recorded.amount)} · {recorded.days} day
            {recorded.days === 1 ? '' : 's'} · {recorded.date}
          </span>
          <div className="flex gap-2">
            <Link
              href="/owner/payments"
              className="rounded-[--radius-card] bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              View payments
            </Link>
            <button
              type="button"
              onClick={() => setRecorded(null)}
              className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface"
            >
              Record another
            </button>
          </div>
        </div>
      )}
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
