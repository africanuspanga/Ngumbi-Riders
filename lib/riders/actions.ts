'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/auth/phone';
import { validatePin } from '@/lib/auth/pin';
import { createRiderUser } from '@/lib/auth/provision';
import { generateTempPin } from '@/lib/auth/temp-pin';
import { derivePassword } from '@/lib/auth/pin-derive';
import { encryptOptionalPII, decryptPII } from '@/lib/security/crypto';
import { writeAudit } from '@/lib/audit/audit';
import { localDateString } from '@/lib/dates/tz';
import { assignMotorcycle } from '@/lib/assignments/actions';
import { manualRiderSchema } from './validation';
import { formatRiderNumber, nextRiderSeq } from './numbering';
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
): Promise<ActionResult<{ riderId: string; riderNumber: string; warnings?: string[] }>> {
  const ownerId = await assertOwner();
  const parsed = manualRiderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const d = parsed.data;

  const canonicalPhone = normalizePhone(d.phone);
  const pinCheck = validatePin(d.tempPin, canonicalPhone);
  if (!pinCheck.ok) return { ok: false, error: 'weak_pin' };

  const admin = createAdminClient();

  let created;
  let riderNumber = '';
  try {
    let seq = await nextRiderSeq(admin);
    for (let attempt = 0; ; attempt++) {
      riderNumber = formatRiderNumber(seq);
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
        break;
      } catch (e) {
        // A rider_number clash is a concurrent allocation, not a rider
        // conflict — take the next number and retry. Everything else rethrows.
        if (/rider_number/i.test((e as Error).message) && attempt < 3) {
          seq++;
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    // 'duplicate' means THE PHONE is taken (auth user or riders.phone) — a
    // rider_number collision must not surface as "phone already exists".
    return {
      ok: false,
      error: /duplicate|already/i.test(msg) && !/rider_number/i.test(msg)
        ? 'duplicate'
        : 'create_failed',
    };
  }

  // Partial failures must SURFACE (same guard convertToRider has): the rider
  // login exists at this point, so silently dropping demographics / encrypted
  // PII / the assignment would read as success while the record is incomplete.
  const partialFailures: string[] = [];

  const { error: demoErr } = await admin
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
  if (demoErr) partialFailures.push('demographics');

  if (d.nidaNumber || d.drivingLicenceNumber) {
    const { error: piiErr } = await admin.from('rider_private_data').insert({
      rider_id: created.riderId,
      nida_number_encrypted: encryptOptionalPII(d.nidaNumber || null),
      driving_licence_encrypted: encryptOptionalPII(d.drivingLicenceNumber || null),
    });
    if (piiErr) partialFailures.push('identity documents');
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.created_manually',
    entityType: 'rider',
    entityId: created.riderId,
    metadata: { riderNumber, partialFailures },
  });

  // Optional immediate motorcycle assignment.
  if (d.motorcycleId) {
    const assignRes = await assignMotorcycle(
      created.riderId,
      d.motorcycleId,
      d.assignmentStartDate || localDateString(),
    );
    if (!assignRes.ok) partialFailures.push('motorcycle assignment');
  }

  revalidatePath('/owner/riders');
  // Rider + login WERE created even if a sub-write failed — succeed (so the
  // owner isn't tempted into a duplicate retry) but carry the warnings.
  return {
    ok: true,
    data: {
      riderId: created.riderId,
      riderNumber,
      warnings: partialFailures.length > 0 ? partialFailures : undefined,
    },
  };
}

/**
 * Owner-issued PIN reset (spec §7.3): generates a fresh CSPRNG temp PIN,
 * re-derives the auth password server-side (the raw PIN is never stored or
 * sent to Supabase), and forces a PIN change on the rider's next login. The
 * temp PIN is returned ONCE for the owner to hand to the rider.
 */
export async function resetRiderPin(
  id: string,
): Promise<ActionResult<{ tempPin: string }>> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const { data } = await admin
    .from('riders')
    .select('profile_id, phone')
    .eq('id', id)
    .maybeSingle();
  const rider = data as { profile_id: string; phone: string } | null;
  if (!rider) return { ok: false, error: 'not_found' };

  const tempPin = generateTempPin(rider.phone);
  const { error } = await admin.auth.admin.updateUserById(rider.profile_id, {
    password: derivePassword(rider.phone, tempPin),
  });
  if (error) return { ok: false, error: 'update_failed' };

  const { error: flagErr } = await admin
    .from('profiles')
    .update({ must_change_pin: true })
    .eq('id', rider.profile_id);
  if (flagErr) return { ok: false, error: 'update_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.pin_reset',
    entityType: 'rider',
    entityId: id,
  });
  revalidatePath(`/owner/riders/${id}`);
  return { ok: true, data: { tempPin } };
}

export async function setRiderStatus(
  id: string,
  status: RiderStatus,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();
  const { data: riderRow, error } = await admin
    .from('riders')
    .update({ status })
    .eq('id', id)
    .select('profile_id')
    .maybeSingle();
  if (error || !riderRow) return { ok: false, error: 'update_failed' };

  // Disabling must also revoke the LOGIN, not just flip a column: the login
  // route and rider layout check riders.status, and banning the auth user
  // additionally invalidates credential use at the auth layer (belt +
  // braces — the demo riders' PINs are public in the repo).
  const profileId = (riderRow as { profile_id: string }).profile_id;
  const active = status === 'active' || status === 'onboarding';
  const { error: banErr } = await admin.auth.admin.updateUserById(profileId, {
    ban_duration: active ? 'none' : '876000h', // ~100 years
  });
  if (banErr) {
    // The column changed but the auth ban didn't — surface it; the status
    // gates still hold, but the owner should retry.
    return { ok: false, error: 'auth_ban_failed' };
  }

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
): Promise<ActionResult<{ nida: string | null; licence: string | null; voterId: string | null; identityType: string | null }>> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();
  const { data } = await admin
    .from('rider_private_data')
    .select('nida_number_encrypted, driving_licence_encrypted, voter_id_encrypted, identity_type')
    .eq('rider_id', id)
    .maybeSingle();
  if (!data) return { ok: true, data: { nida: null, licence: null, voterId: null, identityType: null } };

  const row = data as {
    nida_number_encrypted: string | null;
    driving_licence_encrypted: string | null;
    voter_id_encrypted: string | null;
    identity_type: string | null;
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
      // A voter-ID rider's only identity document lives here — omitting it made
      // the owner reveal show "NIDA — / Licence —" forever after conversion.
      voterId: row.voter_id_encrypted ? decryptPII(row.voter_id_encrypted) : null,
      identityType: row.identity_type,
    },
  };
}
