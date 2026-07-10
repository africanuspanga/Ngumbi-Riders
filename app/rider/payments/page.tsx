import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { listRiderPayments } from '@/lib/payments/queries';
import { formatTZS } from '@/lib/money/format';
import { localDateString } from '@/lib/dates/tz';

export const metadata = { title: 'Malipo' };

const TONE: Record<string, string> = {
  completed: 'text-[color:var(--color-paid)]',
  pending: 'text-[color:var(--color-warning)]',
  failed: 'text-[color:var(--color-overdue)]',
  expired: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
};

// Rider-facing: Swahili labels, never raw status enums (spec §36.11).
const STATUS_LABEL: Record<string, string> = {
  created: 'Inasubiri',
  pending: 'Inasubiri',
  completed: 'Imekamilika',
  failed: 'Imeshindikana',
  expired: 'Imeisha muda',
  cancelled: 'Imeghairiwa',
  reversed: 'Imerejeshwa',
};

export default async function RiderPaymentsPage() {
  await requireRider();
  const payments = await listRiderPayments();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-primary-dark">Malipo yangu</h1>
      {payments.length === 0 ? (
        <p className="text-muted-foreground">Bado hujafanya malipo.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {payments.map((p) => (
            <li key={p.id}>
              <Link href={`/rider/payments/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface">
                <div className="flex flex-col">
                  <span className="font-semibold">{formatTZS(p.amount)}</span>
                  <span className="text-xs text-muted-foreground">
                    {localDateString(new Date(p.completed_at ?? p.created_at))} · {p.method === 'cash' ? 'Taslimu' : 'Pesa za simu'}
                  </span>
                </div>
                <span className={`text-sm font-semibold ${TONE[p.status] ?? 'text-muted-foreground'}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
