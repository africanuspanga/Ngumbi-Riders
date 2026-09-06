'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BanknoteIcon, CheckIcon, UndoIcon } from 'lucide-react';
import { setRequisitionPaymentStatus } from '@/lib/requisitions/actions';
import {
  PAYMENT_STATUS_DESCRIPTIONS,
  PAYMENT_STATUS_LABELS,
  type RequisitionPaymentStatus,
} from '@/lib/requisitions/constants';
import { nextPaymentStatuses } from '@/lib/requisitions/compute';

/*
 * The owner's record of whether an approved purchase has actually been paid
 * for (client feedback 2026-09-06). The accountant used to have to ask in
 * person; now they are notified in the app and, once the Mobishastra
 * credentials are live, by SMS.
 *
 * This is NOT the rider ledger. Marking a purchase paid creates no payment,
 * obligation, allocation or receipt — it records what the owner says happened
 * with a supplier, and the wording says so.
 */
const ERRORS: Record<string, string> = {
  forbidden: 'Only the Managing Director can record payment for a purchase request.',
  not_found: 'That request no longer exists — reload the page.',
  not_approved: 'Only an approved request can be paid for.',
  invalid_transition: 'That stage has already moved — reload the page.',
  invalid_status: 'That is not a payment stage.',
  server_error: 'A server error occurred. Reload the request and check before trying again.',
};

const ICON: Record<RequisitionPaymentStatus, typeof BanknoteIcon> = {
  unpaid: UndoIcon,
  processing: BanknoteIcon,
  paid: CheckIcon,
};

/** Verb for moving TO a stage, so the button reads as an action. */
const ACTION_LABELS: Record<RequisitionPaymentStatus, string> = {
  unpaid: 'Move back to not paid',
  processing: 'Mark payment processing',
  paid: 'Mark as paid',
};

export function PaymentActions({
  requisitionId,
  paymentStatus,
}: {
  requisitionId: string;
  paymentStatus: RequisitionPaymentStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<RequisitionPaymentStatus | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = nextPaymentStatuses(paymentStatus);

  async function move(to: RequisitionPaymentStatus) {
    setBusy(to);
    setError(null);
    try {
      const res = await setRequisitionPaymentStatus(requisitionId, to, note);
      if (res.ok) {
        setNote('');
        router.refresh();
      } else {
        setError(ERRORS[res.error] ?? 'That could not be completed. Reload and try again.');
      }
    } catch {
      setError('Network error — reload the request before retrying.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
      <div>
        <h2 className="text-primary-dark font-semibold">Payment</h2>
        <p className="text-muted-foreground text-sm">
          Currently <strong>{PAYMENT_STATUS_LABELS[paymentStatus].toLowerCase()}</strong>.{' '}
          {PAYMENT_STATUS_DESCRIPTIONS[paymentStatus]} The accountant is notified whenever this
          changes.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Note (optional)</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="e.g. CRDB transfer ref 88213, paid in full"
          className="min-h-11 rounded-[--radius-card] border border-border px-3"
        />
      </label>

      {error && (
        <p role="alert" className="text-overdue text-sm font-medium">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {options.map((to) => {
          const Icon = ICON[to];
          // Moving backwards is a correction, not the main path, so it never
          // gets the primary button — a mis-tap there should feel deliberate.
          const isForward = to !== 'unpaid';
          return (
            <button
              key={to}
              type="button"
              disabled={busy !== null}
              onClick={() => move(to)}
              className={
                isForward
                  ? 'flex min-h-11 items-center gap-2 rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-60'
                  : 'text-primary-dark flex min-h-11 items-center gap-2 rounded-[--radius-card] border border-border bg-white px-4 font-semibold hover:bg-surface disabled:opacity-60'
              }
            >
              <Icon className="size-4 shrink-0" />
              {busy === to ? 'Saving…' : ACTION_LABELS[to]}
            </button>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs">
        This records a purchase order, not rider collections — it never creates a payment or a
        receipt in the ledger.
      </p>
    </section>
  );
}
