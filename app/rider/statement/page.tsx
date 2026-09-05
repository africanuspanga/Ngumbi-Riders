import { requireRider } from '@/lib/auth/session';
import { getRiderStatement, getRiderPaymentHistory } from '@/lib/payments/queries';
import { StatementSummary, StatementTable } from '@/components/payments/StatementView';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { methodLabel } from '@/lib/payments/statement';

export const metadata = { title: 'Taarifa ya malipo' };

/**
 * The rider's own bank-style statement. Same builder as the owner's view — a
 * rider who can see exactly what they were charged and what was received is a
 * rider who does not have to phone the office to ask.
 */
export default async function RiderStatementPage() {
  const profile = await requireRider();
  if (!profile.riderId) {
    return <p className="text-muted-foreground">Huna mkataba kwa sasa.</p>;
  }
  const [statement, payments] = await Promise.all([
    getRiderStatement(profile.riderId),
    getRiderPaymentHistory(profile.riderId),
  ]);
  if (!statement) {
    return <p className="text-muted-foreground">Huna taarifa za malipo bado.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold text-primary-dark">Taarifa ya malipo</h1>
        <p className="text-sm text-muted-foreground">
          {statement.riderNumber}
          {statement.contractNumber ? ` · ${statement.contractNumber}` : ''}
        </p>
      </header>

      <StatementSummary progress={statement.progress} />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-primary-dark">Malipo uliyofanya</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bado hujafanya malipo.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
            {payments.slice(0, 20).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{formatTZS(p.amount)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(p.completedAt ?? p.createdAt)} ·{' '}
                    {p.method === 'cash' ? 'Taslimu' : methodLabel(p.method)}
                    {p.receivedByName ? ` · ${p.receivedByName}` : ''}
                  </p>
                </div>
                {p.receiptNumber && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {p.receiptNumber}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-primary-dark">Taarifa kamili</h2>
        <StatementTable statement={statement.statement} />
      </section>
    </div>
  );
}
