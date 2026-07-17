'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { motorcycleSchema, normalizeRegistration } from './validation';
import { buildMotorcycleCode } from './code';
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
  const region = parsed.data.region || null;
  const district = parsed.data.district || null;

  // Sequence within the same region+district bucket, so codes read
  // NGR-DSM-KIN-M-0001, -0002, … (build spec #7). count(*)+1 with retry on the
  // motorcycle_number unique constraint — the codebase's numbering convention.
  let seqQuery = admin.from('motorcycles').select('*', { count: 'exact', head: true });
  seqQuery = region ? seqQuery.eq('region', region) : seqQuery.is('region', null);
  seqQuery = district ? seqQuery.eq('district', district) : seqQuery.is('district', null);
  const { count: bucketCount } = await seqQuery;

  let id: string | null = null;
  let code = '';
  for (let attempt = 0; attempt < 5 && !id; attempt++) {
    code = buildMotorcycleCode({
      regionName: region,
      districtName: district,
      sequence: (bucketCount ?? 0) + 1 + attempt,
    });
    const { data, error } = await admin
      .from('motorcycles')
      .insert({
        motorcycle_number: code,
        registration_number: parsed.data.registrationNumber || null,
        chassis_number: parsed.data.chassisNumber,
        engine_number: parsed.data.engineNumber,
        colour: parsed.data.colour,
        make: parsed.data.make,
        model: parsed.data.model,
        region,
        district,
        status: 'available',
      })
      .select('id')
      .single();

    if (!error && data) {
      id = (data as { id: string }).id;
    } else if (error && /duplicate key/i.test(error.message)) {
      // A generated-code clash is retryable; a chassis/engine/registration
      // clash is a real duplicate the owner must resolve.
      if (/motorcycle_number/i.test(error.message)) continue;
      const field = /chassis/i.test(error.message)
        ? 'duplicate_chassis'
        : /engine/i.test(error.message)
          ? 'duplicate_engine'
          : /registration/i.test(error.message)
            ? 'duplicate_registration'
            : 'duplicate';
      return { ok: false, error: field };
    } else {
      return { ok: false, error: 'insert_failed' };
    }
  }
  if (!id) return { ok: false, error: 'insert_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'motorcycle.created',
    entityType: 'motorcycle',
    entityId: id,
    metadata: { code, registration: parsed.data.registrationNumber || null },
  });
  revalidatePath('/owner/motorcycles');
  // The contract builder lists AVAILABLE motorcycles; refresh it so a freshly
  // registered bike is immediately selectable there too.
  revalidatePath('/owner/contracts/new');
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
  // Availability changed → refresh the contract builder's motorcycle list.
  revalidatePath('/owner/contracts/new');
  return { ok: true };
}

/**
 * Set (or correct) a motorcycle's registration number after it is issued
 * (build spec #16 — registration arrives after purchase). Normalized + unique.
 */
export async function setMotorcycleRegistration(
  id: string,
  registration: string,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const value = registration.trim();
  if (!value) return { ok: false, error: 'required' };
  const normalized = normalizeRegistration(value);

  const admin = createAdminClient();
  const { error } = await admin
    .from('motorcycles')
    .update({ registration_number: normalized })
    .eq('id', id);
  if (error) {
    return { ok: false, error: /duplicate key/i.test(error.message) ? 'duplicate_registration' : 'update_failed' };
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'motorcycle.registration_set',
    entityType: 'motorcycle',
    entityId: id,
    metadata: { registration: normalized },
  });
  revalidatePath(`/owner/motorcycles/${id}`);
  revalidatePath('/owner/motorcycles');
  return { ok: true };
}
