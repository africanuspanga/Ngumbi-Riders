import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';

export type IncidentRow = {
  id: string;
  category: string;
  occurred_at: string;
  description: string;
  location_text: string | null;
  status: string;
  created_at: string;
  rider_name?: string;
};

/** Rider's own incidents (RLS scopes to the rider). */
export async function listRiderIncidents(): Promise<IncidentRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('incident_reports')
    .select('id, category, occurred_at, description, location_text, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as IncidentRow[];
}

/** Owner incident queue. */
export async function listOwnerIncidents(): Promise<IncidentRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('incident_reports')
    .select('id, category, occurred_at, description, location_text, status, created_at, riders(first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  type Raw = IncidentRow & { riders: { first_name: string; last_name: string } | null };
  return ((data ?? []) as unknown as Raw[]).map((i) => ({
    ...i,
    rider_name: i.riders ? `${i.riders.first_name} ${i.riders.last_name}` : '—',
  }));
}
