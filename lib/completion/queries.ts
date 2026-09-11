import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { localDateString } from '@/lib/dates/tz';
import {
  canRequestCompletion,
  OPEN_COMPLETION_STATUSES,
  type CompletionStatus,
  type Eligibility,
} from './machine';

/*
 * Completion-request reads. Staff see every row under the 0034 staff policies;
 * a rider sees their own under the self policy, so the same functions serve
 * both and RLS decides — not a parameter that somebody could forget to pass.
 *
 * OUTSTANDING MONEY IS ALWAYS RECOMPUTED. The stored
 * `finance_outstanding_snapshot` is evidence of what finance saw when they
 * cleared the request, and is presented as exactly that. The live figure beside
 * it comes from the ledger on every read, so a request that sat for a week and
 * accrued a new day cannot be approved against a stale zero.
 */

export type CompletionRequestRow = {
  id: string;
  requestNumber: string;
  status: CompletionStatus;
  contractId: string;
  contractNumber: string;
  contractStartDate: string | null;
  contractEndDate: string | null;
  ownershipTransfers: boolean;
  riderId: string;
  riderName: string;
  riderNumber: string;
  motorcycleId: string;
  motorcycleNumber: string;
  motorcycleRegistration: string | null;
  requestedByName: string;
  requestedAt: string;
  riderNote: string | null;

  financeReviewedByName: string | null;
  financeReviewedAt: string | null;
  financeNote: string | null;
  financeCleared: boolean | null;
  /** What finance SAW. Evidence, never read back as the current balance. */
  financeOutstandingSnapshot: number | null;

  directorDecidedByName: string | null;
  directorDecidedAt: string | null;
  directorNote: string | null;

  transferStartedAt: string | null;
  transferHandledByName: string | null;
  transferNote: string | null;

  signedOffByName: string | null;
  signedOffAt: string | null;
  signoffNote: string | null;

  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;

  /** LIVE, from the ledger, on every read. */
  outstandingNow: number;
  /** Unsettled obligations still ahead of today. */
  futureObligations: number;
  certificate: CertificateRow | null;
  transferDocuments: TransferDocumentRow[];
};

export type CertificateRow = {
  id: string;
  certificateNumber: string;
  version: number;
  issuedAt: string;
  issuedByName: string | null;
};

export type TransferDocumentRow = {
  id: string;
  docType: string;
  fileName: string;
  sizeBytes: number;
  note: string | null;
  createdAt: string;
  uploadedByName: string | null;
};

export type CompletionEventRow = {
  id: string;
  fromStatus: CompletionStatus | null;
  toStatus: CompletionStatus;
  actorName: string | null;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
};

const SELECT =
  'id, request_number, status, contract_id, rider_id, motorcycle_id, requested_by, requested_at, ' +
  'rider_note, finance_reviewed_by, finance_reviewed_at, finance_note, finance_cleared, ' +
  'finance_outstanding_snapshot, director_decided_by, director_decided_at, director_note, ' +
  'transfer_started_at, transfer_handled_by, transfer_note, signed_off_by, signed_off_at, ' +
  'signoff_note, rejected_by, rejected_at, rejection_reason, ' +
  /* The FK is NAMED because there are TWO relationships between these tables:
     contract_completion_requests.contract_id -> contracts, and
     contracts.completion_request_id -> contract_completion_requests (0034 §7).
     Without the hint PostgREST refuses the embed as ambiguous, which is a 500
     on every completions page — exactly what the smoke run caught. */
  'contracts!contract_completion_requests_contract_id_fkey' +
  '(contract_number, start_date, end_date, ownership_transfers), ' +
  'riders(first_name, last_name, rider_number), ' +
  'motorcycles(motorcycle_number, registration_number)';

type RawRequest = {
  id: string;
  request_number: string;
  status: string;
  contract_id: string;
  rider_id: string;
  motorcycle_id: string;
  requested_by: string;
  requested_at: string;
  rider_note: string | null;
  finance_reviewed_by: string | null;
  finance_reviewed_at: string | null;
  finance_note: string | null;
  finance_cleared: boolean | null;
  finance_outstanding_snapshot: number | null;
  director_decided_by: string | null;
  director_decided_at: string | null;
  director_note: string | null;
  transfer_started_at: string | null;
  transfer_handled_by: string | null;
  transfer_note: string | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  signoff_note: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  contracts: {
    contract_number: string;
    start_date: string | null;
    end_date: string | null;
    ownership_transfers: boolean;
  } | null;
  riders: { first_name: string; last_name: string; rider_number: string } | null;
  motorcycles: { motorcycle_number: string; registration_number: string | null } | null;
};

type Supa = Awaited<ReturnType<typeof createServerSupabase>>;

async function profileNames(supabase: Supa, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name || p.email || 'Staff',
    ]),
  );
}

/**
 * Outstanding and still-future obligations for a set of contracts, recomputed
 * from the ledger. One query for the whole page, so a queue of twenty requests
 * does not make forty.
 */
async function contractBalances(
  supabase: Supa,
  contractIds: string[],
  today: string,
): Promise<Map<string, { outstanding: number; future: number }>> {
  const out = new Map<string, { outstanding: number; future: number }>();
  if (contractIds.length === 0) return out;

  const { data, error } = await supabase
    .from('payment_obligations')
    .select('contract_id, amount_due, due_date, status')
    .in('contract_id', contractIds)
    .in('status', ['scheduled', 'due', 'overdue']);
  // Never swallow this: an empty-because-errored read would report every
  // contract as clear, which is the one answer that must not be wrong here.
  if (error) throw new Error(`completion balances read failed: ${error.message}`);

  for (const id of contractIds) out.set(id, { outstanding: 0, future: 0 });
  for (const o of (data ?? []) as {
    contract_id: string;
    amount_due: number;
    due_date: string;
    status: string;
  }[]) {
    const cur = out.get(o.contract_id) ?? { outstanding: 0, future: 0 };
    cur.outstanding += o.amount_due;
    if (o.due_date > today) cur.future += 1;
    out.set(o.contract_id, cur);
  }
  return out;
}

async function certificatesFor(
  supabase: Supa,
  requestIds: string[],
): Promise<Map<string, CertificateRow>> {
  const out = new Map<string, CertificateRow>();
  if (requestIds.length === 0) return out;
  const { data } = await supabase
    .from('contract_certificates')
    .select('id, request_id, certificate_number, version, issued_at, issued_by')
    .in('request_id', requestIds)
    .order('version', { ascending: false });
  const names = await profileNames(
    supabase,
    ((data ?? []) as { issued_by: string | null }[]).map((c) => c.issued_by),
  );
  for (const c of (data ?? []) as {
    id: string;
    request_id: string;
    certificate_number: string;
    version: number;
    issued_at: string;
    issued_by: string | null;
  }[]) {
    // Ordered by version DESC, so the first row seen for a request is the
    // CURRENT certificate; earlier versions are superseded and not shown.
    if (out.has(c.request_id)) continue;
    out.set(c.request_id, {
      id: c.id,
      certificateNumber: c.certificate_number,
      version: c.version,
      issuedAt: c.issued_at,
      issuedByName: c.issued_by ? (names.get(c.issued_by) ?? null) : null,
    });
  }
  return out;
}

async function transferDocsFor(
  supabase: Supa,
  requestIds: string[],
): Promise<Map<string, TransferDocumentRow[]>> {
  const out = new Map<string, TransferDocumentRow[]>();
  if (requestIds.length === 0) return out;
  const { data } = await supabase
    .from('ownership_transfer_documents')
    .select('id, request_id, doc_type, file_name, size_bytes, note, created_at, uploaded_by')
    .in('request_id', requestIds)
    .order('created_at', { ascending: true });
  const names = await profileNames(
    supabase,
    ((data ?? []) as { uploaded_by: string | null }[]).map((d) => d.uploaded_by),
  );
  for (const d of (data ?? []) as {
    id: string;
    request_id: string;
    doc_type: string;
    file_name: string;
    size_bytes: number;
    note: string | null;
    created_at: string;
    uploaded_by: string | null;
  }[]) {
    const list = out.get(d.request_id) ?? [];
    list.push({
      id: d.id,
      docType: d.doc_type,
      fileName: d.file_name,
      sizeBytes: d.size_bytes,
      note: d.note,
      createdAt: d.created_at,
      uploadedByName: d.uploaded_by ? (names.get(d.uploaded_by) ?? null) : null,
    });
    out.set(d.request_id, list);
  }
  return out;
}

async function hydrate(supabase: Supa, rows: RawRequest[]): Promise<CompletionRequestRow[]> {
  if (rows.length === 0) return [];
  const today = localDateString();

  const [names, balances, certificates, docs] = await Promise.all([
    profileNames(
      supabase,
      rows.flatMap((r) => [
        r.requested_by,
        r.finance_reviewed_by,
        r.director_decided_by,
        r.transfer_handled_by,
        r.signed_off_by,
        r.rejected_by,
      ]),
    ),
    contractBalances(supabase, [...new Set(rows.map((r) => r.contract_id))], today),
    certificatesFor(supabase, rows.map((r) => r.id)),
    transferDocsFor(supabase, rows.map((r) => r.id)),
  ]);

  return rows.map((r) => {
    const bal = balances.get(r.contract_id) ?? { outstanding: 0, future: 0 };
    return {
      id: r.id,
      requestNumber: r.request_number,
      status: r.status as CompletionStatus,
      contractId: r.contract_id,
      contractNumber: r.contracts?.contract_number ?? '—',
      contractStartDate: r.contracts?.start_date ?? null,
      contractEndDate: r.contracts?.end_date ?? null,
      ownershipTransfers: r.contracts?.ownership_transfers ?? false,
      riderId: r.rider_id,
      riderName: r.riders ? `${r.riders.first_name} ${r.riders.last_name}` : 'Rider',
      riderNumber: r.riders?.rider_number ?? '—',
      motorcycleId: r.motorcycle_id,
      motorcycleNumber: r.motorcycles?.motorcycle_number ?? '—',
      motorcycleRegistration: r.motorcycles?.registration_number ?? null,
      requestedByName: names.get(r.requested_by) ?? 'Rider',
      requestedAt: r.requested_at,
      riderNote: r.rider_note,

      financeReviewedByName: r.finance_reviewed_by
        ? (names.get(r.finance_reviewed_by) ?? null)
        : null,
      financeReviewedAt: r.finance_reviewed_at,
      financeNote: r.finance_note,
      financeCleared: r.finance_cleared,
      financeOutstandingSnapshot: r.finance_outstanding_snapshot,

      directorDecidedByName: r.director_decided_by
        ? (names.get(r.director_decided_by) ?? null)
        : null,
      directorDecidedAt: r.director_decided_at,
      directorNote: r.director_note,

      transferStartedAt: r.transfer_started_at,
      transferHandledByName: r.transfer_handled_by
        ? (names.get(r.transfer_handled_by) ?? null)
        : null,
      transferNote: r.transfer_note,

      signedOffByName: r.signed_off_by ? (names.get(r.signed_off_by) ?? null) : null,
      signedOffAt: r.signed_off_at,
      signoffNote: r.signoff_note,

      rejectedByName: r.rejected_by ? (names.get(r.rejected_by) ?? null) : null,
      rejectedAt: r.rejected_at,
      rejectionReason: r.rejection_reason,

      outstandingNow: bal.outstanding,
      futureObligations: bal.future,
      certificate: certificates.get(r.id) ?? null,
      transferDocuments: docs.get(r.id) ?? [],
    };
  });
}

export async function listCompletionRequests(
  opts: { statuses?: readonly CompletionStatus[]; riderId?: string; limit?: number } = {},
): Promise<CompletionRequestRow[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('contract_completion_requests')
    .select(SELECT)
    .order('requested_at', { ascending: false });
  if (opts.statuses?.length) q = q.in('status', [...opts.statuses]);
  if (opts.riderId) q = q.eq('rider_id', opts.riderId);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`listCompletionRequests failed: ${error.message}`);
  return hydrate(supabase, (data ?? []) as unknown as RawRequest[]);
}

export async function getCompletionRequest(id: string): Promise<CompletionRequestRow | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('contract_completion_requests')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getCompletionRequest failed: ${error.message}`);
  if (!data) return null;
  const [row] = await hydrate(supabase, [data as unknown as RawRequest]);
  return row ?? null;
}

export async function listCompletionEvents(requestId: string): Promise<CompletionEventRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('contract_completion_events')
    .select('id, from_status, to_status, actor_id, actor_role, note, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listCompletionEvents failed: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    from_status: string | null;
    to_status: string;
    actor_id: string | null;
    actor_role: string | null;
    note: string | null;
    created_at: string;
  }[];
  const names = await profileNames(supabase, rows.map((r) => r.actor_id));
  return rows.map((r) => ({
    id: r.id,
    fromStatus: (r.from_status ?? null) as CompletionStatus | null,
    toStatus: r.to_status as CompletionStatus,
    actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
    actorRole: r.actor_role,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------------------ *
 * One rider's view
 * ------------------------------------------------------------------------ */

export type RiderCompletionState = {
  openRequest: CompletionRequestRow | null;
  history: CompletionRequestRow[];
  contract: {
    id: string;
    number: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    ownershipTransfers: boolean;
  } | null;
  outstandingNow: number;
  futureObligations: number;
  eligibility: Eligibility;
};

export async function getRiderCompletionState(riderId: string): Promise<RiderCompletionState> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const [requests, contractRes] = await Promise.all([
    listCompletionRequests({ riderId }),
    supabase
      .from('contracts')
      .select('id, contract_number, status, start_date, end_date, ownership_transfers')
      .eq('rider_id', riderId)
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const c = contractRes.data as
    | {
        id: string;
        contract_number: string;
        status: string;
        start_date: string | null;
        end_date: string | null;
        ownership_transfers: boolean;
      }
    | null;

  const openRequest =
    requests.find((r) => (OPEN_COMPLETION_STATUSES as readonly string[]).includes(r.status)) ??
    null;

  const balances = c
    ? await contractBalances(supabase, [c.id], today)
    : new Map<string, { outstanding: number; future: number }>();
  const bal = c ? (balances.get(c.id) ?? { outstanding: 0, future: 0 }) : { outstanding: 0, future: 0 };

  return {
    openRequest,
    history: requests.filter((r) => r.id !== openRequest?.id),
    contract: c
      ? {
          id: c.id,
          number: c.contract_number,
          status: c.status,
          startDate: c.start_date,
          endDate: c.end_date,
          ownershipTransfers: c.ownership_transfers,
        }
      : null,
    outstandingNow: bal.outstanding,
    futureObligations: bal.future,
    eligibility: c
      ? canRequestCompletion({
          contractStatus: c.status,
          outstanding: bal.outstanding,
          futureObligations: bal.future,
          hasOpenRequest: Boolean(openRequest),
          contractEndDate: c.end_date,
          today,
        })
      : { ok: false, reason: 'no_contract' },
  };
}
