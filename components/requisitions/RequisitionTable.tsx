import Link from 'next/link';
import { StatusBadge, PaymentBadge } from './StatusBadge';
import { RequisitionPdfLink } from './RequisitionPdfLink';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { DEPARTMENT_LABELS } from '@/lib/requisitions/constants';
import type { RequisitionSummary } from '@/lib/requisitions/queries';

/*
 * One list, both audiences. The accountant sees who it is with; the Director
 * sees who raised it — controlled by `showRequester` rather than two tables
 * that would drift apart.
 */
export function RequisitionTable({
  requisitions,
  hrefFor,
  showRequester = false,
  emptyMessage,
}: {
  requisitions: RequisitionSummary[];
  hrefFor: (requisition: RequisitionSummary) => string;
  showRequester?: boolean;
  emptyMessage: string;
}) {
  if (requisitions.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-muted-foreground border-b border-border text-xs uppercase">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Request</th>
            <th className="px-3 py-2.5 font-semibold">Department</th>
            <th className="px-3 py-2.5 font-semibold">Date</th>
            {showRequester && <th className="px-3 py-2.5 font-semibold">Raised by</th>}
            <th className="px-3 py-2.5 text-right font-semibold">Total</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Payment</th>
            <th className="px-3 py-2.5 font-semibold">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requisitions.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface">
              <td className="px-3 py-3">
                <Link href={hrefFor(r)} className="font-semibold text-primary-dark underline">
                  {r.title}
                </Link>
                <span className="text-muted-foreground block font-mono text-xs">
                  {r.requisitionNumber} · {r.itemCount} item{r.itemCount === 1 ? '' : 's'}
                </span>
              </td>
              <td className="px-3 py-3">{DEPARTMENT_LABELS[r.department] ?? r.department}</td>
              <td className="px-3 py-3">{formatDate(r.requestDate)}</td>
              {showRequester && <td className="px-3 py-3">{r.requestedByName}</td>}
              <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">
                {formatTZS(r.total)}
              </td>
              <td className="px-3 py-3">
                <StatusBadge status={r.status} />
                {r.status === 'rejected' && r.decisionNote ? (
                  <span className="text-muted-foreground mt-1 block max-w-56 truncate text-xs">
                    {r.decisionNote}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-3">
                {/* Blank rather than "not paid" for anything unapproved: a
                    rejected request is not waiting for money. */}
                <PaymentBadge status={r.status} paymentStatus={r.paymentStatus} />
                {r.status === 'approved' && r.paymentNote ? (
                  <span className="text-muted-foreground mt-1 block max-w-56 truncate text-xs">
                    {r.paymentNote}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-3">
                <RequisitionPdfLink requisitionId={r.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
