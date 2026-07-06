import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { reconciliationSummary } from '@/lib/payments/queries';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Reconciliation' };

export default async function ReconciliationPage() {
  await requireOwner();
  const s = await reconciliationSummary();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/owner/payments" className="text-sm font-medium text-muted">← Payments</Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Snippe reconciliation</h1>
        <p className="text-sm text-muted">
          Pending and failed payments to review. The reconciliation cron (Phase 8)
          will auto-resolve stale pending attempts against Snippe.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Pending" value={s.pending} tone="text-[color:var(--color-warning)]" />
        <Stat label="Failed" value={s.failed} tone="text-[color:var(--color-overdue)]" />
      </div>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Stale pending (&gt; 1 hour)</h2>
        {s.stalePending.length === 0 ? (
          <p className="text-sm text-muted">None. ✓</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {s.stalePending.map((p) => (
              <li key={p.id} className="flex justify-between py-2">
                <span>{formatTZS(p.amount)}</span>
                <span className="text-muted">{p.created_at.slice(0, 16).replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-4">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
