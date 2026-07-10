import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listContracts } from '@/lib/contracts/queries';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Contracts' };

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-surface text-muted-foreground',
  awaiting_signatures: 'bg-amber-50 text-[color:var(--color-warning)]',
  scheduled: 'bg-blue-50 text-[color:var(--color-advance)]',
  active: 'bg-surface text-[color:var(--color-paid)]',
  paused: 'bg-amber-50 text-[color:var(--color-warning)]',
  completed: 'bg-surface text-[color:var(--color-paid)]',
  completed_early: 'bg-surface text-[color:var(--color-paid)]',
  terminated: 'bg-red-50 text-[color:var(--color-overdue)]',
  cancelled: 'bg-surface text-muted-foreground',
};

export default async function ContractsPage() {
  await requireOwner();
  const contracts = await listContracts();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">Contracts</h1>
          <p className="text-sm text-muted-foreground">Lease agreements and their status.</p>
        </div>
        <Link
          href="/owner/contracts/new"
          className="rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
        >
          New contract
        </Link>
      </header>

      {contracts.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          No contracts yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
          {contracts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/owner/contracts/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground">
                    {c.contract_number} · {c.rider_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.registration} · {formatTZS(c.installment_amount)}/installment
                    {c.start_date && ` · ${c.start_date} → ${c.end_date}`}
                  </span>
                </div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[c.status]}`}>
                  {c.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
