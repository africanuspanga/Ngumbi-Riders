import { formatTZS } from '@/lib/money/format';
import { formatDate, formatLongDate } from '@/lib/dates/format';
import type { Statement } from '@/lib/payments/statement';
import type { ContractProgress } from '@/lib/contracts/completion';

/*
 * Bank-statement view of a rider's account (client feedback 2026-09-05):
 * charges on the left, receipts on the right, a running balance down the side.
 *
 * The header carries the two figures in the colours the owner asked for:
 *   GREEN — outstanding/accumulated right now
 *   RED   — the total remaining to finish the contract
 * and the projected completion date in full ("Monday, 25 June 2030").
 */
export function StatementSummary({ progress }: { progress: ContractProgress }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-[--radius-card] border border-[color:var(--color-paid)]/40 bg-[color:var(--color-paid)]/5 p-4">
        <p className="text-muted-foreground text-xs">Outstanding now (accumulated)</p>
        <p className="text-xl font-bold tabular-nums text-[color:var(--color-paid)]">
          {formatTZS(progress.outstandingNow)}
        </p>
        <p className="text-muted-foreground text-xs">
          {progress.outstandingCount} payment{progress.outstandingCount === 1 ? '' : 's'} due or overdue
        </p>
      </div>
      <div className="rounded-[--radius-card] border border-[color:var(--color-overdue)]/40 bg-[color:var(--color-overdue)]/5 p-4">
        <p className="text-muted-foreground text-xs">Remaining to finish the contract</p>
        <p className="text-xl font-bold tabular-nums text-[color:var(--color-overdue)]">
          {formatTZS(progress.totalRemaining)}
        </p>
        <p className="text-muted-foreground text-xs">
          {progress.remainingCount} of {progress.totalCount} payments left
        </p>
      </div>
      <div className="rounded-[--radius-card] border border-border bg-white p-4">
        <p className="text-muted-foreground text-xs">Expected completion</p>
        <p className="text-base font-semibold">
          {progress.projectedEndDate ? formatLongDate(progress.projectedEndDate) : 'Not enough payments yet'}
        </p>
        <p className="text-muted-foreground text-xs">
          {progress.projectionBasis === 'complete'
            ? 'Contract fully paid.'
            : progress.projectionBasis === 'pace'
              ? progress.daysBehindSchedule > 0
                ? `At the current payment rate — ${progress.daysBehindSchedule} day${progress.daysBehindSchedule === 1 ? '' : 's'} later than scheduled (${formatDate(progress.scheduledEndDate)}).`
                : `At the current payment rate — on schedule (${formatDate(progress.scheduledEndDate)}).`
              : `Scheduled end ${formatDate(progress.scheduledEndDate)}.`}
        </p>
      </div>
    </div>
  );
}

export function StatementTable({ statement }: { statement: Statement }) {
  if (statement.lines.length === 0) {
    return (
      <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
        Nothing on the statement for this period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Charged</th>
            <th className="px-3 py-2 text-right font-medium">Received</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border bg-surface/60">
            <td className="px-3 py-2 font-medium" colSpan={4}>
              Opening balance
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
              {formatTZS(statement.openingBalance)}
            </td>
          </tr>
          {statement.lines.map((l, i) => (
            <tr key={`${l.date}-${l.type}-${l.paymentId ?? i}`} className="border-b border-border last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(l.date)}</td>
              <td className="px-3 py-2">
                {l.description}
                {l.receiptNumber ? (
                  <span className="text-muted-foreground block font-mono text-xs">{l.receiptNumber}</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">
                {l.debit ? formatTZS(l.debit) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[color:var(--color-paid)]">
                {l.credit ? formatTZS(l.credit) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                {formatTZS(l.balance)}
              </td>
            </tr>
          ))}
          <tr className="bg-surface/60">
            <td className="px-3 py-2 font-semibold" colSpan={2}>
              Totals
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
              {formatTZS(statement.totalCharged)}
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[color:var(--color-paid)]">
              {formatTZS(statement.totalReceived)}
            </td>
            <td className="px-3 py-2 text-right font-mono font-bold tabular-nums">
              {formatTZS(statement.closingBalance)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
