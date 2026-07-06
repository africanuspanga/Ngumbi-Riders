import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { getOwnerDashboard } from '@/lib/dashboard/queries';
import { formatTZS } from '@/lib/money/format';
import { LogoutButton } from '@/components/auth/LogoutButton';

export const metadata = { title: 'Dashboard' };

export default async function OwnerHome() {
  const profile = await requireOwner();
  const d = await getOwnerDashboard();
  const rate = d.kpis.collectionRate === null ? '—' : `${Math.round(d.kpis.collectionRate * 100)}%`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-dark">
          Karibu{profile.fullName ? `, ${profile.fullName}` : ''}
        </h1>
        <LogoutButton />
      </header>

      {d.warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 p-3 text-sm text-[color:var(--color-warning)]">
          {d.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}

      {/* KPI cards (spec §14.1) */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Expected today" value={formatTZS(d.kpis.expectedToday)} />
        <Kpi label="Settled for today" value={formatTZS(d.kpis.settledToday)} tone="text-[color:var(--color-paid)]" />
        <Kpi label="Collected today" value={formatTZS(d.kpis.collectedToday)} />
        <Kpi label="Outstanding today" value={formatTZS(d.kpis.outstandingToday)} tone="text-[color:var(--color-warning)]" />
        <Kpi label="Collection rate" value={rate} />
        <Kpi label="Total arrears" value={formatTZS(d.kpis.totalArrears)} tone="text-[color:var(--color-overdue)]" />
        <Kpi label="Paid riders" value={String(d.kpis.paidRiders)} />
        <Kpi label="Unpaid riders" value={String(d.kpis.unpaidRiders)} tone="text-[color:var(--color-overdue)]" />
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Mini label="Active riders" value={d.activeRiders} />
        <Mini label="Active motorcycles" value={d.activeMotorcycles} />
        <Mini label="Applications" value={d.applicationsAwaiting} href="/owner/applications" />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Who hasn't paid">
          {d.unpaidRiders.length === 0 ? (
            <p className="text-sm text-muted">Everyone is up to date. ✓</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {d.unpaidRiders.slice(0, 8).map((r) => (
                <li key={r.riderId} className="flex justify-between py-2">
                  <Link href={`/owner/riders/${r.riderId}`} className="text-primary-dark underline">{r.name}</Link>
                  <span className="font-semibold text-overdue">{formatTZS(r.arrears)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Arrears aging">
          <ul className="flex flex-col gap-1 text-sm">
            <AgingRow label="1 day" value={d.aging.oneDay} />
            <AgingRow label="2–3 days" value={d.aging.twoToThree} />
            <AgingRow label="4–7 days" value={d.aging.fourToSeven} />
            <AgingRow label="8–30 days" value={d.aging.eightToThirty} />
            <AgingRow label="30+ days" value={d.aging.overThirty} />
          </ul>
        </Panel>

        <Panel title="Contracts ending soon (30 days)">
          {d.endingContracts.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {d.endingContracts.map((c) => (
                <li key={c.id} className="flex justify-between py-2">
                  <Link href={`/owner/contracts/${c.id}`} className="text-primary-dark underline">{c.number} · {c.rider}</Link>
                  <span className="text-muted">{c.endDate}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="High-risk riders">
          {d.highRiskRiders.length === 0 ? (
            <p className="text-sm text-muted">None flagged.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {d.highRiskRiders.map((r) => (
                <li key={r.id} className="flex justify-between py-2">
                  <Link href={`/owner/riders/${r.id}`} className="text-primary-dark underline">{r.name}</Link>
                  <span className="font-semibold text-overdue">{r.risk}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Navigation */}
      <nav className="grid gap-3 sm:grid-cols-3">
        <NavCard href="/owner/applications" title="Applications" />
        <NavCard href="/owner/riders" title="Riders" />
        <NavCard href="/owner/motorcycles" title="Motorcycles" />
        <NavCard href="/owner/contracts" title="Contracts" />
        <NavCard href="/owner/payments" title="Payments" />
        <NavCard href="/owner/incidents" title="Incidents" />
        <NavCard href="/owner/exemptions" title="Exemptions" />
        <NavCard href="/owner/announcements" title="Announcements" />
        <NavCard href="/owner/reports" title="Reports" />
        <NavCard href="/owner/expenses" title="Expenses" />
        <NavCard href="/owner/imports" title="Imports" />
        <NavCard href="/owner/system" title="System" />
      </nav>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-3">
      <div className={`text-lg font-bold ${tone ?? 'text-primary-dark'}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
function Mini({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="rounded-[--radius-card] border border-border bg-white p-3 text-center">
      <div className="text-xl font-bold text-primary-dark">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
      <h2 className="font-semibold text-primary-dark">{title}</h2>
      {children}
    </section>
  );
}
function AgingRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{formatTZS(value)}</span>
    </li>
  );
}
function NavCard({ href, title }: { href: string; title: string }) {
  return (
    <Link href={href} className="rounded-[--radius-card] border border-border bg-white px-4 py-3 text-center font-semibold text-primary-dark hover:bg-surface">
      {title}
    </Link>
  );
}
