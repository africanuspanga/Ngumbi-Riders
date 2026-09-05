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
import { manualRiderSchemaWithGeo, editRiderSchema } from './validation';
import { canonicalDistrictName, canonicalRegionName } from '@/lib/geo/tanzania';
import { formatRiderNumber, nextRiderSeq } from './numbering';
import type { RiderStatus } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  // Re-validated server-side, including the region/district pairing (#6/#7) —
  // the dropdown constrains the choice but never enforces it.
  const parsed = manualRiderSchemaWithGeo.safeParse(input);
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
      // Canonical spelling so the same place always filters as one value.
      region: canonicalRegionName(d.region || null),
      district: canonicalDistrictName(d.region || null, d.district || null),
      // Records whether this location came from the assigned motorcycle (#7).
      location_source: d.locationSource === 'motorcycle' ? 'motorcycle' : 'manual',
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

/**
 * Edit an existing rider (client request 2026-09-05).
 *
 * The subtle part is the PHONE. The Supabase password is
 * `HMAC(pepper, canonical_phone + ':' + pin)`, so the phone is part of the
 * credential — change it and the rider's existing PIN silently derives a
 * different password and they can never log in again. The raw PIN is not
 * recoverable (by design), so it cannot simply be re-derived against the new
 * number. Therefore a phone change ALWAYS issues a fresh temporary PIN and
 * forces a change on next login, and the new PIN is returned once for the
 * owner to hand over. Everything else is an ordinary field update.
 */
export async function updateRider(
  id: string,
  input: unknown,
): Promise<ActionResult<{ phoneChanged: boolean; tempPin?: string; warnings?: string[] }>> {
  const ownerId = await assertOwner();
  const parsed = editRiderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const d = parsed.data;

  const admin = createAdminClient();
  const { data: existingRow } = await admin
    .from('riders')
    .select('id, profile_id, phone, rider_number')
    .eq('id', id)
    .maybeSingle();
  const existing = existingRow as
    | { id: string; profile_id: string; phone: string; rider_number: string }
    | null;
  if (!existing) return { ok: false, error: 'not_found' };

  const canonicalPhone = normalizePhone(d.phone);
  const phoneChanged = canonicalPhone !== existing.phone;

  // A phone already used by ANOTHER rider would break login for both.
  if (phoneChanged) {
    const { data: clash } = await admin
      .from('riders')
      .select('id')
      .eq('phone', canonicalPhone)
      .neq('id', id)
      .maybeSingle();
    if (clash) return { ok: false, error: 'duplicate_phone' };
  }

  const warnings: string[] = [];

  const { error: updErr } = await admin
    .from('riders')
    .update({
      first_name: d.firstName,
      middle_name: d.middleName || null,
      last_name: d.lastName,
      phone: canonicalPhone,
      email: d.email || null,
      date_of_birth: d.dateOfBirth || null,
      gender: d.gender || null,
      region: canonicalRegionName(d.region || null),
      district: canonicalDistrictName(d.region || null, d.district || null),
      // A hand edit is always 'manual' provenance: the owner has now stated
      // this location explicitly, so motorcycle inheritance must stop
      // overwriting it (#7, D-034).
      location_source: 'manual',
      ward: d.ward || null,
      street: d.street || null,
      full_address: d.fullAddress || null,
    })
    .eq('id', id);
  if (updErr) return { ok: false, error: 'update_failed' };

  // Keep the auth user's display name in step with the rider record.
  const fullName = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ');
  const { error: nameErr } = await admin
    .from('profiles')
    .update({ full_name: fullName })
    .eq('id', existing.profile_id);
  if (nameErr) warnings.push('profile name');

  // Identity documents are encrypted at rest; upsert so a rider who had none
  // can gain them and one who had them can have them corrected.
  // Only the fields the owner actually filled in are written. Sending both
  // every time would let a blank licence box silently erase a licence that is
  // on file — the form cannot pre-fill them, because reading them back is a
  // deliberate, audited reveal, not a page load.
  const pii: Record<string, string | null> = {};
  if (d.nidaNumber) pii.nida_number_encrypted = encryptOptionalPII(d.nidaNumber);
  if (d.drivingLicenceNumber) {
    pii.driving_licence_encrypted = encryptOptionalPII(d.drivingLicenceNumber);
  }
  if (Object.keys(pii).length > 0) {
    const { error: piiErr } = await admin
      .from('rider_private_data')
      .upsert({ rider_id: id, ...pii }, { onConflict: 'rider_id' });
    if (piiErr) warnings.push('identity documents');
  }

  let tempPin: string | undefined;
  if (phoneChanged) {
    tempPin = generateTempPin(canonicalPhone);
    const { error: authErr } = await admin.auth.admin.updateUserById(existing.profile_id, {
      phone: canonicalPhone,
      phone_confirm: true,
      password: derivePassword(canonicalPhone, tempPin),
    });
    if (authErr) {
      // The rider row now says one number and the login still answers to the
      // old one. Put the row back rather than leave the two disagreeing.
      await admin.from('riders').update({ phone: existing.phone }).eq('id', id);
      return { ok: false, error: 'auth_phone_failed' };
    }
    const { error: flagErr } = await admin
      .from('profiles')
      .update({ must_change_pin: true })
      .eq('id', existing.profile_id);
    if (flagErr) warnings.push('forced PIN change flag');

    await writeAudit({
      actorId: ownerId,
      actorRole: 'owner',
      action: 'rider.phone_changed',
      entityType: 'rider',
      entityId: id,
      metadata: { from: existing.phone, to: canonicalPhone },
    });
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.updated',
    entityType: 'rider',
    entityId: id,
    metadata: { riderNumber: existing.rider_number, phoneChanged, warnings },
  });

  revalidatePath('/owner/riders');
  revalidatePath(`/owner/riders/${id}`);
  revalidatePath(`/accountant/riders/${id}`);
  return {
    ok: true,
    data: { phoneChanged, tempPin, warnings: warnings.length > 0 ? warnings : undefined },
  };
}

/**
 * What deleting a rider would destroy. The owner sees this BEFORE confirming,
 * because "delete driver" reads like removing a name from a list and is in
 * fact removing a contract history.
 */
export async function riderDeletionImpact(id: string): Promise<
  ActionResult<{
    riderNumber: string;
    name: string;
    contracts: number;
    obligations: number;
    payments: number;
    settledPayments: number;
    receipts: number;
    assignments: number;
    blocked: boolean;
  }>
> {
  await assertOwner();
  const admin = createAdminClient();

  const { data: riderRow } = await admin
    .from('riders')
    .select('id, rider_number, first_name, last_name')
    .eq('id', id)
    .maybeSingle();
  const rider = riderRow as
    | { id: string; rider_number: string; first_name: string; last_name: string }
    | null;
  if (!rider) return { ok: false, error: 'not_found' };

  const countOf = async (table: string, column: string, value: string) => {
    const { count } = await (admin as unknown as SupabaseClient)
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(column, value);
    return count ?? 0;
  };

  const [contracts, obligations, payments, assignments] = await Promise.all([
    countOf('contracts', 'rider_id', id),
    countOf('payment_obligations', 'rider_id', id),
    countOf('payments', 'rider_id', id),
    countOf('motorcycle_assignments', 'rider_id', id),
  ]);

  // Settled money is the thing that must never be deleted (spec rule 6).
  const { data: settledRows } = await admin
    .from('payments')
    .select('id')
    .eq('rider_id', id)
    .eq('status', 'completed');
  const settled = ((settledRows ?? []) as { id: string }[]).map((p) => p.id);
  let receipts = 0;
  if (settled.length > 0) {
    const { count } = await admin
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .in('payment_id', settled);
    receipts = count ?? 0;
  }

  return {
    ok: true,
    data: {
      riderNumber: rider.rider_number,
      name: `${rider.first_name} ${rider.last_name}`,
      contracts,
      obligations,
      payments,
      settledPayments: settled.length,
      receipts,
      assignments,
      blocked: settled.length > 0 || receipts > 0,
    },
  };
}

/**
 * Permanently delete a rider and everything hanging off them (client request
 * 2026-09-05).
 *
 * REFUSED when the rider has any COMPLETED payment or receipt. Those are the
 * business's financial records, and rule 6 says financial records are
 * corrected by reversal events, never deleted — erasing them would silently
 * change historical collection totals and leave receipts issued to a rider
 * who no longer exists. The UI offers deactivation instead, which revokes the
 * login and keeps the books intact.
 *
 * Deletion order mirrors scripts/demo-cleanup.ts: money children before money,
 * contract children before contracts, then fleet links, then the rider, the
 * profile and finally the auth user. `on delete restrict` on the financial
 * tables (0023) means a wrong order fails loudly rather than cascading.
 */
export async function deleteRider(id: string): Promise<ActionResult<{ riderNumber: string }>> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  const impact = await riderDeletionImpact(id);
  if (!impact.ok) return impact;
  if (impact.data!.blocked) return { ok: false, error: 'has_financial_records' };

  const { data: riderRow } = await admin
    .from('riders')
    .select('id, profile_id, phone, rider_number')
    .eq('id', id)
    .maybeSingle();
  const rider = riderRow as
    | { id: string; profile_id: string; phone: string; rider_number: string }
    | null;
  if (!rider) return { ok: false, error: 'not_found' };

  const { data: contractRows } = await admin.from('contracts').select('id').eq('rider_id', id);
  const contractIds = ((contractRows ?? []) as { id: string }[]).map((c) => c.id);
  const { data: paymentRows } = await admin.from('payments').select('id').eq('rider_id', id);
  const paymentIds = ((paymentRows ?? []) as { id: string }[]).map((p) => p.id);

  const db = admin as unknown as SupabaseClient;
  const failures: string[] = [];
  const del = async (table: string, column: string, values: string[]) => {
    if (values.length === 0) return;
    const { error } = await db.from(table).delete().in(column, values);
    if (error) failures.push(`${table}: ${error.message}`);
  };

  await del('receipts', 'payment_id', paymentIds);
  await del('payment_allocations', 'payment_id', paymentIds);
  await del('payment_events', 'payment_id', paymentIds);
  await del('payment_reservations', 'payment_id', paymentIds);
  await del('payments', 'id', paymentIds);
  await del('payment_obligations', 'rider_id', [id]);
  await del('exemption_requests', 'rider_id', [id]);
  await del('cash_payment_requests', 'rider_id', [id]);
  await del('contract_documents', 'contract_id', contractIds);
  await del('contract_signatures', 'contract_id', contractIds);
  await del('contract_versions', 'contract_id', contractIds);
  await del('contract_events', 'contract_id', contractIds);
  await del('phone_loans', 'rider_id', [id]);
  await del('contracts', 'id', contractIds);
  await del('motorcycle_assignments', 'rider_id', [id]);
  await del('incident_reports', 'rider_id', [id]);
  await del('risk_snapshots', 'rider_id', [id]);
  await del('rider_documents', 'rider_id', [id]);
  await del('rider_private_data', 'rider_id', [id]);
  await del('notifications', 'recipient_profile_id', [rider.profile_id]);
  await del('push_subscriptions', 'profile_id', [rider.profile_id]);

  // Stop here if a child delete failed: removing the rider now would strand
  // those rows pointing at a rider that no longer exists.
  if (failures.length > 0) {
    return { ok: false, error: 'dependents_failed' };
  }

  const { error: riderErr } = await admin.from('riders').delete().eq('id', id);
  if (riderErr) return { ok: false, error: 'delete_failed' };

  await admin.from('profiles').delete().eq('id', rider.profile_id);
  const { error: authErr } = await admin.auth.admin.deleteUser(rider.profile_id);

  // The audit row outlives the rider — that is the whole point of an
  // append-only trail, and it is written after the fact so it records what
  // actually happened rather than what was attempted.
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'rider.deleted',
    entityType: 'rider',
    entityId: id,
    metadata: {
      riderNumber: rider.rider_number,
      phone: rider.phone,
      name: impact.data!.name,
      contracts: contractIds.length,
      obligations: impact.data!.obligations,
      payments: paymentIds.length,
      authUserRemoved: !authErr,
    },
  });

  revalidatePath('/owner/riders');
  revalidatePath('/accountant/riders');
  return { ok: true, data: { riderNumber: rider.rider_number } };
}
