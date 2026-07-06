import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { listRiders } from '@/lib/riders/queries';
import { listAvailableMotorcycles } from '@/lib/motorcycles/queries';
import { ContractBuilder } from './ContractBuilder';

export const metadata = { title: 'New contract' };

export default async function NewContractPage() {
  await requireOwner();
  const supabase = await createServerSupabase();

  const [riders, motorcycles, settings] = await Promise.all([
    listRiders(),
    listAvailableMotorcycles(),
    supabase.from('app_settings').select('default_installment_amount').maybeSingle(),
  ]);

  const defaultAmount =
    (settings.data as { default_installment_amount: number } | null)?.default_installment_amount ?? 0;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/owner/contracts" className="text-sm font-medium text-muted">
          ← Contracts
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">New contract</h1>
        <p className="text-sm text-muted">
          Build the lease, preview obligations, then create a draft to sign and
          activate.
        </p>
      </div>
      <ContractBuilder
        riders={riders
          .filter((r) => r.status === 'active' || r.status === 'onboarding')
          .map((r) => ({ id: r.id, label: `${r.first_name} ${r.last_name} (${r.rider_number})` }))}
        motorcycles={motorcycles.map((m) => ({
          id: m.id,
          label: `${m.registration_number} (${m.motorcycle_number})`,
        }))}
        defaultAmount={defaultAmount}
      />
    </div>
  );
}
