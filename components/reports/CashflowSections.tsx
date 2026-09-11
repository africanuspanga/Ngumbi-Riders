import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateRange } from '@/lib/dates/format';
import { EXPENSE_SOURCE_LABELS } from '@/lib/reports/filter-labels';
import { filtersToQuery } from '@/lib/reports/cashflow';
import {
  ITEM_CATEGORY_LABELS,
  REQUISITION_STATUS_LABELS,
  REQUISITION_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  RETIREMENT_STATUS_LABELS,
  type RequisitionItemCategory,
  type RequisitionPaymentStatus,
  type RequisitionRetirementStatus,
  type RequisitionStatus,
  type RequisitionType,
} from '@/lib/requisitions/constants';
import type { CashflowReport } from '@/lib/reports/queries';

/*
 * The four report families the client asked to be added alongside the existing
 * motorcycle reports: INCOME, EXPENSES, REQUISITIONS and a CASHFLOW STATEMENT
 * for the period.
 *
 * A SERVER component shared by the owner and accountant report pages, taking
 * `basePath` as a plain STRING so nothing but a component crosses the
 * client/server boundary (spec rule 16).
 *
 * The section that matters most is the statement, and the thing it does that a
 * naive version would not: REQUISITIONS ARE NOT SUBTRACTED FROM THE NET. An
 * approved purchase request is an authorisation, not a cost, and when it does
 * become a cost the accountant retires it into a department expense — which
 * IS in the net. Counting both would double every purchase. The commitments
 * line reports approved-but-unpaid money separately, which is the figure the
 * Director actually wants from requisitions.
 */
export function CashflowSections({
  report,
  basePath,
}: {
  report: CashflowReport;
  basePath: string;
}) {
  const { statement, filters, expenses, requisitions } = report;
  const q = filtersToQuery(filters);
  const range = formatDateRange(filters.from, filters.to);

  return (
    <>
      {/* ---------------------------------------------------- statement --- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">
            Cashflow statement{' '}
            <span className="text-sm font-normal text-muted-foreground">{range}</span>
          </h2>
          <ExportLinks report="cashflow" q={q} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BigStat
            label="Income received"
            value={formatTZS(statement.income.total)}
            hint={`${statement.income.count} payment${statement.income.count === 1 ? '' : 's'}`}
            tone="text-[color:var(--color-paid)]"
          />
          <BigStat
            label="Expenses made"
            value={formatTZS(statement.expenses.total)}
            hint={`${statement.expenses.count} record${statement.expenses.count === 1 ? '' : 's'}`}
            tone="text-[color:var(--color-overdue)]"
          />
          {/* The answer the statement exists to produce, so it is not the third
              of four equal boxes. */}
          <BigStat
            label="Net balance"
            value={formatTZS(statement.net)}
            hint="income − expenses"
            tone={
              statement.net < 0
                ? 'text-[color:var(--color-overdue)]'
                : 'text-[color:var(--color-paid)]'
            }
            emphasise
          />
          <BigStat
            label="Requisitions raised"
            value={formatTZS(statement.requisitions.raised)}
            hint={`${statement.requisitions.raisedCount} request${statement.requisitions.raisedCount === 1 ? '' : 's'}`}
          />
        </div>

        <p className="rounded-[--radius-card] border border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">How to read this.</strong> Net balance
          is income minus <em>recorded expenses</em>. Requisitions are authorisations, not costs —
          they become a cost when the accountant retires them into a department expense, which is
          already counted above. Adding them again would double every purchase.{' '}
          {statement.requisitions.commitmentsOutstanding > 0 && (
            <>
              Approved but not yet paid:{' '}
              <strong className="font-semibold text-foreground">
                {formatTZS(statement.requisitions.commitmentsOutstanding)}
              </strong>{' '}
              still to come out.
            </>
          )}
        </p>

        {statement.byMonth.length > 1 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Month</th>
                  <th className="py-1 pr-2 text-right font-medium">Income</th>
                  <th className="py-1 pr-2 text-right font-medium">Expenses</th>
                  <th className="py-1 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {statement.byMonth.map((m) => (
                  <tr key={m.month} className="border-t border-border">
                    <td className="py-1 pr-2">{m.month}</td>
                    <td className="py-1 pr-2 text-right font-display">
                      {formatTZS(m.income)}
                    </td>
                    <td className="py-1 pr-2 text-right font-display">
                      {formatTZS(m.expenses)}
                    </td>
                    <td
                      className={`font-display py-1 text-right font-bold ${
                        m.net < 0 ? 'text-[color:var(--color-overdue)]' : ''
                      }`}
                    >
                      {formatTZS(m.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- income --- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">Income report</h2>
          <ExportLinks report="income" q={q} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
          <Stat label="Total received" value={formatTZS(statement.income.total)} />
          <Stat label="Snippe (mobile money)" value={formatTZS(statement.income.mobile)} />
          <Stat label="Cash" value={formatTZS(statement.income.cash)} />
          <Stat label="Payments" value={String(statement.income.count)} />
        </dl>
        {statement.income.count === 0 && (
          <p className="text-sm text-muted-foreground">
            No money was collected in this period with the filters applied.
          </p>
        )}
      </section>

      {/* ----------------------------------------------------- expenses --- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">
            Expense report{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {formatTZS(statement.expenses.total)}
            </span>
          </h2>
          <ExportLinks report="expense-ledger" q={q} />
        </div>

        {statement.expenses.count === 0 ? (
          <p className="text-sm text-muted-foreground">No expenses recorded in this period.</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <MiniTable
                caption="By department"
                rows={statement.expenses.byDepartment.map((d) => ({
                  key: d.departmentId ?? 'none',
                  label: d.name,
                  count: d.count,
                  amount: d.amount,
                }))}
                total={statement.expenses.total}
              />
              <MiniTable
                caption="By category"
                rows={statement.expenses.byCategory.map((c) => ({
                  key: c.category,
                  label:
                    ITEM_CATEGORY_LABELS[c.category as RequisitionItemCategory] ?? c.category,
                  count: c.count,
                  amount: c.amount,
                }))}
                total={statement.expenses.total}
              />
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-semibold text-primary-dark">
                Every expense ({expenses.length})
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Date</th>
                      <th className="py-1 pr-2 font-medium">Description</th>
                      <th className="py-1 pr-2 font-medium">Category</th>
                      <th className="py-1 pr-2 font-medium">Source</th>
                      <th className="py-1 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => (
                      <tr key={`${e.source}-${e.id}`} className="border-t border-border">
                        <td className="py-1 pr-2 whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="py-1 pr-2">{e.description}</td>
                        <td className="py-1 pr-2">
                          {ITEM_CATEGORY_LABELS[e.category as RequisitionItemCategory] ??
                            e.category}
                        </td>
                        <td className="py-1 pr-2 text-muted-foreground">
                          {EXPENSE_SOURCE_LABELS[e.source]}
                          {e.motorcycleLabel ? ` · ${e.motorcycleLabel}` : ''}
                        </td>
                        <td className="py-1 text-right font-display">
                          {formatTZS(e.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <Link
          href={`${basePath}/departments`}
          className="text-sm font-medium text-primary underline"
        >
          Manage departments and budgets
        </Link>
      </section>

      {/* ------------------------------------------------- requisitions --- */}
      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">Requisition report</h2>
          <ExportLinks report="requisitions" q={q} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-5">
          <Stat
            label="Raised"
            value={formatTZS(statement.requisitions.raised)}
            hint={`${statement.requisitions.raisedCount} request(s)`}
          />
          <Stat
            label="Approved"
            value={formatTZS(statement.requisitions.approved)}
            hint={`${statement.requisitions.approvedCount} approved`}
          />
          <Stat
            label="Paid"
            value={formatTZS(statement.requisitions.paid)}
            hint={`${statement.requisitions.paidCount} paid`}
          />
          <Stat
            label="Retired"
            value={formatTZS(statement.requisitions.retired)}
            hint={`${statement.requisitions.retiredCount} accounted for`}
          />
          <Stat
            label="Still to be paid"
            value={formatTZS(statement.requisitions.commitmentsOutstanding)}
            hint="approved − paid"
          />
        </dl>

        {requisitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No purchase requests touched this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Number</th>
                  <th className="py-1 pr-2 font-medium">Title</th>
                  <th className="py-1 pr-2 font-medium">Type</th>
                  <th className="py-1 pr-2 font-medium">Department</th>
                  <th className="py-1 pr-2 font-medium">Stage</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {requisitions.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 pr-2 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`${basePath}/requisitions/${r.id}`}
                        className="text-primary-dark underline"
                      >
                        {r.requisitionNumber}
                      </Link>
                    </td>
                    <td className="py-1 pr-2">{r.title}</td>
                    <td className="py-1 pr-2">
                      {REQUISITION_TYPE_LABELS[r.requisitionType as RequisitionType] ??
                        r.requisitionType}
                    </td>
                    <td className="py-1 pr-2">{r.departmentName}</td>
                    <td className="py-1 pr-2 text-xs">
                      {REQUISITION_STATUS_LABELS[r.status as RequisitionStatus] ?? r.status}
                      {r.status === 'approved' && (
                        <>
                          {' · '}
                          {PAYMENT_STATUS_LABELS[r.paymentStatus as RequisitionPaymentStatus] ??
                            r.paymentStatus}
                          {r.retirementStatus !== 'not_started' && (
                            <>
                              {' · '}
                              {RETIREMENT_STATUS_LABELS[
                                r.retirementStatus as RequisitionRetirementStatus
                              ] ?? r.retirementStatus}
                            </>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-1 text-right font-display">
                      {formatTZS(r.total)}
                      {r.retiredAmount !== null && r.retiredAmount !== r.total && (
                        <span className="block text-xs text-muted-foreground">
                          spent {formatTZS(r.retiredAmount)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ExportLinks({ report, q }: { report: string; q: string }) {
  const sep = q ? '&' : '?';
  return (
    <div className="flex gap-2 text-sm">
      <a
        href={`/api/reports/${report}/export${q}${sep}format=csv`}
        className="rounded-[--radius-card] border border-border px-3 py-1.5 font-medium text-primary-dark hover:bg-surface"
      >
        CSV
      </a>
      <a
        href={`/api/reports/${report}/export${q}${sep}format=xlsx`}
        className="rounded-[--radius-card] border border-border px-3 py-1.5 font-medium text-primary-dark hover:bg-surface"
      >
        Excel
      </a>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="font-display font-bold text-foreground">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function BigStat({
  label,
  value,
  hint,
  tone,
  emphasise = false,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
  emphasise?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-[--radius-card] border p-3.5 ${
        emphasise ? 'border-primary/40 bg-primary/[0.04]' : 'border-border'
      }`}
    >
      <span className="eyebrow text-muted-foreground">{label}</span>
      <p
        className={`font-display break-words font-bold leading-none ${
          emphasise ? 'text-[1.75rem]' : 'text-2xl'
        } ${tone ?? 'text-primary-dark'}`}
      >
        {value}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

function MiniTable({
  caption,
  rows,
  total,
}: {
  caption: string;
  rows: { key: string; label: string; count: number; amount: number }[];
  total: number;
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-primary-dark">{caption}</h3>
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="py-1 pr-2">{r.label}</td>
              <td className="py-1 pr-2 text-right font-display text-xs text-muted-foreground">
                {total > 0 ? `${Math.round((r.amount / total) * 100)}%` : '—'}
              </td>
              <td className="py-1 text-right font-display">{formatTZS(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
