import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getContract } from '@/lib/contracts/queries';
import { listAvailableMotorcycles } from '@/lib/motorcycles/queries';
import { ContractEditor } from './ContractEditor';

export const metadata = { title: 'Edit contract' };

const PRE_ACTIVATION = ['draft', 'awaiting_signatures', 'scheduled'];

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const [c, motorcycles] = await Promise.all([getContract(id), listAvailableMotorcycles()]);
  if (!c) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <Link href={`/owner/contracts/${c.id}`} className="text-sm font-medium text-muted-foreground">
          ← {c.contract_number}
        </Link>
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Edit contract</h1>
        <p className="text-sm text-muted-foreground">
          {c.rider_name} ({c.rider_number}) · {c.registration}
        </p>
      </div>

      <ContractEditor
        contract={{
          id: c.id,
          contractNumber: c.contract_number,
          status: c.status,
          motorcycleId: c.motorcycle_id,
          registration: c.registration,
          startDate: c.start_date,
          endDate: c.end_date,
          scheduleType: c.schedule_type,
          selectedWeekdays: c.selected_weekdays,
          dueDayOfMonth: c.due_day_of_month,
          durationYears: c.duration_years ?? 0,
          durationMonths: c.duration_months ?? 0,
          durationWeeks: c.duration_weeks ?? 0,
          durationDays: c.duration_days ?? 0,
          endDateSource: c.end_date_source,
          paymentDaysTarget: c.payment_days_target,
          dailyRate: c.daily_rate,
          installmentAmount: c.installment_amount,
          paymentDeadlineTime: c.payment_deadline_time,
          ownershipTransfers: c.ownership_transfers,
          ownershipTransferNotes: c.ownership_transfer_notes,
          specialTerms: c.special_terms,
          phoneLoan: c.phone_loan
            ? {
                principal: c.phone_loan.principal,
                termMonths: c.phone_loan.termMonths,
                interestBps: c.phone_loan.interestBps,
              }
            : null,
        }}
        motorcycles={motorcycles.map((m) => ({
          id: m.id,
          label: `${m.motorcycle_number}${m.registration_number ? ` · ${m.registration_number}` : ''}`,
        }))}
        termEditable={PRE_ACTIVATION.includes(c.status)}
      />
    </div>
  );
}
