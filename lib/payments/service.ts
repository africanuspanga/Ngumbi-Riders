import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import type { SelectableObligation } from './selection';

/*
 * Shared server-side payment helpers used by the initiate route, the webhook,
 * and cash payments. All use the service-role client for the privileged,
 * server-validated writes that riders cannot perform under RLS.
 */

export type RiderContractContext = {
  riderId: string;
  contractId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  obligations: SelectableObligation[];
};

/** Load the rider's active contract and its outstanding obligations. */
export async function loadRiderPaymentContext(
  userId: string,
): Promise<RiderContractContext | null> {
  const admin = createAdminClient();
  const { data: rider } = await admin
    .from('riders')
    .select('id, first_name, last_name, email, status')
    .eq('profile_id', userId)
    .maybeSingle();
  if (!rider) return null;
  const r = rider as { id: string; first_name: string; last_name: string; email: string | null; status: string };
  // A disabled rider (inactive/suspended/terminated) must not initiate money
  // movements even if a stale session survives the layout/login gates.
  if (r.status !== 'active' && r.status !== 'onboarding') return null;

  const { data: contract } = await admin
    .from('contracts')
    .select('id')
    .eq('rider_id', r.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!contract) return null;
  const contractId = (contract as { id: string }).id;

  // Ordered + paginated: PostgREST caps any single select at 1000 rows, and a
  // truncated/unordered set here would feed selectOldest a subset MISSING the
  // true oldest obligations — settling newer days while older stay overdue
  // (breaks the spec §3.1 oldest-first rule for long daily contracts).
  const obligations = await fetchAllPages<{ id: string; due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('id, due_date, amount_due, status')
        .eq('contract_id', contractId)
        .in('status', ['scheduled', 'due', 'overdue'])
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'rider payment context' },
  );

  return {
    riderId: r.id,
    contractId,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    obligations: obligations.map((o) => ({ id: o.id, dueDate: o.due_date, amountDue: o.amount_due, status: o.status })),
  };
}
