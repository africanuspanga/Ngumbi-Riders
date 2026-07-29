import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { getOwnerDashboard } from '@/lib/dashboard/queries';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateTime } from '@/lib/dates/format';

export const metadata = { title: 'Accountant dashboard' };

/**
 * Accountant dashboard (build spec #10). The same financial KPIs the owner
 * sees — the accountant's job is the books — but no fleet-management or
 * system-administration entry points.
 */
export default async function AccountantDashboard() {
  await requireAccountant();
  const d = await getOwnerDashboard();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          {formatDateTime(new Date())} · Dar es Salaam · all amounts in TZS
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Expected today" value={formatTZS(d.kpis.expectedToday)} />
        <Kpi label="Collected today" value={formatTZS(d.kpis.collectedToday)} />
        <Kpi label="Outstanding today" value={formatTZS(d.kpis.outstandingToday)} tone="warning" />
        <Kpi label="Total arrears" value={formatTZS(d.kpis.totalArrears)} tone="overdue" />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Card title="Riders who have not paid today" href="/accountant/outstanding" cta="See outstanding">
          {d.unpaidRiders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone is up to date.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {d.unpaidRiders.slice(0, 8).map((r) => (
                <li key={r.riderId} className="flex items-center justify-between py-2">
                  <span>{r.name}</span>
                  <span className="font-semibold text-[color:var(--color-overdue)]">{formatTZS(r.arrears)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Contracts ending soon" href="/accountant/contracts" cta="All contracts">
          {d.endingContracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None in the next 30 days.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {d.endingContracts.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <span>{c.rider}</span>
                  <span className="text-muted-foreground">{formatDate(c.endDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="flex flex-wrap gap-2">
        <Link
          href="/accountant/payments/cash"
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          Record a payment
        </Link>
        <Link
          href="/accountant/reports"
          className="rounded-[--radius-card] border border-border bg-white px-4 py-2.5 font-semibold text-primary-dark hover:bg-surface"
        >
          Reports
        </Link>
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'overdue' }) {
  const color =
    tone === 'overdue'
      ? 'text-[color:var(--color-overdue)]'
      : tone === 'warning'
        ? 'text-[color:var(--color-warning)]'
        : 'text-primary-dark';
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Card({
  title,
  href,
  cta,
  children,
}: {
  title: string;
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-primary-dark">{title}</h2>
        <Link href={href} className="text-xs font-semibold text-primary underline">
          {cta}
        </Link>
      </div>
      {children}
    </div>
  );
}
