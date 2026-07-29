import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import { deriveContractDisplayStatus, type ContractDisplayStatus } from '@/lib/contracts/status';
import { formatDuration, normalizeDuration } from '@/lib/contracts/duration';
import { signedStorageUrl } from './queries';
import type { ContractStatus, RiderStatus, RiskLevel, ScheduleType } from '@/lib/supabase/types';

/*
 * The complete rider profile (build spec #3) — one shape rendered for three
 * audiences: the owner, the accountant and the rider themselves.
 *
 * Sensitive identifiers are NEVER decrypted here. The profile reports only the
 * identity TYPE and whether a number is on file; the owner reveals the actual
 * number through the existing deliberate + audited reveal action. That keeps
 * this query safe to call from the accountant's and the rider's own page.
 */

export type ProfileAudience = 'owner' | 'accountant' | 'rider';

export type RiderProfileContract = {
  id: string;
  number: string;
  status: ContractStatus;
  displayStatus: ContractDisplayStatus;
  startDate: string | null;
  endDate: string | null;
  durationLabel: string;
  scheduleType: ScheduleType;
  instalmentAmount: number;
  dueDayOfMonth: number | null;
};

export type RiderProfile = {
  id: string;
  riderNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  photoUrl: string | null;
  photoPath: string | null;
  status: RiderStatus;
  riskLevel: RiskLevel;
  riskReasons: string[];
  registeredAt: string;

  // Location (#7): the rider's PERSONAL address, plus the OPERATIONAL area of
  // the motorcycle they ride, kept visibly distinct.
  region: string | null;
  district: string | null;
  ward: string | null;
  street: string | null;
  fullAddress: string | null;
  locationSource: 'manual' | 'motorcycle';

  // Identification — type and presence only; never the number itself.
  identityType: 'nida' | 'driving_licence' | 'voter_id' | null;
  hasIdentityNumber: boolean;

  motorcycle: {
    id: string;
    code: string;
    registration: string | null;
    make: string | null;
    model: string | null;
    colour: string | null;
    region: string | null;
    district: string | null;
    assignedSince: string;
  } | null;

  contract: RiderProfileContract | null;

  payment: {
    totalContractValue: number;
    amountPaid: number;
    amountOutstanding: number;
    outstandingCount: number;
    overdueCount: number;
    paidCount: number;
    totalCount: number;
    nextPaymentDate: string | null;
    nextPaymentAmount: number | null;
  };

  guarantors: {
    id: string;
    fullName: string;
    phone: string;
    relationship: string | null;
    occupation: string | null;
    address: string | null;
  }[];

  documents: { id: string; docType: string; url: string | null }[];
};

const IDENTITY_LABELS: Record<string, string> = {
  nida: 'National ID (NIDA)',
  driving_licence: 'Driving Licence',
  voter_id: "Voter's ID",
};

export function identityTypeLabel(type: string | null | undefined): string {
  return type ? (IDENTITY_LABELS[type] ?? type) : '—';
}

/**
 * Load a rider's full profile. Uses the service-role client because it stitches
 * together tables with different RLS shapes (guarantors and documents are
 * owner-only at the row level) — so the CALLER must authorise first:
 *   • owner       → requireOwner()
 *   • accountant  → requireAccountant()
 *   • rider       → requireRider() AND riderId === session.riderId
 * `audience` then decides what is returned, so a rider never receives the
 * owner-only fields even though the query could read them.
 */
export async function getRiderProfile(
  riderId: string,
  audience: ProfileAudience,
): Promise<RiderProfile | null> {
  const admin = createAdminClient();
  const today = localDateString();

  const { data: riderRow, error } = await admin
    .from('riders')
    .select(
      'id, rider_number, first_name, middle_name, last_name, phone, email, date_of_birth, gender, region, district, ward, street, full_address, status, risk_level, risk_reasons, photo_path, location_source, created_at',
    )
    .eq('id', riderId)
    .maybeSingle();
  if (error || !riderRow) return null;

  const r = riderRow as unknown as {
    id: string;
    rider_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    phone: string;
    email: string | null;
    date_of_birth: string | null;
    gender: string | null;
    region: string | null;
    district: string | null;
    ward: string | null;
    street: string | null;
    full_address: string | null;
    status: RiderStatus;
    risk_level: RiskLevel;
    risk_reasons: string[] | null;
    photo_path: string | null;
    location_source: 'manual' | 'motorcycle';
    created_at: string;
  };

  const [assignmentRes, contractRes, privateRes, guarantorRes, documentRes, photoUrl] =
    await Promise.all([
      admin
        .from('motorcycle_assignments')
        .select(
          'start_date, motorcycle_id, motorcycles(motorcycle_number, registration_number, make, model, colour, region, district)',
        )
        .eq('rider_id', riderId)
        .eq('is_active', true)
        .maybeSingle(),
      admin
        .from('contracts')
        .select(
          'id, contract_number, status, start_date, end_date, duration_years, duration_months, duration_weeks, duration_days, schedule_type, installment_amount, due_day_of_month, created_at',
        )
        .eq('rider_id', riderId)
        .order('created_at', { ascending: false })
        .limit(10),
      admin
        .from('rider_private_data')
        .select('identity_type, nida_number_encrypted, driving_licence_encrypted, voter_id_encrypted')
        .eq('rider_id', riderId)
        .maybeSingle(),
      audience === 'rider'
        ? Promise.resolve({ data: [] })
        : admin
            .from('guarantors')
            .select('id, full_name, phone, relationship, occupation, residential_address')
            .eq('rider_id', riderId),
      admin
        .from('rider_documents')
        .select('id, doc_type, storage_path, rider_viewable')
        .eq('rider_id', riderId),
      signedStorageUrl('rider-documents', r.photo_path),
    ]);

  // Obligations drive every money figure; paginated because one rider's daily
  // calendar can exceed the 1000-row PostgREST cap on its own (D-033).
  const obligations = await fetchAllPages<{ due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('due_date, amount_due, status')
        .eq('rider_id', riderId)
        .order('due_date', { ascending: true })
        .range(from, to),
    { label: `rider profile obligations ${riderId}` },
  );

  const OUTSTANDING = new Set(['scheduled', 'due', 'overdue']);
  const SETTLED = new Set(['paid', 'paid_in_advance']);
  let amountPaid = 0;
  let amountOutstanding = 0;
  let outstandingCount = 0;
  let overdueCount = 0;
  let paidCount = 0;
  let nextPaymentDate: string | null = null;
  let nextPaymentAmount: number | null = null;
  for (const o of obligations) {
    if (SETTLED.has(o.status)) {
      amountPaid += o.amount_due;
      paidCount++;
    } else if (OUTSTANDING.has(o.status)) {
      amountOutstanding += o.amount_due;
      outstandingCount++;
      if (o.status === 'overdue' || o.due_date < today) overdueCount++;
      if (o.due_date >= today && (nextPaymentDate === null || o.due_date < nextPaymentDate)) {
        nextPaymentDate = o.due_date;
        nextPaymentAmount = o.amount_due;
      }
    }
  }

  // Most relevant contract: a live one, else the most recent.
  const LIVE = new Set<ContractStatus>(['active', 'paused', 'scheduled', 'draft', 'awaiting_signatures']);
  type CRow = {
    id: string;
    contract_number: string;
    status: ContractStatus;
    start_date: string | null;
    end_date: string | null;
    duration_years: number | null;
    duration_months: number | null;
    duration_weeks: number | null;
    duration_days: number | null;
    schedule_type: ScheduleType;
    installment_amount: number;
    due_day_of_month: number | null;
  };
  const contractRows = ((contractRes as { data: unknown }).data ?? []) as CRow[];
  const contractRow = contractRows.find((c) => LIVE.has(c.status)) ?? contractRows[0] ?? null;

  const assignment = (assignmentRes as { data: unknown }).data as {
    start_date: string;
    motorcycle_id: string;
    motorcycles: {
      motorcycle_number: string;
      registration_number: string | null;
      make: string | null;
      model: string | null;
      colour: string | null;
      region: string | null;
      district: string | null;
    } | null;
  } | null;

  const priv = (privateRes as { data: unknown }).data as {
    identity_type: 'nida' | 'driving_licence' | 'voter_id' | null;
    nida_number_encrypted: string | null;
    driving_licence_encrypted: string | null;
    voter_id_encrypted: string | null;
  } | null;

  const guarantorRows = ((guarantorRes as { data: unknown }).data ?? []) as {
    id: string;
    full_name: string;
    phone: string;
    relationship: string | null;
    occupation: string | null;
    residential_address: string | null;
  }[];

  const docRows = ((documentRes as { data: unknown }).data ?? []) as {
    id: string;
    doc_type: string;
    storage_path: string;
    rider_viewable: boolean;
  }[];
  // A rider sees only the documents flagged viewable for them.
  const visibleDocs = audience === 'rider' ? docRows.filter((d) => d.rider_viewable) : docRows;
  const documents = await Promise.all(
    visibleDocs.map(async (d) => ({
      id: d.id,
      docType: d.doc_type,
      url: await signedStorageUrl('rider-documents', d.storage_path),
    })),
  );

  const duration = normalizeDuration({
    years: contractRow?.duration_years ?? 0,
    months: contractRow?.duration_months ?? 0,
    weeks: contractRow?.duration_weeks ?? 0,
    days: contractRow?.duration_days ?? 0,
  });

  return {
    id: r.id,
    riderNumber: r.rider_number,
    firstName: r.first_name,
    middleName: r.middle_name,
    lastName: r.last_name,
    fullName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' '),
    phone: r.phone,
    email: r.email,
    dateOfBirth: r.date_of_birth,
    gender: r.gender,
    photoUrl,
    photoPath: r.photo_path,
    status: r.status,
    riskLevel: r.risk_level,
    riskReasons: Array.isArray(r.risk_reasons) ? r.risk_reasons : [],
    registeredAt: r.created_at,

    region: r.region,
    district: r.district,
    ward: r.ward,
    street: r.street,
    fullAddress: r.full_address,
    locationSource: r.location_source ?? 'manual',

    identityType: priv?.identity_type ?? null,
    hasIdentityNumber: Boolean(
      priv?.nida_number_encrypted || priv?.driving_licence_encrypted || priv?.voter_id_encrypted,
    ),

    motorcycle: assignment?.motorcycles
      ? {
          id: assignment.motorcycle_id,
          code: assignment.motorcycles.motorcycle_number,
          registration: assignment.motorcycles.registration_number,
          make: assignment.motorcycles.make,
          model: assignment.motorcycles.model,
          colour: assignment.motorcycles.colour,
          region: assignment.motorcycles.region,
          district: assignment.motorcycles.district,
          assignedSince: assignment.start_date,
        }
      : null,

    contract: contractRow
      ? {
          id: contractRow.id,
          number: contractRow.contract_number,
          status: contractRow.status,
          displayStatus: deriveContractDisplayStatus({
            status: contractRow.status,
            startDate: contractRow.start_date,
            endDate: contractRow.end_date,
            outstandingCount,
            today,
          }),
          startDate: contractRow.start_date,
          endDate: contractRow.end_date,
          durationLabel: formatDuration(duration),
          scheduleType: contractRow.schedule_type,
          instalmentAmount: contractRow.installment_amount,
          dueDayOfMonth: contractRow.due_day_of_month,
        }
      : null,

    payment: {
      totalContractValue: obligations.reduce(
        (s, o) => (o.status === 'cancelled' ? s : s + o.amount_due),
        0,
      ),
      amountPaid,
      amountOutstanding,
      outstandingCount,
      overdueCount,
      paidCount,
      totalCount: obligations.length,
      nextPaymentDate,
      nextPaymentAmount,
    },

    guarantors: guarantorRows.map((g) => ({
      id: g.id,
      fullName: g.full_name,
      phone: g.phone,
      relationship: g.relationship,
      occupation: g.occupation,
      address: g.residential_address,
    })),

    documents,
  };
}
