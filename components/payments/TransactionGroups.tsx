import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { methodLabel } from '@/lib/payments/statement';
import { PAYMENT_STATUS_LABELS_EN } from '@/lib/payments/labels';
import { groupPayments } from '@/lib/payments/grouping';

/*
 * The transaction ledger, grouped by outcome (client feedback 2026-09-06).
 *
 * A single flat list of 300 rows forced the owner to read every line to answer
 * "did this rider actually pay?". Grouped, the answer is the first section and
 * everything else explains why money did not arrive.
 *
 * A SERVER component: it only formats: no state, no handlers, nothing to
 * hydrate on a low-cost Android phone.
 */
export type TransactionRow = {
  id: string;
  amount: number;
  method: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  /* Optional because listAllPayments leaves it unset when the rider join
     returns nothing (a deleted rider, a payment imported without one). */
  rider_name?: string;
};

export function TransactionGroups({
  payments,
  riderHrefBase,
}: {
  payments: TransactionRow[];
  /** e.g. "/owner/payments/rider" — the rider id is NOT known here, so this
   *  is only used when a row can link somewhere useful. */
  riderHrefBase?: string;
}) {
  const groups = groupPayments(payments);

  if (groups.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
        No payments yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.group} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className={`font-semibold ${g.tone}`}>
              {g.label}{' '}
              <span className="text-muted-foreground text-sm font-normal">
                ({g.payments.length})
              </span>
            </h2>
            <span className={`font-mono text-sm font-semibold tabular-nums ${g.tone}`}>
              {formatTZS(g.total)}
            </span>
          </div>
          <p className="text-muted-foreground -mt-1 text-xs">{g.description}</p>

          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
            {g.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">
                    {p.rider_name ?? '—'} · {formatTZS(p.amount)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(p.completed_at ?? p.created_at)} · {methodLabel(p.method)}
                  </span>
                </div>
                <span className={`shrink-0 text-sm font-semibold ${g.tone}`}>
                  {PAYMENT_STATUS_LABELS_EN[p.status] ?? p.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {riderHrefBase && (
        <p className="text-muted-foreground text-xs">
          Open a rider from{' '}
          <Link href={riderHrefBase.replace(/\/rider$/, '')} className="underline">
            Payments
          </Link>{' '}
          to see their full history and statement.
        </p>
      )}
    </div>
  );
}
