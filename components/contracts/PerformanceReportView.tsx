import { formatTZS } from '@/lib/money/format';
import { formatDate, formatLongDate } from '@/lib/dates/format';
import {
  GRADE_LABELS,
  PAYMENT_METHOD_LABELS,
  SCHEDULE_LABELS,
  type PerformanceGrade,
} from '@/lib/contracts/performance';
import type { ContractPerformanceReport } from '@/lib/contracts/performance-queries';

/*
 * The rider performance report on screen (client request 2026-10-23). The
 * printable copy is the PDF from /api/contracts/[id]/performance-report, built
 * from the same ContractPerformanceReport, so the two cannot disagree.
 */

const GRADE_TONE: Record<PerformanceGrade, string> = {
  excellent: 'bg-paid/15 text-paid',
  good: 'bg-paid/10 text-paid',
  fair: 'bg-warning/15 text-warning',
  poor: 'bg-overdue/10 text-overdue',
  no_history: 'bg-muted text-muted-foreground',
};

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
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
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`font-display mt-1 text-xl font-bold tabular-nums ${
          tone === 'good' ? 'text-paid' : tone === 'bad' ? 'text-overdue' : 'text-primary-dark'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PerformanceReportView({ report }: { report: ContractPerformanceReport }) {
  const p = report.performance;
  const ended = report.terminatedOn !== null;

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 rounded-[--radius-card] border border-border bg-white p-4 sm:grid-cols-2">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Rider</dt>
          <dd className="font-semibold">{report.rider.name}</dd>
          <dt className="text-muted-foreground">Rider no.</dt>
          <dd className="font-mono">{report.rider.riderNumber}</dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd>{report.rider.phone ?? '—'}</dd>
          <dt className="text-muted-foreground">Motorcycle</dt>
          <dd>
            {report.motorcycle
              ? `${report.motorcycle.code}${report.motorcycle.registration ? ` · ${report.motorcycle.registration}` : ''}`
              : '—'}
          </dd>
        </dl>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Started</dt>
          <dd className="font-semibold">{formatLongDate(report.startDate)}</dd>
          <dt className="text-muted-foreground">
            {ended ? 'Terminated' : 'Report date'}
          </dt>
          <dd className={ended ? 'font-semibold text-overdue' : 'font-semibold'}>
            {formatLongDate(p.cutoffDate)}
            {report.terminatedByName ? ` · by ${report.terminatedByName}` : ''}
          </dd>
          <dt className="text-muted-foreground">Scheduled end</dt>
          <dd>{formatDate(report.scheduledEndDate)}</dd>
          <dt className="text-muted-foreground">Terms</dt>
          <dd>
            {SCHEDULE_LABELS[report.scheduleType] ?? report.scheduleType} ·{' '}
            {formatTZS(report.installmentAmount)}
          </dd>
          <dt className="text-muted-foreground">Days on contract</dt>
          <dd>{p.daysOnContract.toLocaleString('en-GB')}</dd>
        </dl>
      </section>

      {report.status === 'terminated' && !ended && (
        <p className="rounded-[--radius-card] border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          This contract is terminated but its termination date was not recorded (it predates the
          audit trail), so figures run to today.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Total paid"
          value={formatTZS(p.totalPaid)}
          hint={`${p.paymentCount} payment${p.paymentCount === 1 ? '' : 's'}`}
          tone="good"
        />
        <Stat
          label={ended ? 'Owed at termination' : 'Outstanding now'}
          value={formatTZS(p.outstandingValue)}
          hint={`${p.outstandingCount} unpaid payment day${p.outstandingCount === 1 ? '' : 's'}`}
          tone={p.outstandingValue > 0 ? 'bad' : 'good'}
        />
        <Stat
          label="Expected to date"
          value={formatTZS(p.expectedValue)}
          hint={`${p.expectedCount} payment days due`}
        />
        <Stat
          label="Collection rate"
          value={`${p.collectionRate.toFixed(1)}%`}
          hint={GRADE_LABELS[p.grade]}
          tone={p.collectionRate >= 80 ? 'good' : p.collectionRate < 60 ? 'bad' : undefined}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[--radius-card] border border-border bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-primary-dark">Payment behaviour</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${GRADE_TONE[p.grade]}`}
            >
              {GRADE_LABELS[p.grade]}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Paid on time</dt>
            <dd className="tabular-nums">
              {p.onTimeCount} ({p.onTimeRate.toFixed(1)}%)
            </dd>
            <dt className="text-muted-foreground">Paid late</dt>
            <dd className="tabular-nums">
              {p.lateCount}
              {p.lateCount > 0 ? ` · avg ${p.averageDaysLate} days late` : ''}
            </dd>
            <dt className="text-muted-foreground">Never paid</dt>
            <dd className="tabular-nums">{p.outstandingCount}</dd>
            <dt className="text-muted-foreground">Waived by the owner</dt>
            <dd className="tabular-nums">
              {p.waivedCount} · {formatTZS(p.waivedValue)}
            </dd>
            <dt className="text-muted-foreground">Value of days cleared</dt>
            <dd className="tabular-nums">{formatTZS(p.settledValue)}</dd>
            {p.paidAheadValue > 0 && (
              <>
                <dt className="text-muted-foreground">Paid ahead (after the cutoff)</dt>
                <dd className="tabular-nums">{formatTZS(p.paidAheadValue)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Contract value (whole term)</dt>
            <dd className="tabular-nums">{formatTZS(report.contractValue)}</dd>
          </dl>
        </div>

        <div className="rounded-[--radius-card] border border-border bg-white p-4">
          <h2 className="font-semibold text-primary-dark">Payments received</h2>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">First payment</dt>
            <dd>{formatDate(p.firstPaymentDate)}</dd>
            <dt className="text-muted-foreground">Last payment</dt>
            <dd>{formatDate(p.lastPaymentDate)}</dd>
            <dt className="text-muted-foreground">Days since last payment</dt>
            <dd className="tabular-nums">{p.daysSinceLastPayment ?? '—'}</dd>
            {p.paidByMethod.map((m) => (
              <div key={m.method} className="contents">
                <dt className="text-muted-foreground">
                  {PAYMENT_METHOD_LABELS[m.method] ?? m.method} ({m.count})
                </dt>
                <dd className="tabular-nums">{formatTZS(m.amount)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {p.months.length > 0 && (
        <section className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {p.months.map((m) => (
                <tr key={m.month} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{monthLabel(m.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTZS(m.expected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-paid">
                    {formatTZS(m.settled)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${m.outstanding > 0 ? 'font-semibold text-overdue' : ''}`}
                  >
                    {formatTZS(m.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
