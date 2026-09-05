import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { listRiders } from '@/lib/riders/queries';
import { listContractableMotorcycles } from '@/lib/motorcycles/queries';
import { ContractBuilder } from './ContractBuilder';

export const metadata = { title: 'New contract' };

export default async function NewContractPage() {
  await requireOwner();
  const supabase = await createServerSupabase();

  const [riders, motorcycles, settings, phoneRequests] = await Promise.all([
    listRiders(),
    listContractableMotorcycles(),
    supabase.from('app_settings').select('default_installment_amount').maybeSingle(),
    // What each rider ASKED FOR on their application: motorcycle only, or
    // motorcycle + phone (client feedback 2026-09-05). Pre-selecting it means
    // the owner does not have to remember, and the applicant's answer is not
    // quietly lost between application and contract.
    supabase
      .from('rider_applications')
      .select('converted_rider_id, wants_phone_loan, phone_loan_amount')
      .eq('wants_phone_loan', true)
      .not('converted_rider_id', 'is', null),
  ]);

  const defaultAmount =
    (settings.data as { default_installment_amount: number } | null)?.default_installment_amount ?? 0;

  const phoneLoanByRider = Object.fromEntries(
    (
      (phoneRequests.data ?? []) as {
        converted_rider_id: string | null;
        phone_loan_amount: number | null;
      }[]
    )
      .filter((r) => r.converted_rider_id)
      .map((r) => [r.converted_rider_id as string, r.phone_loan_amount ?? null]),
  );

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/owner/contracts" className="text-sm font-medium text-muted-foreground">
          ← Contracts
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">New contract</h1>
        <p className="text-sm text-muted-foreground">
          Build the lease, preview obligations, then create a draft to sign and
          activate.
        </p>
      </div>
      <ContractBuilder
        riders={riders
          .filter((r) => r.status === 'active' || r.status === 'onboarding')
          .map((r) => ({ id: r.id, label: `${r.first_name} ${r.last_name} (${r.rider_number})` }))}
        motorcycles={motorcycles}
        defaultAmount={defaultAmount}
        phoneLoanByRider={phoneLoanByRider}
      />
    </div>
  );
}
