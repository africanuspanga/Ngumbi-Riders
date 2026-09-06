import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listAllPayments } from '@/lib/payments/queries';
import { TransactionGroups } from '@/components/payments/TransactionGroups';

export const metadata = { title: 'All transactions' };

/**
 * The flat ledger, kept for reconciliation. The front door is now the directory.
 *
 * Grouped by outcome since 2026-09-06 (client feedback): successful money
 * first, then the reasons an attempt never became money.
 */
export default async function OwnerTransactionsPage() {
  await requireOwner();
  const payments = await listAllPayments();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/owner/payments" className="text-sm font-medium text-muted-foreground">
            ← Payments
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">All transactions</h1>
          <p className="text-muted-foreground text-sm">
            Most recent 300 mobile-money and cash transactions, grouped by outcome.
          </p>
        </div>
        <Link
          href="/owner/reconciliation"
          className="flex min-h-11 items-center rounded-[--radius-card] border border-border bg-white px-4 font-semibold text-primary-dark hover:bg-surface"
        >
          Reconcile
        </Link>
      </header>

      <TransactionGroups payments={payments} />
    </div>
  );
}
