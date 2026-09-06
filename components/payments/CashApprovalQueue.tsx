'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  approveCashRequest,
  rejectCashRequest,
  cancelCashRequest,
} from '@/lib/payments/cash-requests';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import type { CashRequestRow } from '@/lib/payments/queries';

/*
 * The Director's confirm / edit / reject queue for cash an accountant says
 * they received (client feedback 2026-09-05). Nothing here is settled money
 * yet: confirming is what creates the payment.
 *
 * Every failure mode gets plain English, because this screen is used with
 * physical cash in hand and a raw error code is useless at that moment.
 */
const ERRORS: Record<string, string> = {
  not_pending: 'That request was already decided — reload the page.',
  not_found: 'That request no longer exists — reload the page.',
  forbidden: 'Only the Director can confirm or reject a cash payment.',
  not_outstanding:
    'One of those days is no longer owed (it was paid, waived or postponed since the request was raised). Edit the request or reject it.',
  not_oldest_first:
    'The days no longer are the oldest outstanding ones — the rider paid something else in the meantime. Edit the request.',
  reserved_by_pending_payment:
    'One of those days has a mobile payment in progress. Wait for it to finish, then confirm.',
  invalid_obligations: 'Those days no longer match this rider — reload the page.',
  already_requested: 'Another pending request already covers one of those days.',
  settlement_failed:
    'Settlement failed — nothing was recorded. Check the payments list, then try again.',
  reason_required: 'Give a short reason so the accountant knows why it was rejected.',
  server_error: 'A server error occurred. Nothing was recorded — check the payments list first.',
};

export function CashApprovalQueue({
  requests,
  canDecide,
  editBasePath,
}: {
  requests: CashRequestRow[];
  /** Only the Director may confirm/reject; accountants see and may withdraw. */
  canDecide: boolean;
  /**
   * Where the "edit" button goes for this audience, e.g.
   * "/owner/payments/approvals" — the request id is appended.
   *
   * A STRING, not a builder function: this is a Client Component, and the
   * Server Components that render it cannot pass a function across the
   * boundary ("Functions cannot be passed directly to Client Components").
   * Taking the callback crashed both approvals pages in production.
   */
  editBasePath: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMessage: string) {
    setBusyId(id);
    setError(null);
    setDone(null);
    try {
      const res = await fn();
      if (res.ok) {
        setDone(okMessage);
        setRejecting(null);
        setReason('');
        router.refresh();
      } else {
        setError(ERRORS[res.error ?? ''] ?? 'That could not be completed. Reload and try again.');
      }
    } catch {
      setError('Network error — reload the payments list before retrying so nothing is recorded twice.');
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
        Nothing waiting for confirmation. ✓
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {done && (
        <p role="status" className="rounded-[--radius-card] border border-[color:var(--color-paid)] bg-[color:var(--color-paid)]/5 p-3 text-sm font-medium text-[color:var(--color-paid)]">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-[--radius-card] border border-[color:var(--color-overdue)] bg-red-50 p-3 text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      {requests.map((r) => (
        <article key={r.id} className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-primary-dark">
                {r.riderName} · {formatTZS(r.amount)}
              </p>
              <p className="text-muted-foreground text-xs">
                Cash received on {formatDate(r.paymentDate)} by{' '}
                <span className="font-medium text-foreground">{r.receivedByName}</span>
                {r.requestedByName !== r.receivedByName ? ` · entered by ${r.requestedByName}` : ''}
              </p>
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">
              raised {formatDateTime(r.createdAt)}
            </span>
          </header>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Covers</dt>
              <dd>
                {r.obligationDates.length} day{r.obligationDates.length === 1 ? '' : 's'}
                {r.obligationDates.length > 0
                  ? ` · ${formatDate(r.obligationDates[0])}${r.obligationDates.length > 1 ? ` – ${formatDate(r.obligationDates[r.obligationDates.length - 1])}` : ''}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Note</dt>
              <dd>{r.note || '—'}</dd>
            </div>
          </dl>

          {rejecting === r.id ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Why are you rejecting this?</span>
                <input
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. the rider only handed over 20,000"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => run(r.id, () => rejectCashRequest(r.id, reason), 'Request rejected.')}
                  className="min-h-11 rounded-[--radius-card] bg-[color:var(--color-overdue)] px-4 font-semibold text-white disabled:opacity-60"
                >
                  Confirm rejection
                </button>
                <button
                  type="button"
                  onClick={() => { setRejecting(null); setReason(''); }}
                  className="min-h-11 rounded-[--radius-card] border border-border px-4 font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canDecide && (
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() =>
                    run(r.id, () => approveCashRequest(r.id), `Confirmed — ${formatTZS(r.amount)} recorded for ${r.riderName}. The rider has been notified.`)
                  }
                  className="min-h-11 rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  {busyId === r.id ? 'Confirming…' : 'Confirm cash received'}
                </button>
              )}
              <Link
                href={`${editBasePath}/${r.id}`}
                className="flex min-h-11 items-center rounded-[--radius-card] border border-border bg-white px-4 font-semibold text-primary-dark hover:bg-surface"
              >
                Edit
              </Link>
              {canDecide ? (
                <button
                  type="button"
                  onClick={() => setRejecting(r.id)}
                  className="min-h-11 rounded-[--radius-card] border border-[color:var(--color-overdue)] px-4 font-semibold text-overdue"
                >
                  Reject
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => run(r.id, () => cancelCashRequest(r.id), 'Request withdrawn.')}
                  className="min-h-11 rounded-[--radius-card] border border-border px-4 font-semibold text-muted-foreground disabled:opacity-60"
                >
                  Withdraw
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
