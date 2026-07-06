import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { listRiderPayments } from '@/lib/payments/queries';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Malipo' };

const TONE: Record<string, string> = {
  completed: 'text-[color:var(--color-paid)]',
  pending: 'text-[color:var(--color-warning)]',
  failed: 'text-[color:var(--color-overdue)]',
  expired: 'text-muted',
  cancelled: 'text-muted',
};

export default async function RiderPaymentsPage() {
  await requireRider();
  const payments = await listRiderPayments();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-primary-dark">Malipo yangu</h1>
      {payments.length === 0 ? (
        <p className="text-muted">Bado hujafanya malipo.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {payments.map((p) => (
            <li key={p.id}>
              <Link href={`/rider/payments/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface">
                <div className="flex flex-col">
                  <span className="font-semibold">{formatTZS(p.amount)}</span>
                  <span className="text-xs text-muted">
                    {(p.completed_at ?? p.created_at).slice(0, 10)} · {p.method === 'cash' ? 'Taslimu' : 'Pesa za simu'}
                  </span>
                </div>
                <span className={`text-sm font-semibold ${TONE[p.status] ?? 'text-muted'}`}>{p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
