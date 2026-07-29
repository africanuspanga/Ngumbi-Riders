import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listContracts } from '@/lib/contracts/queries';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { localDateString } from '@/lib/dates/tz';
import {
  deriveContractDisplayStatus,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONE,
} from '@/lib/contracts/status';

export const metadata = { title: 'Contracts' };

export default async function ContractsPage() {
  await requireOwner();
  const contracts = await listContracts();
  // Status is DERIVED (build spec #8), so a lease whose end date has passed
  // reads as completed here even before the nightly completion job runs.
  const today = localDateString();

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
                    {c.start_date && ` · ${formatDate(c.start_date)} → ${formatDate(c.end_date)}`}
                  </span>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    CONTRACT_STATUS_TONE[
                      deriveContractDisplayStatus({
                        status: c.status,
                        startDate: c.start_date,
                        endDate: c.end_date,
                        today,
                      })
                    ]
                  }`}
                >
                  {
                    CONTRACT_STATUS_LABELS[
                      deriveContractDisplayStatus({
                        status: c.status,
                        startDate: c.start_date,
                        endDate: c.end_date,
                        today,
                      })
                    ]
                  }
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
