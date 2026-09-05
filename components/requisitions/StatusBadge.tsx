import {
  REQUISITION_STATUS_LABELS,
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
