import Link from 'next/link';
import { formatTZS } from '@/lib/money/format';
import { formatDate, formatDateRange } from '@/lib/dates/format';
import { ITEM_CATEGORY_LABELS, type RequisitionItemCategory } from '@/lib/requisitions/constants';
import { EXPENSE_SOURCE_LABELS } from '@/lib/reports/filter-labels';
import type { DepartmentOverview } from '@/lib/departments/queries';

/*
 * The department budget board (client feedback 2026-09-11 #2).
 *
 * Every figure here is DERIVED — allocated, spent, remaining, utilisation —
 * computed on read by lib/departments/compute.ts. Nothing is stored, so nothing
 * can go stale (D-034 rule 3).
 *
 * A SERVER component shared by the owner and accountant pages. `basePath` is a
 * plain string, never a callback: only components cross the client/server
 * boundary (spec rule 16).
 *
 * OVERSPEND IS SHOWN, NOT HIDDEN. A negative remaining balance renders in the
 * overdue red with the word "over", because the point of a budget board is to
 * make exactly that visible; clamping it at zero would turn the one number the
 * Director needs into a reassuring lie.
 */
export function DepartmentBoard({
  overview,
  basePath,
}: {
  overview: DepartmentOverview;
  basePath: string;
}) {
  const { positions, totals, untagged, range } = overview;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Budgeted" value={formatTZS(totals.allocated)} hint={formatDateRange(range.from, range.to)} />
        <Stat
          label="Spent"
          value={formatTZS(totals.spent)}
          hint="against a department"
          tone="text-[color:var(--color-overdue)]"
        />
        <Stat
          label="Remaining"
          value={formatTZS(totals.remaining)}
          hint={totals.remaining < 0 ? 'over budget' : 'still available'}
          tone={
            totals.remaining < 0
              ? 'text-[color:var(--color-overdue)]'
              : 'text-[color:var(--color-paid)]'
          }
        />
        <Stat
          label="Total spend"
          value={formatTZS(totals.totalSpend)}
          hint={
            totals.untaggedSpend > 0
              ? `includes ${formatTZS(totals.untaggedSpend)} not assigned`
              : 'all assigned'
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Departments</h2>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {positions.map((p) => (
              <li
                key={p.department.id}
                className={`flex flex-col gap-2 rounded-[--radius-card] border bg-white p-4 ${
                  p.overspent ? 'border-[color:var(--color-overdue)]/50' : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-primary-dark">
                      <Link
                        href={`${basePath}/departments/${p.department.id}`}
                        className="hover:underline"
                      >
                        {p.department.name}
                      </Link>{' '}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        {p.department.code}
                      </span>
                      {!p.department.isActive && (
                        <span className="ml-2 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.expenseCount} expense{p.expenseCount === 1 ? '' : 's'} in this period
                      {p.budgets.length > 0
                        ? ` · ${p.budgets.length} budget allocation${p.budgets.length === 1 ? '' : 's'}`
                        : ' · no budget set'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-bold leading-none text-primary-dark">
                      {formatTZS(p.spent)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      of {p.allocated > 0 ? formatTZS(p.allocated) : 'no budget'}
                    </p>
                  </div>
                </div>

                <UtilisationBar
                  spent={p.spent}
                  allocated={p.allocated}
                  utilisation={p.utilisation}
                  overspent={p.overspent}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span
                    className={
                      p.remaining < 0
                        ? 'font-semibold text-[color:var(--color-overdue)]'
                        : 'text-muted-foreground'
                    }
                  >
                    {p.allocated === 0
                      ? 'No budget allocated for this period'
                      : p.remaining < 0
                        ? `${formatTZS(-p.remaining)} over budget`
                        : `${formatTZS(p.remaining)} remaining`}
                  </span>
                  {p.byCategory.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Top:{' '}
                      {p.byCategory
                        .slice(0, 3)
                        .map(
                          (c) =>
                            `${ITEM_CATEGORY_LABELS[c.category as RequisitionItemCategory] ?? c.category} ${formatTZS(c.amount)}`,
                        )
                        .join(' · ')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Unassigned spend is surfaced, not folded into "Other" — the Director
          needs to know how much of the books is unclassified. */}
      {untagged.length > 0 && (
        <section className="flex flex-col gap-2 rounded-[--radius-card] border border-[color:var(--color-warning)]/40 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">
            {formatTZS(totals.untaggedSpend)} not assigned to a department
          </h2>
          <p className="text-sm text-amber-900">
            {untagged.length} expense{untagged.length === 1 ? '' : 's'} in this period has no
            department, so it appears in the totals but not in any budget. Motorcycle expenses can
            be filed from the expense ledger.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-amber-200 text-amber-900/70">
                <tr>
                  <th className="py-1 pr-2 font-medium">Date</th>
                  <th className="py-1 pr-2 font-medium">Description</th>
                  <th className="py-1 pr-2 font-medium">Source</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {untagged.slice(0, 15).map((e) => (
                  <tr key={`${e.source}-${e.id}`} className="border-t border-amber-200">
                    <td className="py-1 pr-2 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="py-1 pr-2">{e.description}</td>
                    <td className="py-1 pr-2">
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
        </section>
      )}
    </div>
  );
}

function UtilisationBar({
  spent,
  allocated,
  utilisation,
  overspent,
}: {
  spent: number;
  allocated: number;
  utilisation: number | null;
  overspent: boolean;
}) {
  if (allocated <= 0) {
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-0" />
      </div>
    );
  }
  // Capped at 100% for the bar's WIDTH only — the overspend is stated in words
  // beside it, so nothing is hidden by the cap.
  const pct = Math.min(100, Math.round(((utilisation ?? spent / allocated) || 0) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${
            overspent
              ? 'bg-[color:var(--color-overdue)]'
              : pct >= 80
                ? 'bg-[color:var(--color-warning)]'
                : 'bg-[color:var(--color-paid)]'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-display shrink-0 text-xs text-muted-foreground">
        {Math.round(((utilisation ?? 0) || 0) * 100)}%
      </span>
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
    <div className="flex flex-col gap-1.5 rounded-[--radius-card] border border-border bg-white p-3.5">
      <span className="eyebrow text-muted-foreground">{label}</span>
      <p className={`font-display break-words text-xl font-bold leading-none ${tone ?? 'text-primary-dark'}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
