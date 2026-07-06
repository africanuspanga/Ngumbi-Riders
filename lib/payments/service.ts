import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { formatReceiptNumber } from './receipt';
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
    .select('id, first_name, last_name, email')
    .eq('profile_id', userId)
    .maybeSingle();
  if (!rider) return null;
  const r = rider as { id: string; first_name: string; last_name: string; email: string | null };

  const { data: contract } = await admin
    .from('contracts')
    .select('id')
    .eq('rider_id', r.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!contract) return null;
  const contractId = (contract as { id: string }).id;

  const { data: obligations } = await admin
    .from('payment_obligations')
    .select('id, due_date, amount_due, status')
    .eq('contract_id', contractId)
    .in('status', ['scheduled', 'due', 'overdue']);

  return {
    riderId: r.id,
    contractId,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    obligations: ((obligations ?? []) as { id: string; due_date: string; amount_due: number; status: string }[]).map(
      (o) => ({ id: o.id, dueDate: o.due_date, amountDue: o.amount_due, status: o.status }),
    ),
  };
}

/** Allocate the next receipt number for the current year. */
export async function nextReceiptNumber(year: number): Promise<string> {
  const admin = createAdminClient();
  const { count } = await admin.from('receipts').select('*', { count: 'exact', head: true });
  return formatReceiptNumber(year, (count ?? 0) + 1);
}
