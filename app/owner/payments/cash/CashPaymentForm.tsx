'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { recordCashPayment } from '@/lib/payments/actions';
import { requestCashPayment, updateCashRequest } from '@/lib/payments/cash-requests';
import type { CashCandidate, StaffReceiver } from '@/lib/payments/queries';
import { formatDate } from '@/lib/dates/format';
import {
  autoAllocate,
  allocationWarnings,
  remainderNote,
} from '@/lib/payments/auto-allocate';

type Recorded = { riderName: string; amount: number; days: number; date: string; mode: Mode };

/**
 * 'settle'  — the Director records cash and it settles immediately.
 * 'request' — an accountant records cash; it waits for the Director's
 *             confirmation before any money exists (client feedback #4).
 * 'edit'    — correcting a still-pending request ("in case the wrong amount
 *             was entered").
 */
export type Mode = 'settle' | 'request' | 'edit';

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
  already_requested: 'Another pending request already covers one of those days — check the approvals queue.',
  future_date: 'The payment date cannot be in the future.',
  invalid_date: 'The payment date is not valid.',
  not_outstanding: 'One of those days is no longer owed (already paid, waived or postponed) — reload the page.',
  invalid_obligations: 'The selected days no longer match this rider — reload the page.',
  contract_rider_mismatch: 'Those days do not belong to this rider — reload the page.',
  invalid_receiver: 'Choose who received the cash — it must be an active staff account.',
  duplicate_obligations: 'The same day was selected twice — reload the page.',
  not_pending: 'That request has already been decided — reload the page.',
  settlement_failed: 'Recording failed at the settlement step. Nothing was recorded — check the payments list, then retry.',
  no_obligations: 'Select at least one day.',
  invalid_amount: 'The selected days have no amount due.',
  forbidden: 'You do not have permission to record payments.',
  server_error: 'A server error occurred. Check the payments list before retrying so the payment is not recorded twice.',
};

export function CashPaymentForm({
  candidates,
  today,
  mode = 'settle',
  receivers = [],
  defaultReceiverId = '',
  claimedObligationIds = [],
  editRequest,
  paymentsHref = '/owner/payments',
}: {
  candidates: CashCandidate[];
  today: string;
  mode?: Mode;
  /** Active staff who could have taken the money (there may be two accountants). */
  receivers?: StaffReceiver[];
  defaultReceiverId?: string;
  /** Days already claimed by another pending request — hidden from selection. */
  claimedObligationIds?: string[];
  /** Present in 'edit' mode: the request being corrected. */
  editRequest?: {
    id: string;
    riderId: string;
    obligationIds: string[];
    paymentDate: string;
    note: string | null;
    receivedById: string;
  };
  paymentsHref?: string;
}) {
  const router = useRouter();
  const [riderId, setRiderId] = useState(editRequest?.riderId ?? '');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(editRequest?.obligationIds ?? []),
  );
  const [date, setDate] = useState(editRequest?.paymentDate ?? today);
  const [note, setNote] = useState(editRequest?.note ?? '');
  const [receivedById, setReceivedById] = useState(
    editRequest?.receivedById ?? defaultReceiverId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  /*
   * Manual = tick the exact days (the original behaviour, and still the
   * default when correcting a request). Automatic = type what the rider
   * handed over and let the system work out how many whole days it clears
   * (client feedback #5).
   */
  const [allocation, setAllocation] = useState<'manual' | 'auto'>('manual');
  const [cashReceived, setCashReceived] = useState('');

  // Days already spoken for by a DIFFERENT pending request are hidden so two
  // accountants cannot raise overlapping requests the Director then has to
  // untangle. The request being edited keeps its own days visible.
  const claimed = new Set(claimedObligationIds);
  for (const id of editRequest?.obligationIds ?? []) claimed.delete(id);

  const candidate = candidates.find((c) => c.riderId === riderId) ?? null;
  const visibleObligations = candidate
    ? candidate.obligations.filter((o) => !claimed.has(o.id))
    : [];

  /*
   * The automatic plan, recomputed on every render from the amount typed. It
   * is DERIVED, never stored in state: a stale allocation is a payment that
   * clears different days from the ones the owner was shown.
   *
   * Note the shape conversion — the pure allocator speaks the same
   * SelectableObligation vocabulary as the rider's own payment flow, so the
   * owner's cash page and the rider's Lipa Sasa allocate money identically.
   */
  const plan = autoAllocate(
    visibleObligations.map((o) => ({
      id: o.id,
      dueDate: o.dueDate,
      amountDue: o.amount,
      status: o.status,
    })),
    Number(cashReceived) || 0,
  );
  const planIds = new Set(plan.obligations.map((o) => o.id));
  const warnings = allocationWarnings(plan);

  const autoMode = allocation === 'auto' && mode !== 'edit';
  const effectiveIds = autoMode ? [...planIds] : [...selected];
  const total = autoMode
    ? plan.allocated
    : visibleObligations.filter((o) => selected.has(o.id)).reduce((s, o) => s + o.amount, 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!candidate || effectiveIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // In automatic mode the leftover change is written into the note at the
      // moment it is decided. A payment that does not equal the cash handed
      // over must say so on its own face, not in somebody's memory.
      const changeNote = autoMode ? remainderNote(plan) : '';
      const fullNote = [note.trim(), changeNote].filter(Boolean).join(' — ');
      const payload = {
        riderId: candidate.riderId,
        contractId: candidate.contractId,
        obligationIds: effectiveIds,
        paymentDate: date,
        note: fullNote,
        receivedById: receivedById || undefined,
      };
      const res =
        mode === 'edit' && editRequest
          ? await updateCashRequest(editRequest.id, {
              obligationIds: payload.obligationIds,
              paymentDate: payload.paymentDate,
              note: payload.note,
              receivedById: payload.receivedById,
            })
          : mode === 'request'
            ? await requestCashPayment(payload)
            : await recordCashPayment(payload);

      if (res.ok) {
        if (mode === 'edit') {
          router.push(paymentsHref);
          router.refresh();
          return;
        }
        // Confirm what was recorded (proof-of-record after the highest-stakes
        // action) rather than redirecting to a list with no feedback.
        setRecorded({
          riderName: candidate.riderName,
          amount: total,
          days: effectiveIds.length,
          date,
          mode,
        });
        setRiderId('');
        setSelected(new Set());
        setNote('');
        setCashReceived('');
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

  const submitLabel =
    mode === 'edit'
      ? 'Save changes'
      : mode === 'request'
        ? `Send for confirmation ${total ? `· ${tzs(total)}` : ''}`
        : `Record cash payment ${total ? `· ${tzs(total)}` : ''}`;

  return (
    <div className="flex flex-col gap-5">
      {recorded && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[--radius-card] border border-[color:var(--color-paid)] bg-[color:var(--color-paid)]/5 p-4"
        >
          <span className="font-semibold text-[color:var(--color-paid)]">
            {recorded.mode === 'request' ? '✓ Sent to the Director for confirmation' : '✓ Cash payment recorded'}
          </span>
          <span className="text-sm text-foreground">
            {recorded.riderName} · {tzs(recorded.amount)} · {recorded.days} day
            {recorded.days === 1 ? '' : 's'} · {formatDate(recorded.date)}
          </span>
          {recorded.mode === 'request' && (
            <span className="text-xs text-muted-foreground">
              Nothing is settled yet. The rider is notified once the Director confirms it.
            </span>
          )}
          <div className="flex gap-2">
            <Link
              href={paymentsHref}
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
        <select
          className="input bg-white"
          value={riderId}
          disabled={mode === 'edit'}
          onChange={(e) => {
            setRiderId(e.target.value);
            setSelected(new Set());
            setCashReceived('');
          }}
        >
          <option value="">Select rider…</option>
          {candidates.map((c) => (
            <option key={c.riderId} value={c.riderId}>{c.riderName} ({c.obligations.length} due)</option>
          ))}
        </select>
      </label>

      {/* Manual or automatic allocation (client feedback #5). Hidden when
          correcting an existing request: an edit is always about which
          specific days it covers. */}
      {candidate && mode !== 'edit' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">How should this be applied?</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label
              className={`flex flex-1 cursor-pointer items-start gap-2 rounded-[--radius-card] border p-3 ${
                allocation === 'manual' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="allocation"
                className="mt-0.5 h-4 w-4"
                checked={allocation === 'manual'}
                onChange={() => setAllocation('manual')}
              />
              <span className="text-sm">
                <span className="block font-semibold">Choose the days</span>
                <span className="block text-xs text-muted-foreground">
                  Tick exactly which days this money covers.
                </span>
              </span>
            </label>
            <label
              className={`flex flex-1 cursor-pointer items-start gap-2 rounded-[--radius-card] border p-3 ${
                allocation === 'auto' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="allocation"
                className="mt-0.5 h-4 w-4"
                checked={allocation === 'auto'}
                onChange={() => setAllocation('auto')}
              />
              <span className="text-sm">
                <span className="block font-semibold">Enter the amount</span>
                <span className="block text-xs text-muted-foreground">
                  The system clears the oldest unpaid days the money covers.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      )}

      {candidate && autoMode && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Cash received (TZS)</span>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              step={500}
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
              placeholder="e.g. 30000"
            />
          </label>

          {cashReceived !== '' && (
            <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border p-3">
              {warnings.map((w) => (
                <p
                  key={w.message}
                  role={w.level === 'error' ? 'alert' : undefined}
                  className={`text-sm ${
                    w.level === 'error'
                      ? 'font-medium text-overdue'
                      : w.level === 'warning'
                        ? 'font-medium text-[color:var(--color-warning)]'
                        : 'text-muted-foreground'
                  }`}
                >
                  {w.message}
                </p>
              ))}

              {/* The owner must SEE which days are about to be cleared before
                  confirming — the brief asks for this explicitly, and it is
                  the only thing standing between a typo and settled money. */}
              {plan.obligations.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
                  {plan.obligations.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className={o.dueDate < today ? 'text-overdue' : ''}>
                        ✓ {formatDate(o.dueDate)}
                      </span>
                      <span className="font-medium">{tzs(o.amountDue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {candidate && !autoMode && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Outstanding obligations (oldest first)</span>
          {visibleObligations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
              {visibleObligations.map((o) => (
                <li key={o.id}>
                  <label className="flex min-h-11 cursor-pointer items-center justify-between px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" className="h-5 w-5" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                      <span className={o.dueDate < today ? 'text-overdue' : ''}>{formatDate(o.dueDate)}</span>
                    </span>
                    <span className="font-medium">{tzs(o.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Payment date</span>
          <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {receivers.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Received by</span>
            <select
              className="input bg-white"
              value={receivedById}
              onChange={(e) => setReceivedById(e.target.value)}
            >
              {receivers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.role})
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Who physically took the money — shown on the rider&rsquo;s payment history.
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">Note (optional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}

      <button
        type="button"
        disabled={busy || effectiveIds.length === 0}
        onClick={submit}
        className="min-h-12 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}
