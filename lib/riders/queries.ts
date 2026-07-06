import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import type { RiderStatus, RiskLevel } from '@/lib/supabase/types';

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
