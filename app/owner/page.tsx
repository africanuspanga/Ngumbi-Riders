import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { getOwnerDashboard, getCollectionsSeries, getRiderBalances } from '@/lib/dashboard/queries';
import { listCashRequests } from '@/lib/payments/queries';
import { listRequisitionsForDashboard } from '@/lib/requisitions/queries';
import { formatTZS } from '@/lib/money/format';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CollectionsChart } from '@/components/owner/collections-chart';
import { BalanceChart } from '@/components/owner/balance-chart';
import { LiveClock } from '@/components/owner/live-clock';
import { formatClockDate, formatClockTime } from '@/lib/dates/clock';
import {
  TriangleAlertIcon,
  ArrowRightIcon,
  BanknoteIcon,
  ClipboardCheckIcon,
} from 'lucide-react';
import { formatDate } from '@/lib/dates/format';

export const metadata = { title: 'Dashboard' };

export default async function OwnerHome() {
  const profile = await requireOwner();
  const [d, series, balances, pendingCash, pendingRequisitions] = await Promise.all([
    getOwnerDashboard(),
    getCollectionsSeries(14),
    getRiderBalances(12),
    listCashRequests(['pending']),
    listRequisitionsForDashboard({ statuses: ['submitted'] }),
  ]);
  const rate = d.kpis.collectionRate === null ? '—' : `${Math.round(d.kpis.collectionRate * 100)}%`;
  // Rendered on the server for the first paint; LiveClock takes over on mount.
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {/* Date + time sits top-RIGHT, as the owner asked, and ticks live. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            Karibu{profile.fullName ? ` Mr ${profile.fullName}` : ''}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{d.activeRiders} active riders</Badge>
            <Badge variant="secondary">{d.activeMotorcycles} motorcycles out</Badge>
          </div>
        </div>
        <LiveClock initialDate={formatClockDate(now)} initialTime={formatClockTime(now)} />
      </header>

      {pendingCash.length > 0 && (
        <Link
          href="/owner/payments/approvals"
          className="flex items-center justify-between gap-3 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span className="flex items-center gap-2 font-medium">
            <BanknoteIcon className="size-4 shrink-0" />
            {pendingCash.length} cash payment{pendingCash.length === 1 ? '' : 's'} awaiting your
            confirmation ·{' '}
            {formatTZS(pendingCash.reduce((s, r) => s + r.amount, 0))}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-semibold">
            Review <ArrowRightIcon className="size-3.5" />
          </span>
        </Link>
      )}

      {pendingRequisitions.length > 0 && (
        <Link
          href="/owner/requisitions"
          className="flex items-center justify-between gap-3 rounded-[--radius-card] border border-[color:var(--color-warning)] bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span className="flex items-center gap-2 font-medium">
            <ClipboardCheckIcon className="size-4 shrink-0" />
            {pendingRequisitions.length} purchase request
            {pendingRequisitions.length === 1 ? '' : 's'} awaiting your approval ·{' '}
            {formatTZS(pendingRequisitions.reduce((s, r) => s + r.total, 0))}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-semibold">
            Review <ArrowRightIcon className="size-3.5" />
          </span>
        </Link>
      )}

      {d.warnings.length > 0 && (
        <Card className="border-[color:var(--color-warning)]/40 bg-amber-50 shadow-none">
          <CardContent className="flex flex-col gap-1 text-sm text-amber-800">
            {d.warnings.map((w) => (
              <p key={w} className="flex items-center gap-2">
                <TriangleAlertIcon className="size-4 shrink-0" /> {w}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* KPI cards (spec §14.1) */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Expected today"
          value={formatTZS(d.kpis.expectedToday)}
          footnote="due from active contracts"
        />
        <StatCard
          label="Collected today"
          value={formatTZS(d.kpis.collectedToday)}
          footnote={`${formatTZS(d.kpis.settledToday)} settled against today`}
          tone="text-[color:var(--color-paid)]"
        />
        <StatCard
          label="Outstanding today"
          value={formatTZS(d.kpis.outstandingToday)}
          footnote={`${d.kpis.unpaidRiders} rider(s) not settled yet`}
          tone={d.kpis.outstandingToday > 0 ? 'text-[color:var(--color-warning)]' : undefined}
        />
        <StatCard
          label="Collection rate"
          value={rate}
          footnote={`${d.kpis.paidRiders} paid · ${d.kpis.unpaidRiders} unpaid`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <BalanceChart
          points={balances.points}
          totalOutstandingNow={balances.totalOutstandingNow}
          totalRemaining={balances.totalRemaining}
          riderCount={balances.riderCount}
        />
        <CollectionsChart data={series} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-3">
          <CardHeader>
            <CardTitle>Arrears aging</CardTitle>
            <CardDescription>
              {formatTZS(d.kpis.totalArrears)} total arrears
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <AgingBar label="1 day" value={d.aging.oneDay} total={d.kpis.totalArrears} />
            <AgingBar label="2–3 days" value={d.aging.twoToThree} total={d.kpis.totalArrears} />
            <AgingBar label="4–7 days" value={d.aging.fourToSeven} total={d.kpis.totalArrears} />
            <AgingBar label="8–30 days" value={d.aging.eightToThirty} total={d.kpis.totalArrears} />
            <AgingBar label="31+ days" value={d.aging.overThirty} total={d.kpis.totalArrears} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle>Who hasn&rsquo;t paid</CardTitle>
            <CardDescription>Riders with outstanding obligations, largest first</CardDescription>
            <CardAction>
              <Link
                href="/owner/riders"
                className="text-primary flex items-center gap-1 text-sm font-medium hover:underline"
              >
                All riders <ArrowRightIcon className="size-3.5" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {d.unpaidRiders.length === 0 ? (
              <p className="text-muted-foreground text-sm">Everyone is up to date. ✓</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rider</TableHead>
                    <TableHead className="text-right">Arrears</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.unpaidRiders.slice(0, 8).map((r) => (
                    <TableRow key={r.riderId}>
                      <TableCell>
                        <Link href={`/owner/riders/${r.riderId}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium text-[color:var(--color-overdue)] tabular-nums">
                        {formatTZS(r.arrears)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>Contracts ending soon</CardTitle>
              <CardDescription>Next 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {d.endingContracts.length === 0 ? (
                <p className="text-muted-foreground text-sm">None.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.endingContracts.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <Link href={`/owner/contracts/${c.id}`} className="truncate font-medium hover:underline">
                        {c.number} · {c.rider}
                      </Link>
                      <span className="text-muted-foreground shrink-0 text-xs">{formatDate(c.endDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>High-risk riders</CardTitle>
              <CardDescription>Flagged by the risk engine</CardDescription>
            </CardHeader>
            <CardContent>
              {d.highRiskRiders.length === 0 ? (
                <p className="text-muted-foreground text-sm">None flagged.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {d.highRiskRiders.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link href={`/owner/riders/${r.id}`} className="truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                      <Badge variant="destructive" className="capitalize">{r.risk}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>Applications</CardTitle>
              <CardDescription>Awaiting your review</CardDescription>
              <CardAction>
                <Link
                  href="/owner/applications"
                  className="text-primary flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Review <ArrowRightIcon className="size-3.5" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{d.applicationsAwaiting}</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  footnote,
  tone,
}: {
  label: string;
  value: string;
  footnote: string;
  tone?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-muted-foreground text-xs font-normal">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className={`break-words text-lg font-semibold tabular-nums sm:text-2xl ${tone ?? ''}`}>{value}</p>
        <p className="text-muted-foreground text-xs">{footnote}</p>
      </CardContent>
    </Card>
  );
}

function AgingBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">{formatTZS(value)}</span>
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-[color:var(--color-overdue)]/80"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
