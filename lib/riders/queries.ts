import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import { deriveContractDisplayStatus } from '@/lib/contracts/status';
import type { RiderDirectoryRow } from './directory';
import type { ContractStatus, RiderStatus, RiskLevel } from '@/lib/supabase/types';

/* Owner-side rider reads (RLS confirms owner). */

export type RiderListItem = {
  id: string;
  rider_number: string;
  first_name: string;
  last_name: string;
  phone: string;
  status: RiderStatus;
  risk_level: RiskLevel;
};

export type RiderDetail = RiderListItem & {
  risk_reasons: string[];
  middle_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  region: string | null;
  district: string | null;
  ward: string | null;
  street: string | null;
  full_address: string | null;
  currentMotorcycle: {
    assignmentId: string;
    motorcycleId: string;
    registration: string;
    startDate: string;
  } | null;
  assignments: {
    id: string;
    motorcycle_id: string;
    registration: string;
    is_active: boolean;
    start_date: string;
    end_date: string | null;
    transfer_reason: string | null;
  }[];
  hasPrivateData: boolean;
  complianceWarnings: string[];
};

export async function listRiders(status?: RiderStatus): Promise<RiderListItem[]> {
  const supabase = await createServerSupabase();
  let q = supabase
    .from('riders')
    .select('id, rider_number, first_name, last_name, phone, status, risk_level')
    .order('rider_number', { ascending: true })
    .limit(500);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return (data ?? []) as unknown as RiderListItem[];
}

/**
 * A short-lived signed URL for a private storage object, or null. Profile
 * pictures live in the PRIVATE rider-documents bucket (identity material never
 * goes in a public bucket, spec §24), so every render mints a fresh signed URL.
 */
export async function signedStorageUrl(
  bucket: string,
  path: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Signed URLs for many rider photos at once (directory listing). */
async function signedPhotoUrls(paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return new Map();
  const admin = createAdminClient();
  const { data } = await admin.storage.from('rider-documents').createSignedUrls(unique, 3600);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as { path: string | null; signedUrl: string | null }[]) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}

/**
 * Every rider with the motorcycle, contract and money facts the directory
 * searches, filters and sorts on (build spec #2).
 *
 * Fleet-scaling reads are PAGINATED (D-033): the obligation table alone is
 * hundreds of rows per rider, and PostgREST silently caps any single select at
 * 1000 rows — a truncated fetch here would understate arrears on the owner's
 * main screen. Errors are surfaced rather than swallowed.
 */
export async function listRiderDirectory(): Promise<RiderDirectoryRow[]> {
  const supabase = await createServerSupabase();
  const today = localDateString();

  const riders = await fetchAllPages<{
    id: string;
    rider_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    phone: string;
    email: string | null;
    status: RiderStatus;
    risk_level: RiskLevel;
    region: string | null;
    district: string | null;
    photo_path: string | null;
    created_at: string;
  }>(
    (from, to) =>
      supabase
        .from('riders')
        .select(
          'id, rider_number, first_name, middle_name, last_name, phone, email, status, risk_level, region, district, photo_path, created_at',
        )
        .order('rider_number', { ascending: true })
        .range(from, to),
    { label: 'rider directory riders' },
  );
  if (riders.length === 0) return [];

  const [assignments, contracts, obligations, photoUrls] = await Promise.all([
    fetchAllPages<{
      rider_id: string;
      motorcycle_id: string;
      motorcycles: { motorcycle_number: string; registration_number: string | null } | null;
    }>(
      (from, to) =>
        supabase
          .from('motorcycle_assignments')
          .select('rider_id, motorcycle_id, motorcycles(motorcycle_number, registration_number)')
          .eq('is_active', true)
          .order('rider_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data:
            | {
                rider_id: string;
                motorcycle_id: string;
                motorcycles: { motorcycle_number: string; registration_number: string | null } | null;
              }[]
            | null;
          error: { message: string } | null;
        }>,
      { label: 'rider directory assignments' },
    ),
    fetchAllPages<{
      id: string;
      rider_id: string;
      contract_number: string;
      status: ContractStatus;
      start_date: string | null;
      end_date: string | null;
      created_at: string;
    }>(
      (from, to) =>
        supabase
          .from('contracts')
          .select('id, rider_id, contract_number, status, start_date, end_date, created_at')
          .order('rider_id', { ascending: true })
          .order('created_at', { ascending: false })
          .range(from, to),
      { label: 'rider directory contracts' },
    ),
    fetchAllPages<{ rider_id: string; due_date: string; amount_due: number; status: string }>(
      (from, to) =>
        supabase
          .from('payment_obligations')
          .select('rider_id, due_date, amount_due, status')
          .order('rider_id', { ascending: true })
          .order('due_date', { ascending: true })
          .range(from, to),
      { label: 'rider directory obligations' },
    ),
    signedPhotoUrls(riders.map((r) => r.photo_path)),
  ]);

  const assignByRider = new Map(assignments.map((a) => [a.rider_id, a]));

  // Most relevant contract per rider: a live one if there is one, else the most
  // recently created (so a finished lease still shows as Completed).
  const LIVE = new Set<ContractStatus>(['active', 'paused', 'scheduled', 'draft', 'awaiting_signatures']);
  const contractByRider = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) {
    const current = contractByRider.get(c.rider_id);
    if (!current) {
      contractByRider.set(c.rider_id, c);
      continue;
    }
    const currentLive = LIVE.has(current.status);
    const candidateLive = LIVE.has(c.status);
    if (candidateLive && !currentLive) contractByRider.set(c.rider_id, c);
  }

  const OUTSTANDING = new Set(['scheduled', 'due', 'overdue']);
  const SETTLED = new Set(['paid', 'paid_in_advance']);
  type Money = {
    paid: number;
    outstanding: number;
    outstandingCount: number;
    overdueCount: number;
    nextDate: string | null;
  };
  const money = new Map<string, Money>();
  for (const o of obligations) {
    const m =
      money.get(o.rider_id) ??
      { paid: 0, outstanding: 0, outstandingCount: 0, overdueCount: 0, nextDate: null };
    if (SETTLED.has(o.status)) {
      m.paid += o.amount_due;
    } else if (OUTSTANDING.has(o.status)) {
      m.outstanding += o.amount_due;
      m.outstandingCount++;
      if (o.status === 'overdue' || o.due_date < today) m.overdueCount++;
      if (o.due_date >= today && (m.nextDate === null || o.due_date < m.nextDate)) {
        m.nextDate = o.due_date;
      }
    }
    money.set(o.rider_id, m);
  }

  return riders.map((r) => {
    const a = assignByRider.get(r.id) ?? null;
    const c = contractByRider.get(r.id) ?? null;
    const m = money.get(r.id) ?? {
      paid: 0,
      outstanding: 0,
      outstandingCount: 0,
      overdueCount: 0,
      nextDate: null,
    };
    return {
      id: r.id,
      riderNumber: r.rider_number,
      firstName: r.first_name,
      lastName: r.last_name,
      middleName: r.middle_name,
      fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
      phone: r.phone,
      email: r.email,
      photoUrl: r.photo_path ? (photoUrls.get(r.photo_path) ?? null) : null,
      status: r.status,
      riskLevel: r.risk_level,
      region: r.region,
      district: r.district,
      registeredAt: r.created_at,
      // The encrypted NIDA is never decrypted for a list view; the profile page
      // reveals it deliberately and audibly. Search by ID is therefore offered
      // only on the rider profile, not here.
      nidaLast4: null,
      motorcycleId: a?.motorcycle_id ?? null,
      motorcycleCode: a?.motorcycles?.motorcycle_number ?? null,
      motorcycleRegistration: a?.motorcycles?.registration_number ?? null,
      contractId: c?.id ?? null,
      contractNumber: c?.contract_number ?? null,
      contractStatus: c
        ? deriveContractDisplayStatus({
            status: c.status,
            startDate: c.start_date,
            endDate: c.end_date,
            outstandingCount: m.outstandingCount,
            today,
          })
        : null,
      contractStartDate: c?.start_date ?? null,
      contractEndDate: c?.end_date ?? null,
      amountPaid: m.paid,
      amountOutstanding: m.outstanding,
      outstandingCount: m.outstandingCount,
      overdueCount: m.overdueCount,
      nextPaymentDate: m.nextDate,
    };
  });
}

export async function getRider(id: string): Promise<RiderDetail | null> {
  const supabase = await createServerSupabase();
  const { data: rider } = await supabase
    .from('riders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!rider) return null;

  const { data: assignments } = await supabase
    .from('motorcycle_assignments')
    .select('id, motorcycle_id, is_active, start_date, end_date, transfer_reason, motorcycles(registration_number)')
    .eq('rider_id', id)
    .order('start_date', { ascending: false });

  const { data: priv } = await supabase
    .from('rider_private_data')
    .select('rider_id')
    .eq('rider_id', id)
    .maybeSingle();

  type RawAssignment = {
    id: string;
    motorcycle_id: string;
    is_active: boolean;
    start_date: string;
    end_date: string | null;
    transfer_reason: string | null;
    motorcycles: { registration_number: string } | null;
  };
  const rows = (assignments ?? []) as unknown as RawAssignment[];
  const mapped = rows.map((a) => ({
    id: a.id,
    motorcycle_id: a.motorcycle_id,
    registration: a.motorcycles?.registration_number ?? '—',
    is_active: a.is_active,
    start_date: a.start_date,
    end_date: a.end_date,
    transfer_reason: a.transfer_reason,
  }));
  const activeRow = mapped.find((a) => a.is_active) ?? null;

  const r = rider as unknown as RiderDetail;
  const warnings: string[] = [];
  if (!priv) warnings.push('No NIDA/licence on file');
  if (!r.full_address && !r.region) warnings.push('Address incomplete');

  return {
    ...r,
    currentMotorcycle: activeRow
      ? {
          assignmentId: activeRow.id,
          motorcycleId: activeRow.motorcycle_id,
          registration: activeRow.registration,
          startDate: activeRow.start_date,
        }
      : null,
    assignments: mapped,
    hasPrivateData: Boolean(priv),
    complianceWarnings: warnings,
  };
}
