import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import { PAYMENT_STATUS_LABELS_EN } from '@/lib/payments/labels';
import { methodLabel } from '@/lib/payments/statement';
import type { RiderPaymentRow } from '@/lib/payments/queries';

/*
 * Per-rider payment history (client feedback 2026-09-05):
 * "There should be a payment history for every rider showing when they made
 *  each payment and which payment method was used, cash or through the system.
 *  If the payment was made in cash, the system should show the name of the
 *  person who received the cash because I may have two accountants."
 *
 * So the receiver is a first-class column, not a detail buried in the audit
 * log. Server component: it renders once and needs no interactivity.
 */
const TONE: Record<string, string> = {
  completed: 'text-[color:var(--color-paid)]',
  pending: 'text-[color:var(--color-warning)]',
  failed: 'text-[color:var(--color-overdue)]',
  reversed: 'text-[color:var(--color-overdue)]',
  expired: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
};

export function PaymentHistory({
  payments,
  receiptHref,
}: {
  payments: RiderPaymentRow[];
  /** Where a receipt lives for this audience, or null to hide the link. */
  receiptHref?: ((paymentId: string) => string) | null;
}) {
  if (payments.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
        No payments recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Method</th>
            <th className="px-3 py-2 font-medium">Received by</th>
            <th className="px-3 py-2 font-medium">Covers</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0 align-top">
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(p.completedAt ?? p.createdAt)}
                <span className="text-muted-foreground block text-xs">
                  {formatDateTime(p.completedAt ?? p.createdAt).slice(-5)}
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {methodLabel(p.method)}
                {p.method === 'mobile_money' && p.payerPhone ? (
                  <span className="text-muted-foreground block text-xs">{p.payerPhone}</span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {p.method === 'cash' ? (
                  <>
                    <span className="font-medium">{p.receivedByName ?? '—'}</span>
                    {p.recordedByName && p.recordedByName !== p.receivedByName ? (
                      <span className="text-muted-foreground block text-xs">
                        recorded by {p.recordedByName}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">System</span>
                )}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-xs">
                {p.coveredDates.length === 0
                  ? '—'
                  : p.coveredDates.length === 1
                    ? formatDate(p.coveredDates[0])
                    : `${p.coveredDates.length} days · ${formatDate(p.coveredDates[0])} – ${formatDate(p.coveredDates[p.coveredDates.length - 1])}`}
                {p.note ? <span className="block italic">{p.note}</span> : null}
              </td>
              <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                {formatTZS(p.amount)}
              </td>
              <td className={`px-3 py-2 font-medium ${TONE[p.status] ?? 'text-muted-foreground'}`}>
                {PAYMENT_STATUS_LABELS_EN[p.status] ?? p.status}
              </td>
              <td className="px-3 py-2 text-xs">
                {p.receiptNumber ? (
                  receiptHref ? (
                    <Link href={receiptHref(p.id)} className="text-primary font-medium hover:underline">
                      {p.receiptNumber}
                    </Link>
                  ) : (
                    <span className="font-mono">{p.receiptNumber}</span>
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
