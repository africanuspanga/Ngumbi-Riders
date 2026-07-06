'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { motorcycleSchema } from './validation';
import type { MotorcycleStatus } from '@/lib/supabase/types';

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function createMotorcycle(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ownerId = await assertOwner();
  const parsed = motorcycleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('motorcycles')
    .insert({
      motorcycle_number: parsed.data.motorcycleNumber,
      registration_number: parsed.data.registrationNumber,
      make: parsed.data.make || null,
      model: parsed.data.model || null,
      status: 'available',
    })
    .select('id')
    .single();

  if (error) {
    return {
      ok: false,
      error: /duplicate key/i.test(error.message) ? 'duplicate' : 'insert_failed',
    };
  }

  const id = (data as { id: string }).id;
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'motorcycle.created',
    entityType: 'motorcycle',
    entityId: id,
    metadata: { registration: parsed.data.registrationNumber },
  });
  revalidatePath('/owner/motorcycles');
  return { ok: true, data: { id } };
}

// Owner may deactivate/reactivate an UNASSIGNED motorcycle. 'assigned' is
// derived from assignments and cannot be set directly here.
export async function setMotorcycleStatus(
  id: string,
  status: 'available' | 'inactive',
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const { data: current } = await admin
    .from('motorcycles')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  const cur = (current as { status: MotorcycleStatus } | null)?.status;
  if (cur === 'assigned') return { ok: false, error: 'currently_assigned' };

  const { error } = await admin
    .from('motorcycles')
    .update({ status })
    .eq('id', id);
  if (error) return { ok: false, error: 'update_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'motorcycle.status_changed',
    entityType: 'motorcycle',
    entityId: id,
    metadata: { to: status },
  });
  revalidatePath(`/owner/motorcycles/${id}`);
  revalidatePath('/owner/motorcycles');
  return { ok: true };
}
