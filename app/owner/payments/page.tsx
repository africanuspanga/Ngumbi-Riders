import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listAllPayments } from '@/lib/payments/queries';
import { PAYMENT_STATUS_LABELS_EN } from '@/lib/payments/labels';
import { formatTZS } from '@/lib/money/format';
import { localDateString } from '@/lib/dates/tz';

export const metadata = { title: 'Payments' };

const TONE: Record<string, string> = {
  completed: 'text-[color:var(--color-paid)]',
  pending: 'text-[color:var(--color-warning)]',
  failed: 'text-[color:var(--color-overdue)]',
  expired: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
  reversed: 'text-[color:var(--color-overdue)]',
};

export default async function OwnerPaymentsPage() {
  await requireOwner();
  const payments = await listAllPayments();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">Payments</h1>
          <p className="text-sm text-muted-foreground">All mobile-money and cash transactions.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/owner/payments/cash" className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover">
            Record cash
          </Link>
          <Link href="/owner/reconciliation" className="rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold text-primary-dark hover:bg-surface">
            Reconcile
          </Link>
        </div>
      </header>

      {payments.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">No payments yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col">
                <span className="font-semibold">{p.rider_name} · {formatTZS(p.amount)}</span>
                <span className="text-xs text-muted-foreground">
                  {localDateString(new Date(p.completed_at ?? p.created_at))} · {p.method === 'cash' ? 'Cash' : 'Mobile money'}
                </span>
              </div>
              <span className={`text-sm font-semibold ${TONE[p.status] ?? 'text-muted-foreground'}`}>{PAYMENT_STATUS_LABELS_EN[p.status] ?? p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
