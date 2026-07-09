import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type { ContractStatus } from '@/lib/supabase/types';

export type ContractListItem = {
  id: string;
  contract_number: string;
  status: ContractStatus;
  start_date: string | null;
  end_date: string | null;
  installment_amount: number;
  rider_name: string;
  registration: string;
};

export type ContractSignature = {
  id: string;
  signer_role: string;
  signer_name: string | null;
  method: string | null;
  signed_at: string;
};

export type ContractDetail = {
  id: string;
  contract_number: string;
  status: ContractStatus;
  rider_id: string;
  motorcycle_id: string;
  ownership_transfers: boolean;
  ownership_transfer_notes: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_months: number | null;
  schedule_type: 'daily' | 'selected_weekdays';
  selected_weekdays: number[];
  installment_amount: number;
  payment_deadline_time: string;
  special_terms: string | null;
  current_version: number;
  rider_name: string;
  rider_number: string;
  registration: string;
  signatures: ContractSignature[];
  hasSignedDocument: boolean;
  obligationStats: { total: number; paid: number; value: number };
};

export async function listContracts(
  status?: ContractStatus,
): Promise<ContractListItem[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('contracts')
    .select('id, contract_number, status, start_date, end_date, installment_amount, riders(first_name, last_name), motorcycles(registration_number)')
    .order('created_at', { ascending: false })
    .limit(300);
  if (status) q = q.eq('status', status);
  const { data } = await q;

  type Raw = {
    id: string;
    contract_number: string;
    status: ContractStatus;
    start_date: string | null;
    end_date: string | null;
    installment_amount: number;
    riders: { first_name: string; last_name: string } | null;
    motorcycles: { registration_number: string } | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((c) => ({
    id: c.id,
    contract_number: c.contract_number,
    status: c.status,
    start_date: c.start_date,
    end_date: c.end_date,
    installment_amount: c.installment_amount,
    rider_name: c.riders ? `${c.riders.first_name} ${c.riders.last_name}` : '—',
    registration: c.motorcycles?.registration_number ?? '—',
  }));
}

export async function getContract(id: string): Promise<ContractDetail | null> {
  const supabase = await createServerSupabase();
  const { data: c } = await supabase
    .from('contracts')
    .select('*, riders(first_name, last_name, rider_number), motorcycles(registration_number)')
    .eq('id', id)
    .maybeSingle();
  if (!c) return null;

  const { data: sigs } = await supabase
    .from('contract_signatures')
    .select('id, signer_role, signer_name, method, signed_at')
    .eq('contract_id', id)
    .order('signed_at', { ascending: true });

  const { data: signedDocs } = await supabase
    .from('contract_documents')
    .select('id')
    .eq('contract_id', id)
    .eq('is_signed', true)
    .limit(1);

  const { data: obligations } = await supabase
    .from('payment_obligations')
    .select('status, amount_due')
    .eq('contract_id', id);

  const obs = (obligations ?? []) as { status: string; amount_due: number }[];
  const raw = c as Record<string, unknown> & {
    riders: { first_name: string; last_name: string; rider_number: string } | null;
    motorcycles: { registration_number: string } | null;
  };

  return {
    id: raw.id as string,
    contract_number: raw.contract_number as string,
    status: raw.status as ContractStatus,
    rider_id: raw.rider_id as string,
    motorcycle_id: raw.motorcycle_id as string,
    ownership_transfers: Boolean(raw.ownership_transfers),
    ownership_transfer_notes: (raw.ownership_transfer_notes as string) ?? null,
    start_date: (raw.start_date as string) ?? null,
    end_date: (raw.end_date as string) ?? null,
    duration_months: (raw.duration_months as number) ?? null,
    schedule_type: raw.schedule_type as 'daily' | 'selected_weekdays',
    selected_weekdays: (raw.selected_weekdays as number[]) ?? [],
    installment_amount: raw.installment_amount as number,
    payment_deadline_time: String(raw.payment_deadline_time ?? '18:00:00').slice(0, 5),
    special_terms: (raw.special_terms as string) ?? null,
    current_version: (raw.current_version as number) ?? 1,
    rider_name: raw.riders ? `${raw.riders.first_name} ${raw.riders.last_name}` : '—',
    rider_number: raw.riders?.rider_number ?? '—',
    registration: raw.motorcycles?.registration_number ?? '—',
    signatures: (sigs ?? []) as unknown as ContractSignature[],
    hasSignedDocument: (signedDocs ?? []).length > 0,
    obligationStats: {
      total: obs.length,
      paid: obs.filter((o) => o.status === 'paid' || o.status === 'paid_in_advance').length,
      // Exclude replaced/voided rows so "total value" reflects what the
      // contract actually bills (cancelled/postponed/exempted carry no value).
      value: obs
        .filter((o) => !['cancelled', 'postponed', 'exempted'].includes(o.status))
        .reduce((s, o) => s + o.amount_due, 0),
    },
  };
}
