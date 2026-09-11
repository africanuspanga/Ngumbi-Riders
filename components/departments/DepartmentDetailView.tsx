import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateRange } from '@/lib/dates/format';
import { ITEM_CATEGORY_LABELS, type RequisitionItemCategory } from '@/lib/requisitions/constants';
import { EXPENSE_SOURCE_LABELS } from '@/lib/reports/filter-labels';
import type { DepartmentDetail } from '@/lib/departments/detail';
import { DeleteBudgetButton, DeleteExpenseButton } from './DepartmentRowActions';

/*
 * One department's page: its allocations, its spend, and what is left of the
 * budget for the period in the URL.
 *
 * A SERVER component. `canManageBudgets` is a BOOLEAN, not a callback — the
 * destructive controls are small client components imported here, which is the
 * only shape that crosses the boundary safely (spec rule 16).
 */
export function DepartmentDetailView({
  detail,
  basePath,
  canManageBudgets,
}: {
  detail: DepartmentDetail;
  basePath: string;
  canManageBudgets: boolean;
}) {
  const { department, position, budgets, expenses, range } = detail;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">
          {department.name}{' '}
          <span className="font-mono text-sm font-normal text-muted-foreground">
            {department.code}
          </span>
        </h1>
        {department.description && (
          <p className="text-sm text-muted-foreground">{department.description}</p>
        )}
        {!department.isActive && (
          <p className="mt-1 inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Inactive — kept for its history
          </p>
        )}
      </header>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-[--radius-card] border border-border bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={range.from} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={range.to} className="input" />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          Apply
        </button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Budgeted"
          value={formatTZS(position.allocated)}
          hint={formatDateRange(range.from, range.to)}
        />
        <Stat
          label="Spent"
          value={formatTZS(position.spent)}
          hint={`${position.expenseCount} expense${position.expenseCount === 1 ? '' : 's'}`}
          tone="text-[color:var(--color-overdue)]"
        />
        <Stat
          label={position.remaining < 0 ? 'Over budget' : 'Remaining'}
          value={formatTZS(Math.abs(position.remaining))}
          tone={
            position.remaining < 0
              ? 'text-[color:var(--color-overdue)]'
              : 'text-[color:var(--color-paid)]'
          }
        />
        <Stat
          label="Utilisation"
          value={
            position.utilisation === null
              ? '—'
              : `${Math.round(position.utilisation * 100)}%`
          }
          hint={position.utilisation === null ? 'no budget set' : undefined}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">Budget allocations</h2>
        {budgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No budget has been allocated to this department.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Allocation</th>
                  <th className="py-1 pr-2 font-medium">Period</th>
                  <th className="py-1 pr-2 text-right font-medium">Amount</th>
                  {canManageBudgets && <th className="py-1" />}
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="py-1 pr-2">{b.label}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {formatDateRange(b.periodStart, b.periodEnd)}
                    </td>
                    <td className="font-display py-1 pr-2 text-right">
                      {formatTZS(b.amount)}
                    </td>
                    {canManageBudgets && (
                      <td className="py-1 text-right">
                        <DeleteBudgetButton budgetId={b.id} label={b.label} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Allocations that overlap the selected period are summed. &ldquo;Remaining&rdquo; is
          budget minus spend, computed on read — no total is stored, so it cannot go stale.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">
          Expenses ({formatDateRange(range.from, range.to)})
        </h2>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Date</th>
                  <th className="py-1 pr-2 font-medium">Description</th>
                  <th className="py-1 pr-2 font-medium">Category</th>
                  <th className="py-1 pr-2 font-medium">Source</th>
                  <th className="py-1 pr-2 text-right font-medium">Amount</th>
                  {canManageBudgets && <th className="py-1" />}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={`${e.source}-${e.id}`} className="border-t border-border">
                    <td className="py-1 pr-2 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="py-1 pr-2">
                      {e.description}
                      {e.supplier && (
                        <span className="block text-xs text-muted-foreground">{e.supplier}</span>
                      )}
                      {e.requisitionId && (
                        <Link
                          href={`${basePath}/requisitions/${e.requisitionId}`}
                          className="block text-xs text-primary underline"
                        >
                          against an approved purchase request
                        </Link>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      {ITEM_CATEGORY_LABELS[e.category as RequisitionItemCategory] ?? e.category}
                    </td>
                    <td className="py-1 pr-2 text-muted-foreground">
                      {EXPENSE_SOURCE_LABELS[e.source]}
                      {e.motorcycleLabel ? ` · ${e.motorcycleLabel}` : ''}
                    </td>
                    <td className="font-display py-1 pr-2 text-right">
                      {formatTZS(e.amount)}
                    </td>
                    {canManageBudgets && (
                      <td className="py-1 text-right">
                        {/* Only the general ledger's own rows are deletable
                            here; a motorcycle expense is edited where it lives,
                            because it also drives that motorcycle's margin. */}
                        {e.source === 'department' && (
                          <DeleteExpenseButton expenseId={e.id} label={e.description} />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-border">
                  <td className="py-1 pr-2 font-semibold" colSpan={4}>
                    Total
                  </td>
                  <td className="font-display py-1 pr-2 text-right font-bold">
                    {formatTZS(position.spent)}
                  </td>
                  {canManageBudgets && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
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
    <div className="rounded-[--radius-card] border border-border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`break-words text-lg font-bold tabular-nums ${tone ?? 'text-primary-dark'}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
