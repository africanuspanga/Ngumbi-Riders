'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';

/*
 * Motorcycle assignment lifecycle (spec §9.4). Invariants (one active
 * assignment per rider AND per motorcycle) are enforced by partial unique
 * indexes in the DB; these actions perform the ordered close→open so those
 * indexes are never violated. Exceptional transfers require a reason.
 *
 * NOTE: a SECURITY DEFINER `private.transfer_motorcycle` for full atomicity is a
 * tracked hardening follow-up (spec §22.3); at this fleet size the ordered
 * writes below are acceptable and audited.
 */

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function activeAssignmentForRider(riderId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('motorcycle_assignments')
    .select('id, motorcycle_id')
    .eq('rider_id', riderId)
    .eq('is_active', true)
    .maybeSingle();
  return data as { id: string; motorcycle_id: string } | null;
}

export async function assignMotorcycle(
  riderId: string,
  motorcycleId: string,
  startDate: string,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  if (await activeAssignmentForRider(riderId)) {
    return { ok: false, error: 'rider_already_assigned' };
  }
  const { data: moto } = await admin
    .from('motorcycles')
    .select('status')
    .eq('id', motorcycleId)
    .maybeSingle();
  if (!moto) return { ok: false, error: 'motorcycle_not_found' };
  if ((moto as { status: string }).status !== 'available') {
    return { ok: false, error: 'motorcycle_unavailable' };
  }

  const { error } = await admin.from('motorcycle_assignments').insert({
    motorcycle_id: motorcycleId,
    rider_id: riderId,
    is_active: true,
    start_date: startDate,
  });
  if (error) return { ok: false, error: 'assign_failed' };

  await admin.from('motorcycles').update({ status: 'assigned' }).eq('id', motorcycleId);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'assignment.created',
    entityType: 'rider',
    entityId: riderId,
    metadata: { motorcycleId, startDate },
  });
  revalidatePath(`/owner/riders/${riderId}`);
  revalidatePath(`/owner/motorcycles/${motorcycleId}`);
  return { ok: true };
}

/** Close the rider's current assignment and free its motorcycle. */
export async function releaseAssignment(
  riderId: string,
  endDate: string,
  reason?: string,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const current = await activeAssignmentForRider(riderId);
  if (!current) return { ok: false, error: 'no_active_assignment' };

  await admin
    .from('motorcycle_assignments')
    .update({ is_active: false, end_date: endDate, transfer_reason: reason ?? null })
    .eq('id', current.id);
  await admin
    .from('motorcycles')
    .update({ status: 'available' })
    .eq('id', current.motorcycle_id);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'assignment.released',
    entityType: 'rider',
    entityId: riderId,
    metadata: { motorcycleId: current.motorcycle_id, endDate, reason },
  });
  revalidatePath(`/owner/riders/${riderId}`);
  revalidatePath(`/owner/motorcycles/${current.motorcycle_id}`);
  return { ok: true };
}

/** Exceptional transfer: release current, then assign the new motorcycle. */
export async function transferMotorcycle(
  riderId: string,
  toMotorcycleId: string,
  reason: string,
  effectiveDate: string,
): Promise<ActionResult> {
  await assertOwner();
  if (!reason.trim()) return { ok: false, error: 'reason_required' };

  const released = await releaseAssignment(riderId, effectiveDate, reason);
  if (!released.ok) return released;

  return assignMotorcycle(riderId, toMotorcycleId, effectiveDate);
}
