import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listRiderDirectory } from '@/lib/riders/queries';
import { listCashRequests } from '@/lib/payments/queries';
import { PaymentsDirectory } from '@/components/payments/PaymentsDirectory';
import { formatTZS } from '@/lib/money/format';
import { BanknoteIcon, ArrowRightIcon, ListIcon } from 'lucide-react';

export const metadata = { title: 'Payments' };

/**
 * Payments landing page (client feedback 2026-09-05): a rider directory, not
 * one long list of transactions. The flat ledger lives at ./transactions.
 */
export default async function OwnerPaymentsPage() {
  await requireOwner();
  const [riders, pending] = await Promise.all([
    listRiderDirectory(),
    listCashRequests(['pending']),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Payments</h1>
          <p className="text-muted-foreground text-sm">
            Every rider&rsquo;s position, history and statement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/owner/payments/cash"
            className="flex min-h-11 items-center gap-2 rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover"
          >
            <BanknoteIcon className="size-4" /> Record cash
          </Link>
          <Link
            href="/owner/payments/transactions"
            className="flex min-h-11 items-center gap-2 rounded-[--radius-card] border border-border bg-white px-4 font-semibold text-primary-dark hover:bg-surface"
          >
            <ListIcon className="size-4" /> All transactions
          </Link>
        </div>
      </header>

      {pending.length > 0 && (
        <Link
          href="/owner/payments/approvals"
          className="flex items-center justify-between gap-3 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span className="font-medium">
            {pending.length} cash payment{pending.length === 1 ? '' : 's'} awaiting your confirmation ·{' '}
            {formatTZS(pending.reduce((s, r) => s + r.amount, 0))}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-semibold">
            Review <ArrowRightIcon className="size-3.5" />
          </span>
        </Link>
      )}

      <PaymentsDirectory riders={riders} basePath="/owner/payments" />
    </div>
  );
}
