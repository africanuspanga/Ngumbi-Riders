'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { dueTimestampUtc } from '@/lib/obligations/schedule';
import { localDateString } from '@/lib/dates/tz';
import { exemptionRequestSchema } from './validation';

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Rider requests an exemption for a specific obligation (spec §16.2). */
export async function createExemptionRequest(input: unknown): Promise<ActionResult<{ id: string }>> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'rider' || !profile.riderId) return { ok: false, error: 'forbidden' };
  const parsed = exemptionRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const supabase = await createServerSupabase();
  // RLS lets the rider read only their own obligations, so this both validates
  // ownership and existence.
  const { data: ob } = await supabase
    .from('payment_obligations')
    .select('id, status')
    .eq('id', parsed.data.obligationId)
    .maybeSingle();
  if (!ob) return { ok: false, error: 'invalid_obligation' };

  const { data, error } = await supabase
    .from('exemption_requests')
    .insert({
      rider_id: profile.riderId,
      obligation_id: parsed.data.obligationId,
      reason: parsed.data.reason,
      status: 'submitted',
    })
    .select('id')
    .single();
  if (error || !data) {
    // 23505 = the one-open-request-per-obligation unique index: the rider
    // already has a pending request for this day. Message it distinctly.
    if (error?.code === '23505') return { ok: false, error: 'already_requested' };
    return { ok: false, error: 'insert_failed' };
  }

  revalidatePath('/rider/exemptions');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

async function assertOwner() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

async function notifyExemptionDecision(exemptionId: string, title: string, body: string) {
  const admin = createAdminClient();
  const { data: ex } = await admin.from('exemption_requests').select('rider_id').eq('id', exemptionId).maybeSingle();
  const riderId = (ex as { rider_id: string } | null)?.rider_id;
  if (!riderId) return;
  const { data: rider } = await admin.from('riders').select('profile_id').eq('id', riderId).maybeSingle();
  const profileId = (rider as { profile_id: string } | null)?.profile_id;
  if (profileId) {
    await admin.from('notifications').insert({
      recipient_profile_id: profileId,
      type: 'exemption_decision',
      title,
      body,
      deep_link: '/rider/exemptions',
      dedupe_key: `exemption_decision:${exemptionId}`,
    });
  }
}

export async function setExemptionUnderReview(id: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();
  // Conditional update: never pull an already-decided request back into review.
  const { data, error } = await supabase
    .from('exemption_requests')
    .update({ status: 'under_review' })
    .eq('id', id)
    .eq('status', 'submitted')
    .select('id');
  if (error) return { ok: false, error: 'update_failed' };
  if (!data || data.length === 0) return { ok: false, error: 'invalid_status' };
  await writeAudit({ actorId: ownerId, actorRole: 'owner', action: 'exemption.under_review', entityType: 'exemption_request', entityId: id });
  revalidatePath('/owner/exemptions');
  return { ok: true };
}

export async function waiveExemption(id: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('apply_exemption_waiver', { p_exemption_id: id });
  if (error) return { ok: false, error: 'waiver_failed' };
  await notifyExemptionDecision(id, 'Ombi la msamaha', 'Ombi lako la msamaha limekubaliwa (limesamehewa).');
  await writeAudit({ actorId: ownerId, actorRole: 'owner', action: 'exemption.waived', entityType: 'exemption_request', entityId: id });
  revalidatePath('/owner/exemptions');
  return { ok: true };
}

export async function postponeExemption(id: string, newDate: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { ok: false, error: 'bad_date' };
  // A postponement moves the obligation FORWARD. A fat-fingered past date
  // would create a replacement obligation that the nightly job immediately
  // flips overdue — penalising the exact rider the waiver was meant to help.
  if (newDate <= localDateString()) return { ok: false, error: 'past_date' };
  const supabase = await createServerSupabase();

  // Look up the original obligation's local deadline to compute the new UTC due.
  const { data: ex } = await supabase.from('exemption_requests').select('obligation_id').eq('id', id).maybeSingle();
  const obligationId = (ex as { obligation_id: string } | null)?.obligation_id;
  if (!obligationId) return { ok: false, error: 'not_found' };
  const { data: ob } = await supabase.from('payment_obligations').select('local_due_time').eq('id', obligationId).maybeSingle();
  const localDueTime = String((ob as { local_due_time: string } | null)?.local_due_time ?? '18:00:00').slice(0, 5);
  const dueAt = dueTimestampUtc(newDate, localDueTime);

  const { error } = await supabase.rpc('apply_postponement', {
    p_exemption_id: id,
    p_new_date: newDate,
    p_due_at: dueAt,
    p_local_due_time: localDueTime,
  });
  if (error) {
    return { ok: false, error: /date_conflict/.test(error.message) ? 'date_conflict' : 'postpone_failed' };
  }
  await notifyExemptionDecision(id, 'Ombi la msamaha', `Ombi lako limeahirishwa hadi ${newDate}.`);
  await writeAudit({ actorId: ownerId, actorRole: 'owner', action: 'exemption.postponed', entityType: 'exemption_request', entityId: id, metadata: { newDate } });
  revalidatePath('/owner/exemptions');
  return { ok: true };
}

export async function rejectExemption(id: string, note?: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();
  // Conditional update: rejecting an already-waived/postponed request would
  // leave the request status contradicting the obligation's money history.
  const { data, error } = await supabase
    .from('exemption_requests')
    .update({ status: 'rejected', decision_note: note ?? null, decided_by: ownerId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['submitted', 'under_review'])
    .select('id');
  if (error) return { ok: false, error: 'update_failed' };
  if (!data || data.length === 0) return { ok: false, error: 'invalid_status' };
  await notifyExemptionDecision(id, 'Ombi la msamaha', 'Ombi lako la msamaha halikukubaliwa.');
  await writeAudit({ actorId: ownerId, actorRole: 'owner', action: 'exemption.rejected', entityType: 'exemption_request', entityId: id });
  revalidatePath('/owner/exemptions');
  return { ok: true };
}
