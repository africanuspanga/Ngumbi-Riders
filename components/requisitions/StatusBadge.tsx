import {
  PAYMENT_STATUS_LABELS,
  REQUISITION_STATUS_LABELS,
  RETIREMENT_STATUS_LABELS,
  type RequisitionPaymentStatus,
  type RequisitionRetirementStatus,
  type RequisitionStatus,
} from '@/lib/requisitions/constants';

/*
 * One status, one colour, everywhere. Approved is the money-green already used
 * for a settled payment; awaiting approval is the same amber as an obligation
 * that is due; rejected is the overdue red (spec §6.1).
 */
const TONE: Record<RequisitionStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  submitted:
    'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]',
  // Under review shares the awaiting-decision amber: from the accountant's
  // side both mean the same thing — it is not their move.
  under_review:
    'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]',
  approved:
    'border-[color:var(--color-paid)]/30 bg-[color:var(--color-paid)]/10 text-[color:var(--color-paid)]',
  rejected:
    'border-[color:var(--color-overdue)]/30 bg-[color:var(--color-overdue)]/10 text-[color:var(--color-overdue)]',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: RequisitionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[status]}`}
    >
      {REQUISITION_STATUS_LABELS[status]}
    </span>
  );
}

/*
 * The money half of a requisition's state (0029). Shown ONLY next to an
 * approved request: "not paid" against a rejected one would imply the purchase
 * is merely awaiting money when in fact it was refused.
 *
 * Paid is the settled green; processing is the in-flight amber; not-paid is
 * deliberately neutral rather than red — an approved purchase nobody has paid
 * for yet is normal, not a problem.
 */
const PAYMENT_TONE: Record<RequisitionPaymentStatus, string> = {
  unpaid: 'border-border bg-muted text-muted-foreground',
  processing:
    'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]',
  paid: 'border-[color:var(--color-paid)]/30 bg-[color:var(--color-paid)]/10 text-[color:var(--color-paid)]',
};

export function PaymentBadge({
  status,
  paymentStatus,
}: {
  status: RequisitionStatus;
  paymentStatus: RequisitionPaymentStatus;
}) {
  if (status !== 'approved') return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${PAYMENT_TONE[paymentStatus]}`}
    >
      {PAYMENT_STATUS_LABELS[paymentStatus]}
    </span>
  );
}

/*
 * The ACCOUNTING half (0033): whether money already released has been
 * accounted for. A third badge rather than a longer payment badge, because
 * "paid" and "retired" answer different questions — money left, and money was
 * explained — and a reader needs to see which of the two is missing.
 *
 * Hidden at 'not_started', which is the honest default for a purchase nobody
 * has paid for yet: there is nothing to account for, so saying so would be
 * noise on every unpaid row.
 */
const RETIREMENT_TONE: Record<RequisitionRetirementStatus, string> = {
  not_started: 'border-border bg-muted text-muted-foreground',
  pending:
    'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]',
  completed:
    'border-[color:var(--color-paid)]/30 bg-[color:var(--color-paid)]/10 text-[color:var(--color-paid)]',
};

export function RetirementBadge({
  status,
  retirementStatus,
}: {
  status: RequisitionStatus;
  retirementStatus: RequisitionRetirementStatus;
}) {
  if (status !== 'approved' || retirementStatus === 'not_started') return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${RETIREMENT_TONE[retirementStatus]}`}
    >
      {RETIREMENT_STATUS_LABELS[retirementStatus]}
    </span>
  );
}
