'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { incidentSchema } from './validation';

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Rider reports an incident (spec §16.1). Inserted under the rider's own RLS. */
export async function createIncident(input: unknown): Promise<ActionResult<{ id: string }>> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'rider' || !profile.riderId) {
    return { ok: false, error: 'forbidden' };
  }
  const parsed = incidentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('incident_reports')
    .insert({
      rider_id: profile.riderId,
      category: parsed.data.category,
      occurred_at: new Date(parsed.data.occurredAt).toISOString(),
      description: parsed.data.description,
      location_text: parsed.data.locationText || null,
      status: 'open',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'insert_failed' };

  revalidatePath('/rider/incidents');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

const INCIDENT_STATUSES = new Set(['open', 'in_progress', 'resolved']);

/** Owner updates an incident's status. */
export async function updateIncidentStatus(id: string, status: string): Promise<ActionResult> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') return { ok: false, error: 'forbidden' };
  if (!INCIDENT_STATUSES.has(status)) return { ok: false, error: 'invalid_status' };
  const admin = createAdminClient();
  const { error } = await admin.from('incident_reports').update({ status }).eq('id', id);
  if (error) return { ok: false, error: 'update_failed' };
  await writeAudit({
    actorId: profile.userId,
    actorRole: 'owner',
    action: 'incident.status_changed',
    entityType: 'incident_report',
    entityId: id,
    metadata: { status },
  });
  revalidatePath('/owner/incidents');
  return { ok: true };
}
