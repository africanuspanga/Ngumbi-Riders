import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { listCashRequests } from '@/lib/payments/queries';
import { CashApprovalQueue } from '@/components/payments/CashApprovalQueue';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';

export const metadata = { title: 'Awaiting confirmation' };

/**
 * What the accountant has sent to the Director. They can correct or withdraw a
 * request, but never confirm one — confirmation is the Director's decision.
 */
export default async function AccountantApprovalsPage() {
  await requireAccountant();
  const [pending, decided] = await Promise.all([
    listCashRequests(['pending']),
    listCashRequests(['approved', 'rejected', 'cancelled'], 30),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link href="/accountant/payments" className="text-sm font-medium text-muted-foreground">
          ← Payments
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Awaiting the Director&rsquo;s confirmation
        </h1>
        <p className="text-muted-foreground text-sm">
          {pending.length === 0
            ? 'Nothing pending.'
            : `${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} · ${formatTZS(pending.reduce((s, r) => s + r.amount, 0))}. None of it is settled yet.`}
        </p>
      </header>

      <CashApprovalQueue
        requests={pending}
        canDecide={false}
        editBasePath="/accountant/payments/approvals"
      />

      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Recently decided</h2>
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
            {decided.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.riderName} · {formatTZS(r.amount)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    cash on {formatDate(r.paymentDate)} · received by {r.receivedByName}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={
                      r.status === 'approved'
                        ? 'font-semibold text-[color:var(--color-paid)]'
                        : 'font-semibold text-muted-foreground'
                    }
                  >
                    {r.status}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {r.decidedAt ? formatDateTime(r.decidedAt) : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
