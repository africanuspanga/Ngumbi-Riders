'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/auth/phone';
import { validatePin } from '@/lib/auth/pin';
import { createRiderUser } from '@/lib/auth/provision';
import { encryptOptionalPII, decryptPII } from '@/lib/security/crypto';
import { writeAudit } from '@/lib/audit/audit';
import { localDateString } from '@/lib/dates/tz';
import { assignMotorcycle } from '@/lib/assignments/actions';
import { manualRiderSchema } from './validation';
import type { RiderStatus } from '@/lib/supabase/types';

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function createRiderManually(
  input: unknown,
): Promise<ActionResult<{ riderId: string; riderNumber: string }>> {
  const ownerId = await assertOwner();
  const parsed = manualRiderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const d = parsed.data;

  const canonicalPhone = normalizePhone(d.phone);
  const pinCheck = validatePin(d.tempPin, canonicalPhone);
  if (!pinCheck.ok) return { ok: false, error: 'weak_pin' };

  const admin = createAdminClient();
  const { count } = await admin
    .from('riders')
    .select('*', { count: 'exact', head: true });
  const riderNumber = `NGR-R-${String((count ?? 0) + 1).padStart(4, '0')}`;

  let created;
  try {
    created = await createRiderUser({
      phone: canonicalPhone,
      pin: d.tempPin,
      riderNumber,
      firstName: d.firstName,
      middleName: d.middleName || undefined,
      lastName: d.lastName,
      mustChangePin: true,
    });
  } catch (e) {
    return {
      ok: false,
      error: /duplicate|already/i.test((e as Error).message) ? 'duplicate' : 'create_failed',
    };
  }

  await admin
    .from('riders')
    .update({
      email: d.email || null,
      date_of_birth: d.dateOfBirth || null,
      gender: d.gender || null,
      region: d.region || null,
      district: d.district || null,
      ward: d.ward || null,
      street: d.street || null,
      full_address: d.fullAddress || null,
    })
    .eq('id', created.riderId);

  if (d.nidaNumber || d.drivingLicenceNumber) {
    await admin.from('rider_private_data').insert({
      rider_id: created.riderId,
      nida_number_encrypted: encryptOptionalPII(d.nidaNumber || null),
      driving_licence_encrypted: encryptOptionalPII(d.drivingLicenceNumber || null),
    });
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.created_manually',
    entityType: 'rider',
    entityId: created.riderId,
    metadata: { riderNumber },
  });

  // Optional immediate motorcycle assignment.
  if (d.motorcycleId) {
    await assignMotorcycle(
      created.riderId,
      d.motorcycleId,
      d.assignmentStartDate || localDateString(),
    );
  }

  revalidatePath('/owner/riders');
  return { ok: true, data: { riderId: created.riderId, riderNumber } };
}

export async function setRiderStatus(
  id: string,
  status: RiderStatus,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();
  const { error } = await admin.from('riders').update({ status }).eq('id', id);
  if (error) return { ok: false, error: 'update_failed' };
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.status_changed',
    entityType: 'rider',
    entityId: id,
    metadata: { to: status },
  });
  revalidatePath(`/owner/riders/${id}`);
  revalidatePath('/owner/riders');
  return { ok: true };
}

export async function revealRiderSecrets(
  id: string,
): Promise<ActionResult<{ nida: string | null; licence: string | null }>> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();
  const { data } = await admin
    .from('rider_private_data')
    .select('nida_number_encrypted, driving_licence_encrypted')
    .eq('rider_id', id)
    .maybeSingle();
  if (!data) return { ok: true, data: { nida: null, licence: null } };

  const row = data as {
    nida_number_encrypted: string | null;
    driving_licence_encrypted: string | null;
  };
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.secrets_revealed',
    entityType: 'rider',
    entityId: id,
  });
  return {
    ok: true,
    data: {
      nida: row.nida_number_encrypted ? decryptPII(row.nida_number_encrypted) : null,
      licence: row.driving_licence_encrypted
        ? decryptPII(row.driving_licence_encrypted)
        : null,
    },
  };
}
