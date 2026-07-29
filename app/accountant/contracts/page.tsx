import { requireAccountant } from '@/lib/auth/session';
import { listContracts } from '@/lib/contracts/queries';
import { deriveContractDisplayStatus, CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONE } from '@/lib/contracts/status';
import { localDateString } from '@/lib/dates/tz';
import { formatDate } from '@/lib/dates/format';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Contracts' };

/** Contract financial summaries for the accountant — read-only. */
export default async function AccountantContractsPage() {
  await requireAccountant();
  const contracts = await listContracts();
  const today = localDateString();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Contracts</h1>
        <p className="text-sm text-muted-foreground">{contracts.length} contract(s).</p>
      </header>

      {contracts.length === 0 ? (
        <p className="rounded-[--radius-card] border border-border bg-white p-6 text-center text-muted-foreground">
          No contracts yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-border bg-white">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Contract</th>
                <th className="px-3 py-2">Rider</th>
                <th className="px-3 py-2">Motorcycle</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Instalment</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                // Outstanding count is not loaded on this list, so a finished
                // contract reads as Completed here; the rider profile and the
                // outstanding report are where arrears are stated.
                const display = deriveContractDisplayStatus({
                  status: c.status,
                  startDate: c.start_date,
                  endDate: c.end_date,
                  today,
                });
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{c.contract_number}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.rider_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.registration}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(c.start_date)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(c.end_date)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONTRACT_STATUS_TONE[display]}`}>
                        {CONTRACT_STATUS_LABELS[display]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatTZS(c.installment_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
