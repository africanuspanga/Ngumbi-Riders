import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import {
  getOwnerDashboard,
  getCollectionsSeries,
  getRiderBalances,
  getCollectionsOverview,
} from '@/lib/dashboard/queries';
import { listCashRequests } from '@/lib/payments/queries';
import { listRequisitionsForDashboard } from '@/lib/requisitions/queries';
import { listUnreadNotifications, unreadCount } from '@/lib/notifications/queries';
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
import { BalanceChart } from '@/components/owner/balance-chart';
import { TodayBand } from '@/components/owner/today-band';
import { localDateString } from '@/lib/dates/tz';
import { CollectionBalancePanel } from '@/components/owner/collection-balance';
import { PhoneLoanPanel } from '@/components/loans/PhoneLoanPanel';
import { getPhoneLoanPortfolio } from '@/lib/loans/queries';
import { formatClockDate, formatClockTime } from '@/lib/dates/clock';
import {
  TriangleAlertIcon,
  ArrowRightIcon,
  BanknoteIcon,
  ClipboardCheckIcon,
  BellIcon,
} from 'lucide-react';
import { formatDate } from '@/lib/dates/format';

export const metadata = { title: 'Dashboard' };

export default async function OwnerHome() {
  const profile = await requireOwner();
  const [
    d,
    series,
    balances,
    collections,
    phoneLoans,
    pendingCash,
    pendingRequisitions,
    unreadNotifications,
    unread,
  ] = await Promise.all([
    getOwnerDashboard(),
    getCollectionsSeries(30),
    getRiderBalances(12),
    getCollectionsOverview(),
    getPhoneLoanPortfolio(),
    listCashRequests(['pending']),
    listRequisitionsForDashboard({ statuses: ['submitted'] }),
    listUnreadNotifications(3),
    unreadCount(),
  ]);
  const rate = d.kpis.collectionRate === null ? '—' : `${Math.round(d.kpis.collectionRate * 100)}%`;
  // Rendered on the server for the first paint; LiveClock takes over on mount.
  const now = new Date();
  const today = localDateString(now);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
          Karibu{profile.fullName ? ` Mr ${profile.fullName}` : ''}
        </h1>
        <p className="text-muted-foreground text-sm">
          <span className="font-display text-foreground">{d.activeRiders}</span> active riders ·{' '}
          <span className="font-display text-foreground">{d.activeMotorcycles}</span> motorcycles out
        </p>
      </header>

      {/* The thesis: today's collections against today's expectation, with the
          30-day ribbon beside it. The one place on this page that is loud. */}
      <TodayBand
        collectedToday={d.kpis.collectedToday}
        expectedToday={d.kpis.expectedToday}
        outstandingToday={d.kpis.outstandingToday}
        unpaidRiders={d.kpis.unpaidRiders}
        paidRiders={d.kpis.paidRiders}
        deadline={d.paymentDeadline}
        series={series}
        today={today}
        nowDate={formatClockDate(now)}
        nowTime={formatClockTime(now)}
      />

      {/* Notifications were a four-row block at the top of the page — the
          largest element on screen, and the least actionable. Demoted to one
          line; the full list is a click away and the header bell already
          carries the count. */}
      {unread > 0 && (
        <Link
          href="/owner/notifications"
          className="group flex items-center justify-between gap-3 rounded-[--radius-card] border border-border bg-white px-4 py-2.5 text-sm hover:bg-surface"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BellIcon className="size-4 shrink-0 text-primary" />
            <span className="font-display shrink-0">{unread}</span>
            <span className="shrink-0 text-muted-foreground">unread ·</span>
            <span className="truncate font-medium">
              {unreadNotifications[0]?.title ?? 'See your notifications'}
            </span>
          </span>
          <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

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

      {/*
        The POSITION, as distinct from the day.
        Expected/collected/outstanding/rate all moved into the band above, so
        these three say what the band cannot: the accumulated debt, the whole
        book still to be collected, and how reliably today is going.
      */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Arrears"
          value={formatTZS(d.kpis.totalArrears)}
          footnote={`${d.kpis.arrearsCount} unpaid day${d.kpis.arrearsCount === 1 ? '' : 's'} across ${d.unpaidRiders.length} rider${d.unpaidRiders.length === 1 ? '' : 's'}`}
          tone={d.kpis.totalArrears > 0 ? 'text-[color:var(--color-overdue)]' : undefined}
        />
        <StatCard
          label="Owed now"
          value={formatTZS(balances.totalOutstandingNow)}
          footnote="due up to today, across every contract"
        />
        <StatCard
          label="Still to collect"
          value={formatTZS(balances.totalRemaining)}
          footnote={`to finish all ${balances.riderCount} contract${balances.riderCount === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Collection rate"
          value={rate}
          footnote={`${d.kpis.paidRiders} paid · ${d.kpis.unpaidRiders} unpaid today`}
          tone={
            d.kpis.collectionRate !== null && d.kpis.collectionRate >= 1
              ? 'text-[color:var(--color-paid)]'
              : undefined
          }
        />
      </section>

      {/* Current collection balance, by source (client feedback #1). */}
      <CollectionBalancePanel overview={collections} basePath="/owner" />

      {/* Phone-loan status (client feedback #3). */}
      <PhoneLoanPanel portfolio={phoneLoans} basePath="/owner" />

      {/*
        The 14-day area chart used to sit beside this. The 30-day ribbon in the
        band covers twice the period and answers the same question, and two
        "collections over time" charts on one screen is one too many — so the
        balance chart takes the full width it always needed for rider names.
      */}
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <BalanceChart
            points={balances.points}
            totalOutstandingNow={balances.totalOutstandingNow}
            totalRemaining={balances.totalRemaining}
            riderCount={balances.riderCount}
          />
        </div>

        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle>Arrears aging</CardTitle>
            <CardDescription>
              How old the {formatTZS(d.kpis.totalArrears)} of unpaid days is
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <AgingBar label="1 day" value={d.aging.oneDay} total={d.kpis.totalArrears} depth={1} />
            <AgingBar label="2–3 days" value={d.aging.twoToThree} total={d.kpis.totalArrears} depth={2} />
            <AgingBar label="4–7 days" value={d.aging.fourToSeven} total={d.kpis.totalArrears} depth={3} />
            <AgingBar label="8–30 days" value={d.aging.eightToThirty} total={d.kpis.totalArrears} depth={4} />
            <AgingBar label="31+ days" value={d.aging.overThirty} total={d.kpis.totalArrears} depth={5} />
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
                      <TableCell className="font-display text-right font-bold text-[color:var(--color-overdue)]">
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

/*
 * One figure, with the label small and tracked above it and the caption quiet
 * below. The amount is set in the display face so a number is recognisable as
 * a number before it is read — previously label, value and footnote were all
 * Geist at three close sizes, which is why the old KPI row read as a wall.
 */
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
    <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
      <span className="eyebrow text-muted-foreground">{label}</span>
      <p
        className={`font-display break-words text-xl font-bold leading-none sm:text-[1.75rem] ${
          tone ?? 'text-primary-dark'
        }`}
      >
        {value}
      </p>
      <p className="text-muted-foreground text-xs leading-snug">{footnote}</p>
    </div>
  );
}

/*
 * One aging bucket. `depth` darkens the bar as the debt gets older, so the
 * shape of the problem is readable without comparing five numbers: a stack
 * that reddens towards the bottom is a business with old, hardening arrears.
 */
function AgingBar({
  label,
  value,
  total,
  depth = 1,
}: {
  label: string;
  value: number;
  total: number;
  depth?: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-display font-medium">
          {formatTZS(value)}
          {pct > 0 && <span className="ml-1.5 text-muted-foreground">{pct}%</span>}
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-[color:var(--color-overdue)]"
          style={{ width: `${pct}%`, opacity: 0.35 + depth * 0.13 }}
        />
      </div>
    </div>
  );
}
