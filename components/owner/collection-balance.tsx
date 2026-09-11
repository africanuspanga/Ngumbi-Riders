import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDateRange, formatDate } from '@/lib/dates/format';
import { balanceExplanation } from '@/lib/dashboard/collections';
import type { CollectionsOverview } from '@/lib/dashboard/queries';
import { ArrowRightIcon, SmartphoneIcon, BanknoteIcon, WalletIcon } from 'lucide-react';

/*
 * "Current Snippe collection balance" panel (client feedback 2026-09-11 #1).
 *
 * A SERVER component: it has no interactivity, and keeping it off the client
 * means the Snippe figures never travel through a client bundle. Both
 * back-office roles render the same component with different hrefs — passing
 * a base path STRING, never a function, because a function is not serialisable
 * across the boundary (the outage class fixed on 2026-09-06, now guarded by
 * tests/unit/rsc-boundary.test.ts).
 */
export function CollectionBalancePanel({
  overview,
  basePath,
}: {
  overview: CollectionsOverview;
  /** '/owner' or '/accountant' — the area whose links this panel should use. */
  basePath: string;
}) {
  const { balance, summary, reconciliation } = overview;
  const note = balanceExplanation(balance);
  const needsAttention = reconciliation.pending.count + reconciliation.failed.count > 0;

  return (
    <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-primary-dark">
            <WalletIcon className="size-4 shrink-0 text-primary" />
            Collection balance
          </h2>
          <p className="text-xs text-muted-foreground">
            Where the money is, and where it came from. All amounts in TZS.
          </p>
        </div>
        <Link
          href={`${basePath}/payments/transactions`}
          className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary-dark hover:underline"
        >
          All transactions <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>

      {/* --- The provider balance, clearly labelled as the provider's ----- */}
      <div className="rounded-[--radius-card] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="eyebrow text-muted-foreground">
              Snippe balance — held by the provider
            </span>
            <p className="font-display mt-1.5 text-[1.75rem] font-bold leading-none text-primary-dark">
              {balance.state === 'ok' ? formatTZS(balance.available) : '—'}
            </p>
          </div>
          {balance.state === 'ok' && balance.balance !== balance.available && (
            <p className="text-xs text-muted-foreground">
              {formatTZS(balance.balance)} including unsettled
            </p>
          )}
        </div>
        {note ? (
          <p className="mt-2 text-xs text-muted-foreground">{note}</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            This is the provider&rsquo;s float — collections in, withdrawals and fees out. It is
            not expected to equal the mobile-money total below, which is a
            cumulative inflow and never goes down.
          </p>
        )}
      </div>

      {/* --- What this system collected, by source ------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PeriodCard title="Today" range={formatDate(summary.periods.today)} totals={summary.today} />
        <PeriodCard
          title="Last 7 days"
          range={formatDateRange(summary.periods.weekFrom, summary.periods.weekTo)}
          totals={summary.week}
        />
        <PeriodCard
          title="This month"
          range={formatDateRange(summary.periods.monthFrom, summary.periods.monthTo)}
          totals={summary.month}
        />
        <PeriodCard
          title="Total collected"
          range="Since go-live"
          totals={summary.allTime}
          emphasise
        />
      </div>

      {/* --- Money that did not arrive ------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[--radius-card] border border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">Pending reconciliation: </span>
            <span className="font-display font-bold text-[color:var(--color-warning)]">
              {reconciliation.pending.count}
            </span>
            {reconciliation.pending.count > 0 && (
              <span className="text-muted-foreground"> · {formatTZS(reconciliation.pending.amount)}</span>
            )}
          </span>
          <span>
            <span className="text-muted-foreground">Failed: </span>
            <span className="font-display font-bold text-[color:var(--color-overdue)]">
              {reconciliation.failed.count}
            </span>
            {reconciliation.failed.count > 0 && (
              <span className="text-muted-foreground"> · {formatTZS(reconciliation.failed.amount)}</span>
            )}
          </span>
          {reconciliation.stale.length > 0 && (
            <span className="text-[color:var(--color-overdue)]">
              {reconciliation.stale.length} stuck over an hour
            </span>
          )}
        </div>
        {basePath === '/owner' && needsAttention && (
          <Link
            href="/owner/reconciliation"
            className="shrink-0 rounded-[--radius-card] border border-border px-3 py-1.5 text-sm font-semibold text-primary-dark hover:bg-surface"
          >
            Reconcile
          </Link>
        )}
      </div>
    </section>
  );
}

/**
 * Cash vs Snippe as one bar. Renders an empty track when nothing was collected
 * — a period with no money is a fact worth seeing, not a missing element.
 */
function SourceSplit({ mobile, cash }: { mobile: number; cash: number }) {
  const total = mobile + cash;
  const mobilePct = total > 0 ? (mobile / total) * 100 : 0;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-[color:var(--color-advance)]"
        style={{ width: `${mobilePct}%` }}
      />
      <div
        className="h-full bg-[color:var(--color-paid)]"
        style={{ width: `${total > 0 ? 100 - mobilePct : 0}%` }}
      />
    </div>
  );
}

function PeriodCard({
  title,
  range,
  totals,
  emphasise = false,
}: {
  title: string;
  range: string;
  totals: { mobile: number; cash: number; total: number; payments: number };
  emphasise?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2.5 rounded-[--radius-card] border p-3.5 ${
        emphasise ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'
      }`}
    >
      <div className="flex flex-col gap-1">
        <span className="eyebrow text-muted-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{range}</span>
      </div>

      <p className="font-display break-words text-xl font-bold leading-none text-primary-dark">
        {formatTZS(totals.total)}
      </p>

      {/*
        A two-segment bar, cash against Snippe. The client's question was
        "where did this money come from" — a proportion answers that at a
        glance in a way two stacked figures never will, and the figures stay
        underneath for the exact amounts.
      */}
      <SourceSplit mobile={totals.mobile} cash={totals.cash} />

      <dl className="flex flex-col gap-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-[color:var(--color-advance)]" />
            <SmartphoneIcon className="size-3 shrink-0" /> Snippe
          </dt>
          <dd className="font-display">{formatTZS(totals.mobile)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-[color:var(--color-paid)]" />
            <BanknoteIcon className="size-3 shrink-0" /> Cash
          </dt>
          <dd className="font-display">{formatTZS(totals.cash)}</dd>
        </div>
      </dl>

      <p className="text-[11px] text-muted-foreground">
        {totals.payments} payment{totals.payments === 1 ? '' : 's'}
      </p>
    </div>
  );
}
