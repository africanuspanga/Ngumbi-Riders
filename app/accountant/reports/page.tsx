import { requireAccountant } from '@/lib/auth/session';
import Link from 'next/link';
import { getCollectionReport, getArrearsReport, getFinancialReport } from '@/lib/reports/queries';
import { methodLabel } from '@/lib/payments/statement';
import { localDateString } from '@/lib/dates/tz';
import { formatDate, formatDateRange } from '@/lib/dates/format';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Reports' };

/**
 * Accountant report centre (build spec #10). Daily / weekly / monthly / custom
 * ranges plus CSV + Excel export, sharing the owner's report math and the same
 * export endpoint (which authorises `reports.export` server-side).
 */
export default async function AccountantReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAccountant();
  const sp = await searchParams;
  const to = sp.to ?? localDateString();
  const from = sp.from ?? `${to.slice(0, 7)}-01`;

  const [collections, arrears, financial] = await Promise.all([
    getCollectionReport(from, to),
    getArrearsReport(),
    getFinancialReport(from, to),
  ]);
  const rate =
    collections.collectionRate === null ? '—' : `${Math.round(collections.collectionRate * 100)}%`;
  const q = `?from=${from}&to=${to}`;

  // Quick ranges the client asked for: daily, weekly, monthly and custom.
  const today = localDateString();
  const daysAgo = (n: number) => localDateString(new Date(Date.parse(`${today}T00:00:00+03:00`) - n * 86_400_000));
  const presets = [
    { label: 'Today', from: today, to: today },
    { label: 'Last 7 days', from: daysAgo(6), to: today },
    { label: 'This month', from: `${today.slice(0, 7)}-01`, to: today },
    { label: 'Last 30 days', from: daysAgo(29), to: today },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Reports</h1>
        <p className="text-sm text-muted-foreground">
          All amounts in TZS · Africa/Dar_es_Salaam · dates shown DD/MM/YYYY.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <a
            key={p.label}
            href={`/accountant/reports?from=${p.from}&to=${p.to}`}
            className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-surface"
          >
            {p.label}
          </a>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <button
          type="submit"
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          Apply
        </button>
      </form>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">
            Collections ({formatDateRange(from, to)})
          </h2>
          <ExportLinks report="collections" q={q} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
          <Stat label="Expected" value={formatTZS(collections.expected)} />
          <Stat label="Settled" value={formatTZS(collections.settled)} />
          <Stat label="Collected" value={formatTZS(collections.paymentsReceived)} />
          <Stat label="Collection rate" value={rate} />
          <Stat label="Cash" value={formatTZS(collections.cash)} />
          <Stat label="Mobile money" value={formatTZS(collections.mobile)} />
        </dl>
      </section>

      {/* General financial report — bank-statement style (client feedback). */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">
            Financial statement ({formatDateRange(from, to)})
          </h2>
          <ExportLinks report="financial" q={q} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
          <Stat label="Total collected" value={formatTZS(financial.totals.total)} />
          <Stat label="Cash" value={formatTZS(financial.totals.cash)} />
          <Stat label="Mobile money" value={formatTZS(financial.totals.mobile)} />
          <Stat
            label="Payments"
            value={`${financial.totals.payments} from ${financial.totals.riders} rider${financial.totals.riders === 1 ? '' : 's'}`}
          />
        </dl>
        {financial.contributions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No money was collected in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2">Rider</th>
                  <th className="px-2 py-2 text-right">Payments</th>
                  <th className="px-2 py-2 text-right">Cash</th>
                  <th className="px-2 py-2 text-right">Mobile</th>
                  <th className="px-2 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {financial.contributions.map((r) => (
                  <tr key={r.riderId} className="border-t border-border">
                    <td className="px-2 py-2">
                      <Link href={`/accountant/payments/rider/${r.riderId}`} className="underline">
                        {r.riderName}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.payments}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{formatTZS(r.cash)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{formatTZS(r.mobile)}</td>
                    <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">{formatTZS(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-primary-dark">
            Every transaction ({financial.transactions.length})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Rider</th>
                  <th className="px-2 py-2">Method</th>
                  <th className="px-2 py-2">Received by</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {financial.transactions.map((t) => (
                  <tr key={t.paymentId} className="border-t border-border">
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="px-2 py-2">{t.riderName}</td>
                    <td className="px-2 py-2">{methodLabel(t.method)}</td>
                    <td className="px-2 py-2">{t.receivedByName ?? '—'}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{formatTZS(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">
            Arrears · {arrears.totalCount} obligation(s) · {formatTZS(arrears.totalAmount)}
          </h2>
          <ExportLinks report="arrears" q={q} />
        </div>
        {arrears.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No arrears. Everyone is up to date.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2">Rider</th>
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">Oldest unpaid</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {arrears.rows.slice(0, 100).map((r) => (
                  <tr key={r.riderId} className="border-t border-border">
                    <td className="px-2 py-2">{r.riderName}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.riderNumber}</td>
                    <td className="px-2 py-2 text-muted-foreground">{formatDate(r.oldestOverdue)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-[color:var(--color-overdue)]">
                      {formatTZS(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function ExportLinks({ report, q }: { report: string; q: string }) {
  return (
    <span className="flex gap-2 text-xs">
      <a
        href={`/api/reports/${report}/export${q}&format=csv`}
        className="rounded-[--radius-card] border border-border px-2.5 py-1 font-semibold text-primary-dark hover:bg-surface"
      >
        CSV
      </a>
      <a
        href={`/api/reports/${report}/export${q}&format=xlsx`}
        className="rounded-[--radius-card] border border-border px-2.5 py-1 font-semibold text-primary-dark hover:bg-surface"
      >
        Excel
      </a>
    </span>
  );
}
