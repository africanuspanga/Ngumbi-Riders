import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { getCollectionReport, getArrearsReport } from '@/lib/reports/queries';
import { localDateString } from '@/lib/dates/tz';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireOwner();
  const sp = await searchParams;
  const to = sp.to ?? localDateString();
  const from = sp.from ?? `${to.slice(0, 7)}-01`;

  const [collections, arrears] = await Promise.all([
    getCollectionReport(from, to),
    getArrearsReport(),
  ]);
  const rate = collections.collectionRate === null ? '—' : `${Math.round(collections.collectionRate * 100)}%`;
  const q = `?from=${from}&to=${to}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Reports</h1>
        <p className="text-sm text-muted">All amounts in TZS · Africa/Dar_es_Salaam.</p>
      </header>

      {/* Date range */}
      <form className="flex flex-wrap items-end gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <button type="submit" className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover">
          Apply
        </button>
      </form>

      {/* Collections */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-primary-dark">Collections ({from} → {to})</h2>
          <ExportLinks report="collections" q={q} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
          <Stat label="Expected" value={formatTZS(collections.expected)} />
          <Stat label="Settled" value={formatTZS(collections.settled)} />
          <Stat label="Collected" value={formatTZS(collections.paymentsReceived)} />
          <Stat label="Collection rate" value={rate} />
          <Stat label="Cash" value={formatTZS(collections.cash)} />
          <Stat label="Mobile money" value={formatTZS(collections.mobile)} />
          <Stat label="Arrears created" value={formatTZS(collections.arrearsCreated)} />
          <Stat label="Arrears recovered" value={formatTZS(collections.arrearsRecovered)} />
        </dl>
      </section>

      {/* Arrears */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-primary-dark">Arrears ({arrears.totalCount} obligations · {formatTZS(arrears.totalAmount)})</h2>
          <ExportLinks report="arrears" q="" />
        </div>
        {arrears.rows.length === 0 ? (
          <p className="text-sm text-muted">No arrears. ✓</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr><th className="py-1">Rider</th><th>Oldest</th><th>Days</th><th>Count</th><th className="text-right">Amount</th></tr>
              </thead>
              <tbody>
                {arrears.rows.slice(0, 50).map((r) => (
                  <tr key={r.riderId} className="border-t border-border">
                    <td className="py-1"><Link href={`/owner/riders/${r.riderId}`} className="text-primary-dark underline">{r.riderName}</Link></td>
                    <td>{r.oldestOverdue}</td>
                    <td>{r.daysOverdue}</td>
                    <td>{r.count}</td>
                    <td className="text-right font-medium text-overdue">{formatTZS(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex items-center justify-between rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Expenses ({from} → {to})</h2>
        <div className="flex items-center gap-3">
          <Link href="/owner/expenses" className="text-sm font-medium text-primary underline">Manage expenses</Link>
          <ExportLinks report="expenses" q={q} />
        </div>
      </section>
    </div>
  );
}

function ExportLinks({ report, q }: { report: string; q: string }) {
  const sep = q ? '&' : '?';
  return (
    <div className="flex gap-2 text-sm">
      <a href={`/api/reports/${report}/export${q}${sep}format=csv`} className="rounded-[--radius-card] border border-border px-3 py-1.5 font-medium text-primary-dark hover:bg-surface">CSV</a>
      <a href={`/api/reports/${report}/export${q}${sep}format=xlsx`} className="rounded-[--radius-card] border border-border px-3 py-1.5 font-medium text-primary-dark hover:bg-surface">Excel</a>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold text-foreground">{value}</dd>
    </div>
  );
}
