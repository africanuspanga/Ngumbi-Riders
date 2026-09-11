'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  startPhoneLoanReview,
  linkPhoneLoanRequisition,
  markPhoneLoanPurchased,
  activatePhoneLoan,
  rejectPhoneLoanRequest,
} from '@/lib/loans/requests';
import { NEXT_ACTOR, type PhoneLoanRequestStatus } from '@/lib/loans/constants';

/*
 * The buttons that move a phone-loan request along (client feedback #12).
 *
 * WHICH BUTTONS APPEAR is decided from the status and the viewer's role — but
 * that is only a convenience. Every one of these actions re-checks its
 * permission server-side with checkPermission(), and rejection past the
 * requisition stage is owner-only there, not here. Hiding a button is not
 * access control (spec rule 12).
 *
 * Every result is inspected and failures are shown. These actions fail for
 * ordinary reasons — a colleague advanced the request a moment ago, the
 * contract stopped being active, a phone instalment date collides with a lease
 * day — and a silent no-op would leave the accountant clicking a dead button
 * (the 2026-07-11 silent-failure sweep).
 */

const ERRORS: Record<string, string> = {
  invalid_transition: 'This request has already moved on — reload the page.',
  not_found: 'That request no longer exists — reload the page.',
  forbidden: 'You do not have permission to do that.',
  owner_only: 'Only the Managing Director can reject a request once a purchase has been raised.',
  no_contract: 'The rider has no contract to attach the instalments to.',
  contract_not_active: 'The rider’s contract is not active, so a loan cannot be attached to it.',
  already_paused: 'That contract is already paused for another phone loan.',
  date_conflict:
    'An instalment date collides with an existing payment day on this contract. Nothing was created.',
  total_mismatch:
    'The generated instalments did not add up to the agreed loan, so nothing was created. Report this.',
  activation_failed: 'Activation failed and nothing was created. Reload and try again.',
  requisition_not_found: 'That purchase request could not be found.',
  requisition_closed: 'That purchase request has already been rejected or withdrawn.',
  reason_required: 'Give a short reason.',
  server_error: 'A server error occurred. Reload the page before retrying.',
};

export function PhoneLoanActions({
  requestId,
  status,
  viewerRole,
  requisitionsHref,
}: {
  requestId: string;
  status: PhoneLoanRequestStatus;
  viewerRole: 'owner' | 'accountant';
  requisitionsHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [linking, setLinking] = useState(false);
  const [requisitionId, setRequisitionId] = useState('');

  // The owner sees every button (they can act at any stage); the accountant
  // sees only the stages that are theirs.
  const canAct = viewerRole === 'owner' || NEXT_ACTOR[status] === 'accountant';
  const closed = status === 'completed' || status === 'rejected' || status === 'cancelled';

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.ok) {
        setRejecting(false);
        setLinking(false);
        setReason('');
        setRequisitionId('');
        router.refresh();
      } else {
        setError(ERRORS[res.error ?? ''] ?? 'That did not work. Reload the page and try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether it went through.');
    } finally {
      setBusy(false);
    }
  }

  if (closed) return null;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}

      {linking && (
        <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-surface p-3">
          <p className="text-sm">
            Raise the purchase requisition for the handset first, then paste its id here to link
            the two. The Director approving that purchase will advance this request automatically.
          </p>
          <Link href={requisitionsHref} className="text-sm font-medium text-primary underline">
            Open purchase requests →
          </Link>
          <input
            className="input"
            value={requisitionId}
            onChange={(e) => setRequisitionId(e.target.value)}
            placeholder="Requisition id (from its URL)"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || requisitionId.trim().length < 10}
              onClick={() => run(() => linkPhoneLoanRequisition(requestId, requisitionId.trim()))}
              className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Linking…' : 'Link purchase request'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setLinking(false)}
              className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Reason (the rider will see this)</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < 3}
              onClick={() => run(() => rejectPhoneLoanRequest(requestId, reason))}
              className="min-h-11 rounded-[--radius-card] bg-[color:var(--color-overdue)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Rejecting…' : 'Confirm rejection'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(false)}
              className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!rejecting && !linking && (
        <div className="flex flex-wrap gap-2">
          {canAct && status === 'submitted' && (
            <Primary busy={busy} onClick={() => run(() => startPhoneLoanReview(requestId))}>
              Start finance review
            </Primary>
          )}
          {canAct && (status === 'submitted' || status === 'under_review') && (
            <Secondary busy={busy} onClick={() => setLinking(true)}>
              Link purchase request
            </Secondary>
          )}
          {canAct && status === 'requisition_approved' && (
            <Primary busy={busy} onClick={() => run(() => markPhoneLoanPurchased(requestId))}>
              Mark phone purchased
            </Primary>
          )}
          {canAct && status === 'purchased' && (
            <Primary busy={busy} onClick={() => run(() => activatePhoneLoan(requestId))}>
              Activate loan &amp; pause the lease
            </Primary>
          )}
          {status === 'requisition_raised' && (
            <p className="text-sm text-muted-foreground">
              Waiting on the purchase requisition decision.
            </p>
          )}
          {status === 'active' && (
            <p className="text-sm text-muted-foreground">
              Repaying. The lease resumes by itself on the final instalment.
            </p>
          )}
          {status !== 'active' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-overdue disabled:opacity-60"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Primary({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

function Secondary({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
    >
      {children}
    </button>
  );
}
