import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import { computeContractProgress, type ContractProgress } from '@/lib/contracts/completion';
import type { ContractStatus, ScheduleType } from '@/lib/supabase/types';

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
  duration_years: number | null;
  duration_weeks: number | null;
  duration_days: number | null;
  end_date_source: 'duration' | 'exact' | 'payment_days';
  schedule_type: ScheduleType;
  selected_weekdays: number[];
  due_day_of_month: number | null;
  installment_amount: number;
  /** Agreed daily rate; weekly/monthly instalments are derived from it. */
  daily_rate: number | null;
  payment_days_target: number | null;
  /** First lease obligation date — later than start_date when a phone is financed. */
  lease_start_date: string | null;
  phone_loan: {
    id: string;
    principal: number;
    interestBps: number;
    interestAmount: number;
    totalAmount: number;
    termMonths: number;
    status: string;
    deviceDescription: string | null;
    /** Instalments still owed on the loan, from the obligation ledger. */
    paidCount: number;
    outstandingCount: number;
    outstandingAmount: number;
  } | null;
  payment_deadline_time: string;
  special_terms: string | null;
  current_version: number;
  rider_name: string;
  rider_number: string;
  registration: string;
  signatures: ContractSignature[];
  hasSignedDocument: boolean;
  documents: ContractDocument[];
  obligationStats: { total: number; paid: number; value: number; outstanding: number };
  /** Green/red position + projected completion date (client feedback). */
  progress: ContractProgress;
};

export type ContractDocument = {
  id: string;
  doc_type: string;
  is_signed: boolean;
  version: number;
  created_at: string;
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

  const { data: docs } = await supabase
    .from('contract_documents')
    .select('id, doc_type, is_signed, version, created_at')
    .eq('contract_id', id)
    .order('created_at', { ascending: false });
  const documents = (docs ?? []) as ContractDocument[];

  const obligations = await fetchAllPages<{
    status: string;
    amount_due: number;
    due_date: string;
    kind: string | null;
    settled_at: string | null;
  }>(
    (from, to) =>
      supabase
        .from('payment_obligations')
        .select('status, amount_due, due_date, kind, settled_at')
        .eq('contract_id', id)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'contract obligations' },
  );

  const obs = obligations;
  const raw = c as Record<string, unknown> & {
    riders: { first_name: string; last_name: string; rider_number: string } | null;
    motorcycles: { registration_number: string } | null;
  };

  // Phone loan (when the rider took the motorcycle together with a phone). The
  // outstanding balance is read from the OBLIGATION ledger, never stored on the
  // loan row — a second copy of a money figure is a second source of truth.
  let phoneLoan: ContractDetail['phone_loan'] = null;
  if (raw.phone_loan_id) {
    const { data: loan } = await supabase
      .from('phone_loans')
      .select('id, principal, interest_bps, interest_amount, total_amount, term_months, status, device_description')
      .eq('id', raw.phone_loan_id as string)
      .maybeSingle();
    const l = loan as
      | {
          id: string;
          principal: number;
          interest_bps: number;
          interest_amount: number;
          total_amount: number;
          term_months: number;
          status: string;
          device_description: string | null;
        }
      | null;
    if (l) {
      const loanRows = obs.filter((o) => o.kind === 'phone_loan');
      const unpaid = loanRows.filter((o) => ['scheduled', 'due', 'overdue'].includes(o.status));
      phoneLoan = {
        id: l.id,
        principal: l.principal,
        interestBps: l.interest_bps,
        interestAmount: l.interest_amount,
        totalAmount: l.total_amount,
        termMonths: l.term_months,
        status: l.status,
        deviceDescription: l.device_description,
        paidCount: loanRows.filter((o) => ['paid', 'paid_in_advance'].includes(o.status)).length,
        outstandingCount: unpaid.length,
        outstandingAmount: unpaid.reduce((sum, o) => sum + o.amount_due, 0),
      };
    }
  }

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
    duration_years: (raw.duration_years as number) ?? 0,
    duration_weeks: (raw.duration_weeks as number) ?? 0,
    duration_days: (raw.duration_days as number) ?? 0,
    end_date_source: ((raw.end_date_source as string) ?? 'duration') as
      | 'duration'
      | 'exact'
      | 'payment_days',
    schedule_type: raw.schedule_type as ScheduleType,
    selected_weekdays: (raw.selected_weekdays as number[]) ?? [],
    due_day_of_month: (raw.due_day_of_month as number | null) ?? null,
    installment_amount: raw.installment_amount as number,
    daily_rate: (raw.daily_rate as number | null) ?? null,
    payment_days_target: (raw.payment_days_target as number | null) ?? null,
    lease_start_date: (raw.lease_start_date as string | null) ?? null,
    phone_loan: phoneLoan,
    payment_deadline_time: String(raw.payment_deadline_time ?? '18:00:00').slice(0, 5),
    special_terms: (raw.special_terms as string) ?? null,
    current_version: (raw.current_version as number) ?? 1,
    rider_name: raw.riders ? `${raw.riders.first_name} ${raw.riders.last_name}` : '—',
    rider_number: raw.riders?.rider_number ?? '—',
    registration: raw.motorcycles?.registration_number ?? '—',
    signatures: (sigs ?? []) as unknown as ContractSignature[],
    hasSignedDocument: documents.some((doc) => doc.is_signed),
    documents,
    obligationStats: {
      total: obs.length,
      paid: obs.filter((o) => o.status === 'paid' || o.status === 'paid_in_advance').length,
      // Exclude replaced/voided rows so "total value" reflects what the
      // contract actually bills (cancelled/postponed/exempted carry no value).
      value: obs
        .filter((o) => !['cancelled', 'postponed', 'exempted'].includes(o.status))
        .reduce((s, o) => s + o.amount_due, 0),
      // Still owed — drives the "Contract Ended — Outstanding Balance" state (#8).
      outstanding: obs.filter((o) => ['scheduled', 'due', 'overdue'].includes(o.status)).length,
    },
    progress: computeContractProgress(
      obs.map((o) => ({
        dueDate: o.due_date,
        amountDue: o.amount_due,
        status: o.status,
        settledDate: o.settled_at ? localDateString(new Date(o.settled_at)) : null,
      })),
      localDateString(),
    ),
  };
}
