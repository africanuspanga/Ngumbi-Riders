import { requireOwner } from '@/lib/auth/session';
import { listMotorcycles } from '@/lib/motorcycles/queries';
import { getExpenseReport } from '@/lib/reports/queries';
import { localDateString } from '@/lib/dates/tz';
import { formatTZS } from '@/lib/money/format';
import { ExpenseForm } from './ExpenseForm';

export const metadata = { title: 'Expenses' };

export default async function ExpensesPage() {
  await requireOwner();
  const today = localDateString();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const [motorcycles, expenses] = await Promise.all([
    listMotorcycles(),
    getExpenseReport(yearStart, today),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Motorcycle expenses</h1>
        <p className="text-sm text-muted-foreground">Feeds maintenance and cash-operating-margin reports.</p>
      </header>

      <ExpenseForm
        today={today}
        motorcycles={motorcycles.map((m) => ({ id: m.id, label: `${m.registration_number} (${m.motorcycle_number})` }))}
      />

      <section className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
        <h2 className="font-semibold text-primary-dark">This year · total {formatTZS(expenses.total)}</h2>
        {expenses.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No expenses recorded.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground"><tr><th className="py-1">Date</th><th>Motorcycle</th><th>Category</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {expenses.rows.map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1">{e.date}</td>
                  <td>{e.registration}</td>
                  <td>{e.category}{e.note ? ` · ${e.note}` : ''}</td>
                  <td className="text-right font-medium">{formatTZS(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
