import { requireAccountant } from '@/lib/auth/session';
import { getDepartmentOverview } from '@/lib/departments/queries';
import { listRequisitionsForDashboard } from '@/lib/requisitions/queries';
import { localDateString } from '@/lib/dates/tz';
import { parseFilters, filtersToQuery } from '@/lib/reports/cashflow';
import { DepartmentBoard } from '@/components/departments/DepartmentBoard';
import { NewExpenseForm } from '@/components/departments/DepartmentForms';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Departments & budgets' };

/**
 * Finance's view of the same board.
 *
 * The accountant records SPEND and nothing else: no "new department" and no
 * "assign a budget" control, because `departments.write` and `budgets.write`
 * are owner-only and an accountant who could set their own budget could
 * authorise their own spending. (Omitting the forms is only tidiness — the
 * actions themselves refuse them.)
 */
export default async function AccountantDepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAccountant();
  const sp = await searchParams;
  const today = localDateString();
  const filters = parseFilters(sp, { from: `${today.slice(0, 7)}-01`, to: today });

  const [overview, approved] = await Promise.all([
    getDepartmentOverview({ from: filters.from, to: filters.to }),
    listRequisitionsForDashboard({ statuses: ['approved'], limit: 50 }),
  ]);

  const departments = overview.positions
    .filter((p) => p.department.isActive)
    .map((p) => ({ id: p.department.id, name: p.department.name }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Departments &amp; budgets</h1>
        <p className="text-sm text-muted-foreground">
          Budgets are set by the Managing Director. You record what was spent against them.
        </p>
      </header>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-[--radius-card] border border-border bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={filters.from} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={filters.to} className="input" />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          Apply
        </button>
        <a
          href={`/api/reports/expense-ledger/export${filtersToQuery(filters)}&format=xlsx`}
          className="min-h-11 rounded-[--radius-card] border border-border px-4 py-2.5 font-semibold text-primary-dark hover:bg-surface"
        >
          Export Excel
        </a>
      </form>

      <DepartmentBoard overview={overview} basePath="/accountant" />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Record spend</h2>
        <NewExpenseForm
          departments={departments}
          today={today}
          approvedRequisitions={approved.map((r) => ({
            id: r.id,
            label: `${r.requisitionNumber} · ${r.title} · ${formatTZS(r.total)}`,
          }))}
        />
      </section>
    </div>
  );
}
