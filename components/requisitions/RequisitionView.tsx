import Link from 'next/link';
import { InfoIcon, ShoppingCartIcon, PaperclipIcon } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';
import {
  BUDGET_COVER_LABELS,
  DEPARTMENT_LABELS,
  ITEM_CATEGORY_LABELS,
  UNIT_LABELS,
} from '@/lib/requisitions/constants';
import type { RequisitionDetail } from '@/lib/requisitions/queries';

/*
 * The request exactly as the Managing Director reads it before deciding, and
 * exactly as the accountant reads it back afterwards — one component, so the
 * two can never show different figures.
 *
 * Every amount is recomputed from the lines (lib/requisitions/compute.ts);
 * nothing here reads a stored total, because there isn't one.
 */
export function RequisitionView({
  requisition,
  documentHref,
}: {
  requisition: RequisitionDetail;
  /** Route that signs and redirects to one attachment. */
  documentHref: (documentId: string) => string;
}) {
  const r = requisition;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold text-primary">
          <InfoIcon className="size-4" /> Request information
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail label="Request number" value={r.requisitionNumber} mono />
          <Detail label="Request date" value={formatDate(r.requestDate)} />
          <Detail label="Title" value={r.title} className="sm:col-span-2" />
          {r.description && (
            <Detail label="Description" value={r.description} className="sm:col-span-2" wrap />
          )}
          <Detail label="Department" value={DEPARTMENT_LABELS[r.department] ?? r.department} />
          <Detail label="Fiscal year" value={String(r.fiscalYear)} />
          <Detail label="Currency" value={r.currency} />
          <Detail label="Raised by" value={r.requestedByName} />
          {r.paymentInformation && (
            <Detail
              label="Payment information"
              value={r.paymentInformation}
              className="sm:col-span-2"
              wrap
            />
          )}
        </dl>
      </section>

      <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold text-primary">
          <ShoppingCartIcon className="size-4" /> Request items
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-muted-foreground border-b border-border text-xs uppercase">
              <tr>
                <th className="px-2 py-2 font-semibold">Item description</th>
                <th className="px-2 py-2 font-semibold">Category</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 font-semibold">UOM</th>
                <th className="px-2 py-2 text-right font-semibold">Unit price</th>
                <th className="px-2 py-2 text-right font-semibold">Amount</th>
                <th className="px-2 py-2 font-semibold">Budget cover</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2.5">{item.description}</td>
                  <td className="px-2 py-2.5">
                    {ITEM_CATEGORY_LABELS[item.category] ?? item.category}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{item.quantity}</td>
                  <td className="px-2 py-2.5">{UNIT_LABELS[item.unit] ?? item.unit}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                    {formatTZS(item.unitPrice)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono font-semibold tabular-nums">
                    {formatTZS(item.amount)}
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground">
                    {BUDGET_COVER_LABELS[item.budgetCover] ?? item.budgetCover}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="px-2 pt-3 text-right font-semibold">
                  Total amount
                </td>
                <td className="border-t-2 border-primary px-2 pt-3 text-right font-mono text-base font-bold tabular-nums text-primary-dark">
                  {formatTZS(r.total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold text-primary">
          <PaperclipIcon className="size-4" /> Supporting documents
        </h2>
        {r.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents attached.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
            {r.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="truncate">{d.fileName}</span>
                <Link
                  href={documentHref(d.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs font-semibold text-primary underline"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[--radius-card] border border-border bg-white p-4 sm:p-5">
        <h2 className="border-b-2 border-primary pb-2 font-semibold text-primary-dark">
          Managing Director
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label="Approver" value={r.approverName ?? 'Not set'} />
          <Detail
            label="Approval date"
            value={r.decidedAt ? formatDateTime(r.decidedAt) : 'To be filled upon approval'}
          />
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs font-medium text-muted-foreground uppercase">Status</dt>
            <dd>
              <StatusBadge status={r.status} />
            </dd>
          </div>
          {r.decidedByName && <Detail label="Decided by" value={r.decidedByName} />}
          {r.decisionNote && (
            <Detail label="Note" value={r.decisionNote} className="sm:col-span-2" wrap />
          )}
        </dl>
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  className = '',
  mono,
  wrap,
}: {
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <dt className="text-xs font-medium text-muted-foreground uppercase">{label}</dt>
      <dd
        className={`text-sm ${mono ? 'font-mono font-semibold' : ''} ${wrap ? 'whitespace-pre-line' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
