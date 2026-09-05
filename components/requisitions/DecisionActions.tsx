'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon, XIcon } from 'lucide-react';
import { approveRequisition, rejectRequisition } from '@/lib/requisitions/actions';
import { formatTZS } from '@/lib/money/format';

/*
 * The Managing Director's decision. Approving authorises a purchase, so every
 * failure is spelled out in plain English rather than an error code — this
 * screen is used with a supplier waiting on the phone.
 */
const ERRORS: Record<string, string> = {
  forbidden: 'Only the Managing Director can approve or reject a purchase request.',
  not_found: 'That request no longer exists — reload the page.',
  not_pending: 'That request was already decided — reload the page.',
  reason_required: 'Give a short reason so the accountant knows why it was rejected.',
  server_error: 'A server error occurred. Reload the list and check before trying again.',
};

export function DecisionActions({
  requisitionId,
  total,
}: {
  requisitionId: string;
  total: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'approve' | 'reject') {
    setBusy(kind);
    setError(null);
    try {
      const res =
        kind === 'approve'
          ? await approveRequisition(requisitionId, note)
          : await rejectRequisition(requisitionId, reason);
      if (res.ok) {
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'That could not be completed. Reload and try again.');
      }
    } catch {
      setError('Network error — reload the request before retrying so it is not decided twice.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[--radius-card] border-2 border-primary bg-surface p-4 sm:p-5">
      <div>
        <h2 className="font-semibold text-primary-dark">Your decision</h2>
        <p className="text-sm text-muted-foreground">
          Approving authorises this purchase of {formatTZS(total)}. The accountant is
          notified either way.
        </p>
      </div>

      {!rejecting && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Note (optional)</span>
          <textarea
            className="input min-h-20 bg-white"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the accountant should know — e.g. negotiate the price first"
          />
        </label>
      )}

      {rejecting && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Reason for rejection <span className="text-[color:var(--color-overdue)]">*</span>
          </span>
          <textarea
            className="input min-h-20 bg-white"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Too expensive — get two more quotations first"
            autoFocus
          />
        </label>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-[--radius-card] border border-[color:var(--color-overdue)]/30 bg-white px-3 py-2 text-sm font-medium text-[color:var(--color-overdue)]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {!rejecting ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('approve')}
              className="inline-flex items-center gap-2 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              <CheckIcon className="size-4" />
              {busy === 'approve' ? 'Approving…' : 'Approve request'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setRejecting(true)}
              className="inline-flex items-center gap-2 rounded-[--radius-card] border border-[color:var(--color-overdue)] bg-white px-4 py-2.5 font-semibold text-[color:var(--color-overdue)] hover:bg-[color:var(--color-overdue)]/10 disabled:opacity-60"
            >
              <XIcon className="size-4" /> Reject
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={() => run('reject')}
              className="inline-flex items-center gap-2 rounded-[--radius-card] bg-[color:var(--color-overdue)] px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              <XIcon className="size-4" />
              {busy === 'reject' ? 'Rejecting…' : 'Confirm rejection'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setRejecting(false);
                setReason('');
                setError(null);
              }}
              className="rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold hover:bg-surface"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </section>
  );
}
