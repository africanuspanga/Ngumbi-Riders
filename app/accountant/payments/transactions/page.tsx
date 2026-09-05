import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { listAllPayments } from '@/lib/payments/queries';
import { PAYMENT_STATUS_LABELS_EN } from '@/lib/payments/labels';
import { methodLabel } from '@/lib/payments/statement';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';

export const metadata = { title: 'All transactions' };

const TONE: Record<string, string> = {
  completed: 'text-[color:var(--color-paid)]',
  pending: 'text-[color:var(--color-warning)]',
  failed: 'text-[color:var(--color-overdue)]',
  expired: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
  reversed: 'text-[color:var(--color-overdue)]',
};

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
      </header>

      {payments.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          No payments yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">
                  {p.rider_name} · {formatTZS(p.amount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(p.completed_at ?? p.created_at)} · {methodLabel(p.method)}
                </span>
              </div>
              <span className={`shrink-0 text-sm font-semibold ${TONE[p.status] ?? 'text-muted-foreground'}`}>
                {PAYMENT_STATUS_LABELS_EN[p.status] ?? p.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
