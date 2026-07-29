import Link from 'next/link';
import { requireAccountant } from '@/lib/auth/session';
import { getArrearsReport } from '@/lib/reports/queries';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';

export const metadata = { title: 'Outstanding balances' };

/** Overdue obligations and outstanding balances per rider (build spec #10). */
export default async function AccountantOutstandingPage() {
  await requireAccountant();
  const arrears = await getArrearsReport();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Outstanding balances</h1>
        <p className="text-sm text-muted-foreground">
          {arrears.totalCount} unpaid obligation(s) · {formatTZS(arrears.totalAmount)} owed in total.
        </p>
      </header>

      {arrears.rows.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          Nothing outstanding — every rider is up to date.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Rider</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Oldest overdue</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2 text-right">Unpaid</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {arrears.rows.map((r) => (
                <tr key={r.riderId} className="border-t border-border hover:bg-surface">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/accountant/riders/${r.riderId}`} className="hover:underline">
                      {r.riderName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.riderNumber}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(r.oldestOverdue)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{r.daysOverdue}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{r.count}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[color:var(--color-overdue)]">
                    {formatTZS(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
