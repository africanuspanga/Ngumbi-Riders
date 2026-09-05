import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { listRiderDirectory } from '@/lib/riders/queries';
import { listCashRequests } from '@/lib/payments/queries';
import { PaymentsDirectory } from '@/components/payments/PaymentsDirectory';
import { formatTZS } from '@/lib/money/format';
import { BanknoteIcon, ListIcon, ClockIcon } from 'lucide-react';

export const metadata = { title: 'Payments' };

/** Accountant payments: the same rider-centric directory the owner sees. */
export default async function AccountantPaymentsPage() {
  await requireAccountant();
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
            href="/accountant/payments/cash"
            className="flex min-h-11 items-center gap-2 rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover"
          >
            <BanknoteIcon className="size-4" /> Record payment
          </Link>
          <Link
            href="/accountant/payments/transactions"
            className="flex min-h-11 items-center gap-2 rounded-[--radius-card] border border-border bg-white px-4 font-semibold text-primary-dark hover:bg-surface"
          >
            <ListIcon className="size-4" /> All transactions
          </Link>
        </div>
      </header>

      {pending.length > 0 && (
        <Link
          href="/accountant/payments/approvals"
          className="flex items-center justify-between gap-3 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span className="flex items-center gap-2 font-medium">
            <ClockIcon className="size-4 shrink-0" />
            {pending.length} cash entr{pending.length === 1 ? 'y is' : 'ies are'} waiting for the
            Director · {formatTZS(pending.reduce((s, r) => s + r.amount, 0))}
          </span>
          <span className="shrink-0 font-semibold">View</span>
        </Link>
      )}

      <PaymentsDirectory riders={riders} basePath="/accountant/payments" />
    </div>
  );
}
