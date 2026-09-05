import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getRiderPaymentHistory, getRiderStatement } from '@/lib/payments/queries';
import { PaymentHistory } from '@/components/payments/PaymentHistory';
import { StatementSummary, StatementTable } from '@/components/payments/StatementView';
import { formatDateRange } from '@/lib/dates/format';
import { localDateString } from '@/lib/dates/tz';

export const metadata = { title: 'Rider payments' };

/**
 * One rider's payment history AND bank-style statement, with a date range —
 * the two things the client asked for, on one screen so the owner never has to
 * cross-reference two pages while a rider is standing in front of them.
 */
export default async function RiderPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireOwner();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const from = isDate(sp.from) ? sp.from! : null;
  const to = isDate(sp.to) ? sp.to! : null;

  const [statement, payments] = await Promise.all([
    getRiderStatement(id, { from, to }),
    getRiderPaymentHistory(id),
  ]);
  if (!statement) notFound();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/owner/payments" className="text-sm font-medium text-muted-foreground">
            ← Payments
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {statement.riderName}
          </h1>
          <p className="text-muted-foreground text-sm">
            {statement.riderNumber}
            {statement.contractNumber ? ` · ${statement.contractNumber}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/owner/riders/${id}`}
            className="flex min-h-11 items-center rounded-[--radius-card] border border-border bg-white px-4 text-sm font-semibold text-primary-dark hover:bg-surface"
          >
            Rider profile
          </Link>
          <a
            href={`/api/reports/rider-statement/export?rider=${id}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}&format=xlsx`}
            className="flex min-h-11 items-center rounded-[--radius-card] border border-border bg-white px-4 text-sm font-semibold text-primary-dark hover:bg-surface"
          >
            Export
          </a>
        </div>
      </header>

      <StatementSummary progress={statement.progress} />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-primary-dark">Payment history</h2>
        <PaymentHistory payments={payments} receiptHref={null} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-semibold text-primary-dark">
            Statement <span className="text-muted-foreground text-sm font-normal">
              {from || to ? formatDateRange(from, to) : 'all time'}
            </span>
          </h2>
          <form className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">From</span>
              <input type="date" name="from" defaultValue={from ?? ''} max={localDateString()} className="input h-10" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">To</span>
              <input type="date" name="to" defaultValue={to ?? ''} className="input h-10" />
            </label>
            <button
              type="submit"
              className="min-h-10 rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover"
            >
              Apply
            </button>
          </form>
        </div>
        <StatementTable statement={statement.statement} />
      </section>
    </div>
  );
}
