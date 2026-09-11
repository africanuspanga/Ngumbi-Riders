import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import type { PhoneLoanPortfolio } from '@/lib/loans/portfolio';
import { ArrowRightIcon, SmartphoneIcon, PauseIcon } from 'lucide-react';

/*
 * Phone-loan status on the dashboard (client feedback 2026-09-11 #3).
 *
 * All seven figures the Director asked for, in one panel. A SERVER component
 * taking `basePath` as a plain string, shared by the owner and accountant
 * dashboards.
 *
 * Two of the figures deserve their labels read carefully, and the panel says so
 * rather than leaving the reader to assume:
 *
 *   ISSUED is principal + interest — what riders owe, not what the handsets
 *   cost. Reporting the principal would understate the book by a third.
 *
 *   ISSUED − REPAID is NOT the outstanding balance. A cancelled or waived
 *   instalment reduces what is owed without anybody paying it, so both figures
 *   are shown and neither is inferred from the other.
 */
export function PhoneLoanPanel({
  portfolio,
  basePath,
}: {
  portfolio: PhoneLoanPortfolio;
  basePath: string;
}) {
  const nothingEverHappened =
    portfolio.activeCount === 0 &&
    portfolio.completedCount === 0 &&
    portfolio.pendingCount === 0;

  return (
    <section className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-primary-dark">
            <SmartphoneIcon className="size-4 shrink-0 text-primary" />
            Phone loans
          </h2>
          <p className="text-xs text-muted-foreground">
            Principal + 50% interest, repaid before the lease continues.
          </p>
        </div>
        <Link
          href={`${basePath}/phone-loans`}
          className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary-dark hover:underline"
        >
          Manage <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>

      {nothingEverHappened ? (
        <p className="text-sm text-muted-foreground">
          No phone loans yet. A rider with an active contract can request one from their app; it
          goes to finance, then to you.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Active loans" value={String(portfolio.activeCount)} />
            <Stat label="Total issued" value={formatTZS(portfolio.totalIssued)} hint="principal + interest" />
            <Stat
              label="Repaid"
              value={formatTZS(portfolio.totalRepaid)}
              tone="text-[color:var(--color-paid)]"
            />
            <Stat
              label="Outstanding"
              value={formatTZS(portfolio.totalOutstanding)}
              tone={
                portfolio.totalOutstanding > 0 ? 'text-[color:var(--color-warning)]' : undefined
              }
            />
          </div>

          {portfolio.pausedRiders.length > 0 && (
            <div className="flex items-start gap-2 rounded-[--radius-card] border border-[color:var(--color-warning)]/40 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <PauseIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong className="font-semibold">
                  {portfolio.pausedRiders.length} rider
                  {portfolio.pausedRiders.length === 1 ? '' : 's'}
                </strong>{' '}
                {portfolio.pausedRiders.length === 1 ? 'has' : 'have'} motorcycle repayment paused
                while a phone loan is repaid:{' '}
                {portfolio.pausedRiders.map((p) => p.loan.riderName).join(', ')}. Those lease days
                are postponed, not cancelled — the contract total is unchanged.
              </span>
            </div>
          )}

          {portfolio.inArrears.length > 0 && (
            <p className="text-sm font-medium text-[color:var(--color-overdue)]">
              {portfolio.inArrears.length} phone loan
              {portfolio.inArrears.length === 1 ? '' : 's'} behind on an instalment:{' '}
              {portfolio.inArrears.map((p) => p.loan.riderName).join(', ')}.
            </p>
          )}

          {portfolio.repaying.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-primary-dark">Currently repaying</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Rider</th>
                      <th className="py-1 pr-2 font-medium">Progress</th>
                      <th className="py-1 pr-2 font-medium">Next due</th>
                      <th className="py-1 text-right font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.repaying.map((p) => (
                      <tr key={p.loan.id} className="border-t border-border">
                        <td className="py-1 pr-2">
                          <Link
                            href={`${basePath}/riders/${p.loan.riderId}`}
                            className="font-medium text-primary-dark hover:underline"
                          >
                            {p.loan.riderName}
                          </Link>
                        </td>
                        <td className="py-1 pr-2">
                          <span className="font-display">
                            {p.instalmentsPaid}/{p.instalments}
                          </span>
                          <span className="text-muted-foreground"> paid</span>
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {p.nextDueDate ? formatDate(p.nextDueDate) : '—'}
                        </td>
                        <td className="py-1 text-right font-display font-medium">
                          {formatTZS(p.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {portfolio.completed.length > 0 && (
            <p className="text-sm text-muted-foreground">
              <strong className="font-semibold text-foreground">
                {portfolio.completedCount} completed:
              </strong>{' '}
              {portfolio.completed
                .slice(0, 6)
                .map((p) => p.loan.riderName)
                .join(', ')}
              {portfolio.completed.length > 6 ? ', …' : ''}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[--radius-card] border border-border p-3.5">
      <span className="eyebrow text-muted-foreground">{label}</span>
      <p className={`font-display break-words text-xl font-bold leading-none ${tone ?? 'text-primary-dark'}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
