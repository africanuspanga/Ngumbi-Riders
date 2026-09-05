import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listCashRequests } from '@/lib/payments/queries';
import { CashApprovalQueue } from '@/components/payments/CashApprovalQueue';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';

export const metadata = { title: 'Cash approvals' };

/**
 * The Director's confirm/reject queue (client feedback #4). An accountant's
 * cash entry is not money until it is confirmed here.
 */
export default async function CashApprovalsPage() {
  await requireOwner();
  const [pending, decided] = await Promise.all([
    listCashRequests(['pending']),
    listCashRequests(['approved', 'rejected', 'cancelled'], 30),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link href="/owner/payments" className="text-sm font-medium text-muted-foreground">
          ← Payments
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Cash awaiting confirmation
        </h1>
        <p className="text-muted-foreground text-sm">
          {pending.length === 0
            ? 'Nothing pending.'
            : `${pending.length} request${pending.length === 1 ? '' : 's'} · ${formatTZS(pending.reduce((s, r) => s + r.amount, 0))}. Nothing is settled until you confirm it.`}
        </p>
      </header>

      <CashApprovalQueue
        requests={pending}
        canDecide
        editHref={(r) => `/owner/payments/approvals/${r.id}`}
      />

      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Recently decided</h2>
          <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 font-medium">Rider</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Received by</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {r.riderName}
                      <span className="text-muted-foreground block text-xs">
                        cash on {formatDate(r.paymentDate)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTZS(r.amount)}</td>
                    <td className="px-3 py-2">{r.receivedByName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.status === 'approved'
                            ? 'font-medium text-[color:var(--color-paid)]'
                            : 'font-medium text-muted-foreground'
                        }
                      >
                        {r.status}
                      </span>
                      {r.decisionNote ? (
                        <span className="text-muted-foreground block text-xs">{r.decisionNote}</span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {r.decidedAt ? formatDateTime(r.decidedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
