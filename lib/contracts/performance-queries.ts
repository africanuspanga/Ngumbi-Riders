import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import {
  computeContractPerformance,
  type ContractPerformance,
} from './performance';

/*
 * Loads one contract's performance report (client request 2026-10-23).
 *
 * Read through the service role AFTER the caller has checked
 * `contracts.read`: the termination date lives in `audit_logs`, which RLS
 * keeps owner-only, and the accountant needs the same report the owner sees.
 * Only the fields the report prints are returned — no identity numbers.
 */

export type ContractPerformanceReport = {
  contractId: string;
  contractNumber: string;
  status: string;
  scheduleType: string;
  installmentAmount: number;
  startDate: string;
  scheduledEndDate: string | null;
  /** Local calendar date the contract was terminated, if it was. */
  terminatedOn: string | null;
  terminatedByName: string | null;
  rider: { id: string; name: string; riderNumber: string; phone: string | null };
  motorcycle: { id: string; code: string; registration: string | null } | null;
  /** Value of the whole contract calendar, for "how far did they get". */
  contractValue: number;
  performance: ContractPerformance;
};

export async function getContractPerformanceReport(
  contractId: string,
): Promise<ContractPerformanceReport | null> {
  const admin = createAdminClient();

  const { data: c, error } = await admin
    .from('contracts')
    .select(
      'id, contract_number, status, schedule_type, installment_amount, start_date, lease_start_date, end_date, ' +
        'rider_id, motorcycle_id, riders(first_name, last_name, rider_number, phone), ' +
        'motorcycles(motorcycle_number, registration_number)',
    )
    .eq('id', contractId)
    .maybeSingle();
  if (error) throw new Error(`performance contract read failed: ${error.message}`);
  if (!c) return null;
  const row = c as unknown as {
    id: string;
    contract_number: string;
    status: string;
    schedule_type: string;
    installment_amount: number;
    start_date: string | null;
    lease_start_date: string | null;
    end_date: string | null;
    rider_id: string;
    motorcycle_id: string | null;
    riders: { first_name: string; last_name: string; rider_number: string; phone: string | null } | null;
    motorcycles: { motorcycle_number: string; registration_number: string | null } | null;
  };

  // The most recent termination wins: a contract that was terminated,
  // reactivated and terminated again ends on the second date.
  let terminatedOn: string | null = null;
  let terminatedByName: string | null = null;
  if (row.status === 'terminated') {
    const { data: audit } = await admin
      .from('audit_logs')
      .select('created_at, actor_id')
      .eq('entity_type', 'contract')
      .eq('entity_id', contractId)
      .eq('action', 'contract.terminate')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const a = audit as { created_at: string; actor_id: string | null } | null;
    if (a) {
      terminatedOn = localDateString(new Date(a.created_at));
      if (a.actor_id) {
        const { data: p } = await admin
          .from('profiles')
          .select('full_name')
          .eq('id', a.actor_id)
          .maybeSingle();
        terminatedByName = (p as { full_name: string | null } | null)?.full_name ?? null;
      }
    }
  }

  const obligations = await fetchAllPages<{
    due_date: string;
    amount_due: number;
    status: string;
    settled_at: string | null;
  }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('due_date, amount_due, status, settled_at')
        .eq('contract_id', contractId)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'performance obligations' },
  );

  const payments = await fetchAllPages<{
    amount: number;
    method: string;
    completed_at: string | null;
    created_at: string;
  }>(
    (from, to) =>
      admin
        .from('payments')
        .select('amount, method, completed_at, created_at')
        .eq('contract_id', contractId)
        .eq('status', 'completed')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'performance payments' },
  );

  const today = localDateString();
  const startDate = row.lease_start_date ?? row.start_date ?? obligations[0]?.due_date ?? today;
  // A termination recorded in the audit trail is the cutoff; a terminated
  // contract with no audit row (terminated before auditing existed) falls back
  // to today, and the page says so.
  const cutoffDate = terminatedOn ?? today;

  const performance = computeContractPerformance({
    startDate,
    cutoffDate,
    obligations: obligations.map((o) => ({
      dueDate: o.due_date,
      amountDue: o.amount_due,
      status: o.status,
      settledDate: o.settled_at ? localDateString(new Date(o.settled_at)) : null,
    })),
    payments: payments.map((p) => ({
      amount: p.amount,
      method: p.method,
      date: localDateString(new Date(p.completed_at ?? p.created_at)),
    })),
  });

  const contractValue = obligations
    .filter((o) => o.status !== 'cancelled' && o.status !== 'postponed')
    .reduce((sum, o) => sum + o.amount_due, 0);

  return {
    contractId: row.id,
    contractNumber: row.contract_number,
    status: row.status,
    scheduleType: row.schedule_type,
    installmentAmount: row.installment_amount,
    startDate,
    scheduledEndDate: row.end_date,
    terminatedOn,
    terminatedByName,
    rider: {
      id: row.rider_id,
      name: row.riders ? `${row.riders.first_name} ${row.riders.last_name}`.trim() : 'Rider',
      riderNumber: row.riders?.rider_number ?? '—',
      phone: row.riders?.phone ?? null,
    },
    motorcycle: row.motorcycle_id
      ? {
          id: row.motorcycle_id,
          code: row.motorcycles?.motorcycle_number ?? '—',
          registration: row.motorcycles?.registration_number ?? null,
        }
      : null,
    contractValue,
    performance,
  };
}
