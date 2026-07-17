'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptPII } from '@/lib/security/crypto';
import { canTransition } from './status';
import { createRiderUser } from '@/lib/auth/provision';
import { generateTempPin } from '@/lib/auth/temp-pin';
import { writeAudit } from '@/lib/audit/audit';
import type { ApplicationStatus } from '@/lib/supabase/types';

/*
 * Owner-only server actions for the application review pipeline (spec §8.5,
 * §8.6). Every action re-checks the owner role (defense in depth on top of RLS)
 * and audits money/identity-affecting changes.
 */

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') {
    throw new Error('forbidden');
  }
  return profile.userId;
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Move an application to a new status if the transition is legal. */
export async function setApplicationStatus(
  id: string,
  to: ApplicationStatus,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();

  const { data: current } = await supabase
    .from('rider_applications')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (!current) return { ok: false, error: 'not_found' };

  const from = (current as { status: ApplicationStatus }).status;
  if (!canTransition(from, to)) return { ok: false, error: 'illegal_transition' };

  const { error } = await supabase
    .from('rider_applications')
    .update({ status: to })
    .eq('id', id);
  if (error) return { ok: false, error: 'update_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'application.status_changed',
    entityType: 'rider_application',
    entityId: id,
    metadata: { from, to },
  });

  revalidatePath(`/owner/applications/${id}`);
  revalidatePath('/owner/applications');
  return { ok: true };
}

/** Deliberately decrypt and reveal NIDA + licence + voter ID for owner (§25.1). */
export async function revealApplicationSecrets(
  id: string,
): Promise<ActionResult<{ nida: string | null; licence: string | null; voterId: string | null }>> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from('rider_applications')
    .select('nida_number_encrypted, driving_licence_encrypted, voter_id_encrypted')
    .eq('id', id)
    .maybeSingle();
  if (!data) return { ok: false, error: 'not_found' };

  const row = data as {
    nida_number_encrypted: string | null;
    driving_licence_encrypted: string | null;
    voter_id_encrypted: string | null;
  };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'application.secrets_revealed',
    entityType: 'rider_application',
    entityId: id,
  });

  return {
    ok: true,
    data: {
      nida: row.nida_number_encrypted ? decryptPII(row.nida_number_encrypted) : null,
      licence: row.driving_licence_encrypted
        ? decryptPII(row.driving_licence_encrypted)
        : null,
      voterId: row.voter_id_encrypted ? decryptPII(row.voter_id_encrypted) : null,
    },
  };
}

/** Short-lived signed URL for a private document (§24). */
export async function getSignedDocumentUrl(
  bucket: string,
  path: string,
): Promise<ActionResult<{ url: string }>> {
  await assertOwner();
  const allowed = ['application-documents', 'guarantor-documents'];
  if (!allowed.includes(bucket)) return { ok: false, error: 'forbidden_bucket' };

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 60); // 60 seconds
  if (error || !data) return { ok: false, error: 'sign_failed' };
  return { ok: true, data: { url: data.signedUrl } };
}

/**
 * Convert an approved application into a rider without retyping data (§8.6).
 * Creates the auth user with a temporary PIN, copies profile + encrypted PII,
 * links the application and returns the one-time temporary PIN.
 */
export async function convertToRider(
  id: string,
): Promise<ActionResult<{ riderId: string; riderNumber: string; tempPin: string }>> {
  const ownerId = await assertOwner();
  const supabase = await createServerSupabase();

  const { data: app } = await supabase
    .from('rider_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!app) return { ok: false, error: 'not_found' };

  const a = app as Record<string, string | null> & { status: ApplicationStatus };
  if (!canTransition(a.status, 'converted_to_rider')) {
    return { ok: false, error: 'not_approved' };
  }
  if (!a.primary_phone) return { ok: false, error: 'missing_phone' };

  const admin = createAdminClient();

  // Allocate the next rider number (race-tolerant; unique constraint guards).
  const { count } = await admin
    .from('riders')
    .select('*', { count: 'exact', head: true });
  const riderNumber = `NGR-R-${String((count ?? 0) + 1).padStart(4, '0')}`;
  const tempPin = generateTempPin(a.primary_phone);

  let created;
  try {
    created = await createRiderUser({
      phone: a.primary_phone,
      pin: tempPin,
      riderNumber,
      firstName: a.first_name ?? '',
      middleName: a.middle_name ?? undefined,
      lastName: a.last_name ?? '',
      mustChangePin: true,
    });
  } catch {
    return { ok: false, error: 'create_rider_failed' };
  }

  // Copy address/profile fields and the encrypted identifiers onto the rider.
  // These are identity data — a silent partial copy would lose the rider's
  // NIDA/licence while the application still reads "converted".
  const { error: copyErr } = await admin
    .from('riders')
    .update({
      email: a.email,
      date_of_birth: a.date_of_birth,
      gender: a.gender,
      region: a.region,
      district: a.district,
      ward: a.ward,
      street: a.street,
      full_address: a.full_address,
    })
    .eq('id', created.riderId);

  const { error: piiErr } = await admin.from('rider_private_data').insert({
    rider_id: created.riderId,
    identity_type: (a.identity_type as 'nida' | 'driving_licence' | 'voter_id' | null) ?? null,
    nida_number_encrypted: a.nida_number_encrypted,
    driving_licence_encrypted: a.driving_licence_encrypted,
    voter_id_encrypted: a.voter_id_encrypted,
  });

  if (copyErr || piiErr) {
    await writeAudit({
      actorId: ownerId,
      actorRole: 'owner',
      action: 'application.convert_copy_failed',
      entityType: 'rider_application',
      entityId: id,
      metadata: {
        riderId: created.riderId,
        profileCopyError: copyErr?.message ?? null,
        piiCopyError: piiErr?.message ?? null,
      },
    });
    // The auth user + rider row exist, but the application is NOT marked
    // converted — surface the failure so the owner resolves it instead of
    // silently losing the identity data.
    return { ok: false, error: 'copy_failed' };
  }

  await supabase
    .from('rider_applications')
    .update({ status: 'converted_to_rider', converted_rider_id: created.riderId })
    .eq('id', id);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'application.converted_to_rider',
    entityType: 'rider_application',
    entityId: id,
    metadata: { riderId: created.riderId, riderNumber },
  });

  revalidatePath(`/owner/applications/${id}`);
  revalidatePath('/owner/applications');
  return { ok: true, data: { riderId: created.riderId, riderNumber, tempPin } };
}
