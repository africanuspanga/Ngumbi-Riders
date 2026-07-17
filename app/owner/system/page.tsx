import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { getSystemHealth } from '@/lib/system/queries';
import { formatLocalDateTime } from '@/lib/dates/tz';

export const metadata = { title: 'System health' };

function ago(iso: string | null): string {
  if (!iso) return 'never';
  // EAT wall-clock — the nightly jobs run 21:00-24:00 UTC, already the next EAT day.
  return formatLocalDateTime(new Date(iso));
}

export default async function SystemPage() {
  await requireOwner();
  const h = await getSystemHealth();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-dark">System health</h1>
        <Link href="/owner/audit" className="text-sm font-medium text-primary underline">Audit log →</Link>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <Dot label="Snippe" on={h.integrations.snippe} />
        <Dot label="Resend" on={h.integrations.resend} />
        <Dot label="Web push" on={h.integrations.push} />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric label="Pending payments" value={String(h.pendingPayments)} tone={h.pendingPayments > 0 ? 'warn' : 'ok'} />
        <Metric label="Failed jobs" value={String(h.failedJobs)} tone={h.failedJobs > 0 ? 'bad' : 'ok'} />
        <Metric label="Last webhook" value={ago(h.lastWebhookAt)} />
        <Metric label="Last reconciliation" value={ago(h.lastReconciliationAt)} />
        <Metric label="Last daily summary" value={ago(h.lastDailySummaryAt)} />
      </section>

      <div className="rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3 text-sm text-[color:var(--color-warning)]">
        ⚠ Reminder: storage objects (documents, receipts) are NOT covered by
        database backups — verify the separate storage backup process.
      </div>

      <section className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Recent job runs</h2>
        {h.recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No job runs yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground"><tr><th className="py-1">Job</th><th>Status</th><th>Started</th><th>Counts</th></tr></thead>
            <tbody>
              {h.recentRuns.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1">{r.job_name}</td>
                  <td className={r.status === 'failed' ? 'text-overdue' : r.status === 'success' ? 'text-[color:var(--color-paid)]' : 'text-muted-foreground'}>{r.status}</td>
                  <td className="text-muted-foreground">{ago(r.started_at)}</td>
                  <td className="text-xs text-muted-foreground">{r.error_summary ?? JSON.stringify(r.counts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Dot({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[--radius-card] border border-border bg-white p-3">
      <span className={`h-3 w-3 rounded-full ${on ? 'bg-[color:var(--color-paid)]' : 'bg-[color:var(--color-exempt)]'}`} />
      <span className="text-sm font-medium">{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{on ? 'configured' : 'off'}</span>
    </div>
  );
}
function Metric({ label, value, tone = 'ok' }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-overdue' : tone === 'warn' ? 'text-[color:var(--color-warning)]' : 'text-foreground';
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-3">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
