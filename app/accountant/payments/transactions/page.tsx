import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { listAllPayments } from '@/lib/payments/queries';
import { TransactionGroups } from '@/components/payments/TransactionGroups';

export const metadata = { title: 'All transactions' };

/** Same grouped ledger the owner sees (client feedback 2026-09-06). */
export default async function AccountantTransactionsPage() {
  await requireAccountant();
  const payments = await listAllPayments();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <Link href="/accountant/payments" className="text-sm font-medium text-muted-foreground">
          ← Payments
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">All transactions</h1>
        <p className="text-muted-foreground text-sm">
          Most recent 300 transactions, grouped by outcome.
        </p>
      </header>

      <TransactionGroups payments={payments} />
    </div>
  );
}
