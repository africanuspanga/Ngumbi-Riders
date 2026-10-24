import { formatTZS } from '@/lib/money/format';
import { formatDate, formatLongDate, formatLongDateSw } from '@/lib/dates/format';
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
 *
 * `lang="sw"` is the rider's own statement (the rider app is Swahili-first);
 * staff pages use the English default. Below `sm` the ledger is a list, not a
 * five-column table a phone can only show half of (design pass 2).
 */

type Lang = 'en' | 'sw';

const L = {
  en: {
    outstanding: 'Outstanding now (accumulated)',
    dueCount: (n: number) => `${n} payment${n === 1 ? '' : 's'} due or overdue`,
    remaining: 'Remaining to finish the contract',
    leftCount: (r: number, t: number) => `${r} of ${t} payments left`,
    completion: 'Expected completion',
    notEnough: 'Not enough payments yet',
    fullyPaid: 'Contract fully paid.',
    late: (n: number, d: string) => `At the current payment rate — ${n} day${n === 1 ? '' : 's'} later than scheduled (${d}).`,
    onSchedule: (d: string) => `At the current payment rate — on schedule (${d}).`,
    scheduled: (d: string) => `Scheduled end ${d}.`,
    empty: 'Nothing on the statement for this period.',
    date: 'Date', description: 'Description', charged: 'Charged', received: 'Received', balance: 'Balance',
    opening: 'Opening balance', totals: 'Totals', balanceShort: 'Balance', ahead: 'Paid ahead',
  },
  sw: {
    outstanding: 'Deni la sasa',
    dueCount: (n: number) => `Malipo ${n} yamefika au yamepita muda`,
    remaining: 'Kiasi kilichobaki kumaliza mkataba',
    leftCount: (r: number, t: number) => `Malipo ${r} kati ya ${t} yamebaki`,
    completion: 'Utamaliza lini',
    notEnough: 'Bado hakuna malipo ya kutosha kukadiria',
    fullyPaid: 'Mkataba umelipwa wote.',
    late: (n: number, d: string) => `Kwa mwendo wa sasa — siku ${n} baada ya ratiba (${d}).`,
    onSchedule: (d: string) => `Kwa mwendo wa sasa — kwa wakati (${d}).`,
    scheduled: (d: string) => `Mwisho uliopangwa ${d}.`,
    empty: 'Hakuna kitu kwenye taarifa kwa kipindi hiki.',
    date: 'Tarehe', description: 'Maelezo', charged: 'Kinachodaiwa', received: 'Kilicholipwa', balance: 'Salio',
    opening: 'Salio la mwanzo', totals: 'Jumla', balanceShort: 'Salio', ahead: 'Umelipa mbele',
  },
} as const;

/** The ledger's descriptions are built in English by lib/payments/statement. */
function describe(text: string, lang: Lang): string {
  if (lang === 'en') return text;
  if (text === 'Lease payment due') return 'Malipo ya mkataba';
  if (text === 'Phone loan instalment due') return 'Rejesho la mkopo wa simu';
  const m = /^Payment received \((.+?)(?: — received by (.+))?\)$/.exec(text);
  if (m) {
    const method = m[1] === 'Cash' ? 'Taslimu' : m[1];
    return m[2] ? `Malipo yamepokelewa (${method} — na ${m[2]})` : `Malipo yamepokelewa (${method})`;
  }
  return text;
}
export function StatementSummary({ progress, lang = 'en' }: { progress: ContractProgress; lang?: Lang }) {
  const t = L[lang];
  const longDate = lang === 'sw' ? formatLongDateSw : formatLongDate;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-(--radius-card) border border-[color:var(--color-paid)]/40 bg-[color:var(--color-paid)]/5 p-4">
        <p className="text-muted-foreground text-xs">{t.outstanding}</p>
        <p className="text-xl font-bold tabular-nums text-[color:var(--color-paid)]">
          {formatTZS(progress.outstandingNow)}
        </p>
        <p className="text-muted-foreground text-xs">
          {t.dueCount(progress.outstandingCount)}
        </p>
      </div>
      <div className="rounded-(--radius-card) border border-[color:var(--color-overdue)]/40 bg-[color:var(--color-overdue)]/5 p-4">
        <p className="text-muted-foreground text-xs">{t.remaining}</p>
        <p className="text-xl font-bold tabular-nums text-[color:var(--color-overdue)]">
          {formatTZS(progress.totalRemaining)}
        </p>
        <p className="text-muted-foreground text-xs">
          {t.leftCount(progress.remainingCount, progress.totalCount)}
        </p>
      </div>
      <div className="rounded-(--radius-card) border border-border bg-white p-4">
        <p className="text-muted-foreground text-xs">{t.completion}</p>
        <p className="text-base font-semibold">
          {progress.projectedEndDate ? longDate(progress.projectedEndDate) : t.notEnough}
        </p>
        <p className="text-muted-foreground text-xs">
          {progress.projectionBasis === 'complete'
            ? t.fullyPaid
            : progress.projectionBasis === 'pace'
              ? progress.daysBehindSchedule > 0
                ? t.late(progress.daysBehindSchedule, formatDate(progress.scheduledEndDate))
                : t.onSchedule(formatDate(progress.scheduledEndDate))
              : t.scheduled(formatDate(progress.scheduledEndDate))}
        </p>
      </div>
    </div>
  );
}

export function StatementTable({ statement, lang = 'en' }: { statement: Statement; lang?: Lang }) {
  const t = L[lang];
  if (statement.lines.length === 0) {
    return (
      <p className="rounded-(--radius-card) border border-border bg-white p-6 text-center text-muted-foreground">
        {t.empty}
      </p>
    );
  }

  return (
    <>
    {/* Phones: one row per line, amount and running balance on the right. */}
    <ul className="flex flex-col divide-y divide-border rounded-(--radius-card) border border-border bg-white sm:hidden">
      <li className="flex justify-between bg-surface/60 px-4 py-2.5 text-sm">
        <span className="font-medium">{t.opening}</span>
        <span className="font-semibold tabular-nums">{formatTZS(statement.openingBalance)}</span>
      </li>
      {statement.lines.map((l, i) => (
        <li key={`m-${l.date}-${l.type}-${l.paymentId ?? i}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
          <div className="min-w-0">
            <p className={l.credit ? 'font-medium text-[color:var(--color-paid)]' : ''}>{describe(l.description, lang)}</p>
            <p className="text-muted-foreground text-xs">
              {formatDate(l.date)}
              {l.receiptNumber ? <span className="font-mono"> · {l.receiptNumber}</span> : null}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`tabular-nums ${l.credit ? 'font-semibold text-[color:var(--color-paid)]' : ''}`}>
              {l.credit ? `+${formatTZS(l.credit)}` : l.debit ? formatTZS(l.debit) : '—'}
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {/* A negative balance is money paid ahead, not a debt. */}
              {l.balance < 0 ? `${t.ahead} ${formatTZS(-l.balance)}` : `${t.balanceShort} ${formatTZS(l.balance)}`}
            </p>
          </div>
        </li>
      ))}
      <li className="flex justify-between bg-surface/60 px-4 py-2.5 text-sm">
        <span className="font-semibold">{t.totals}</span>
        <span className="font-bold tabular-nums">{formatTZS(statement.closingBalance)}</span>
      </li>
    </ul>
    <div className="hidden overflow-x-auto rounded-(--radius-card) border border-border bg-white sm:block">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="px-3 py-2 font-medium">{t.date}</th>
            <th className="px-3 py-2 font-medium">{t.description}</th>
            <th className="px-3 py-2 text-right font-medium">{t.charged}</th>
            <th className="px-3 py-2 text-right font-medium">{t.received}</th>
            <th className="px-3 py-2 text-right font-medium">{t.balance}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border bg-surface/60">
            <td className="px-3 py-2 font-medium" colSpan={4}>
              {t.opening}
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">
              {formatTZS(statement.openingBalance)}
            </td>
          </tr>
          {statement.lines.map((l, i) => (
            <tr key={`${l.date}-${l.type}-${l.paymentId ?? i}`} className="border-b border-border last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(l.date)}</td>
              <td className="px-3 py-2">
                {describe(l.description, lang)}
                {l.receiptNumber ? (
                  <span className="text-muted-foreground block font-mono text-xs">{l.receiptNumber}</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.debit ? formatTZS(l.debit) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[color:var(--color-paid)]">
                {l.credit ? formatTZS(l.credit) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatTZS(l.balance)}
              </td>
            </tr>
          ))}
          <tr className="bg-surface/60">
            <td className="px-3 py-2 font-semibold" colSpan={2}>
              {t.totals}
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">
              {formatTZS(statement.totalCharged)}
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums text-[color:var(--color-paid)]">
              {formatTZS(statement.totalReceived)}
            </td>
            <td className="px-3 py-2 text-right font-bold tabular-nums">
              {formatTZS(statement.closingBalance)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    </>
  );
}
