'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionProfile } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit/audit';
import { staffPhone } from '@/lib/auth/staff-otp';
import {
  createAccountantSchema,
  resetAccountantPasswordSchema,
  setAccountantPhoneSchema,
} from './validation';

/*
 * Accountant account management (build spec #10) — OWNER ONLY, every action.
 *
 * `staff.manage` is deliberately absent from the accountant permission set, so
 * an accountant can neither create another accountant nor reactivate
 * themselves. The guard here is `role !== 'owner'` rather than a permission
 * lookup, because this is the one surface where "the owner retains full
 * control" is the requirement itself.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertOwner(): Promise<string> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export type StaffRow = {
  id: string;
  fullName: string | null;
  email: string | null;
  /** E.164 phone on the auth user — where SMS sign-in codes go (D-053). */
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
};

/** All accountant accounts, newest first. Owner-only. */
export async function listAccountants(): Promise<StaffRow[]> {
  await assertOwner();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email, is_active, created_at, deactivated_at')
    .eq('role', 'accountant')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listAccountants failed: ${error.message}`);

  const rows = (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    is_active: boolean;
    created_at: string;
    deactivated_at: string | null;
  }[];
  // Not on `profiles` (every staff member can read that since 0026).
  const phones = await Promise.all(rows.map((p) => staffPhone(p.id)));
  return rows.map((p, i) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    phone: phones[i] ?? null,
    isActive: p.is_active,
    createdAt: p.created_at,
    deactivatedAt: p.deactivated_at,
  }));
}

/** Create an accountant login. Owner-only. */
export async function createAccountant(input: unknown): Promise<ActionResult<{ profileId: string }>> {
  const ownerId = await assertOwner();
  const parsed = createAccountantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation' };
  }
  const { fullName, email, phone, password } = parsed.data;

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    // Supabase reports an existing address as a 422 "already been registered".
    const msg = createError?.message ?? '';
    if (/already/i.test(msg) || /registered/i.test(msg)) {
      return { ok: false, error: 'email_taken' };
    }
    return { ok: false, error: 'create_failed' };
  }
  const userId = created.user.id;

  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    role: 'accountant',
    full_name: fullName,
    email,
    is_active: true,
    must_change_pin: false,
    created_by: ownerId,
  });
  if (profileError) {
    // Never leave an auth user with no profile: it would be able to sign in
    // while getSessionProfile() returns null, i.e. a login that goes nowhere.
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: 'create_failed' };
  }

  // Where the SMS sign-in code goes (D-053/0038) — required.
  const { error: phoneError } = await admin
    .from('staff_otp_phones')
    .upsert({ user_id: userId, phone, updated_by: ownerId });
  if (phoneError) {
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: 'create_failed' };
  }
  // Also let them sign in by PHONE + password, when the number is not already
  // somebody's login (e.g. a rider's). Best effort: the email works regardless.
  await admin.auth.admin
    .updateUserById(userId, { phone, phone_confirm: true })
    .catch(() => undefined);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'accountant.created',
    entityType: 'profile',
    entityId: userId,
    metadata: { email, phone },
  });
  revalidatePath('/owner/staff');
  return { ok: true, data: { profileId: userId } };
}

/**
 * Activate or deactivate an accountant. Deactivating also revokes their live
 * sessions, so access ends on the next request rather than at token expiry.
 */
export async function setAccountantActive(
  profileId: string,
  active: boolean,
): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();

  // Scope the write to accountants: this endpoint must never be able to
  // deactivate the owner's own profile (which would lock the business out).
  const { data: changed, error } = await admin
    .from('profiles')
    .update({
      is_active: active,
      deactivated_at: active ? null : new Date().toISOString(),
    })
    .eq('id', profileId)
    .eq('role', 'accountant')
    .select('id');
  if (error) return { ok: false, error: 'update_failed' };
  if (!changed || changed.length === 0) return { ok: false, error: 'not_found' };

  if (!active) {
    // Best-effort: the RLS/route guards already refuse a deactivated profile,
    // so a failure here delays nothing security-critical.
    try {
      await admin.auth.admin.signOut(profileId, 'global');
    } catch {
      /* session revocation is belt-and-braces */
    }
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: active ? 'accountant.activated' : 'accountant.deactivated',
    entityType: 'profile',
    entityId: profileId,
  });
  revalidatePath('/owner/staff');
  return { ok: true };
}

/** Set a new password for an accountant (owner-driven reset). */
export async function resetAccountantPassword(input: unknown): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const parsed = resetAccountantPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation' };
  }
  const admin = createAdminClient();

  const { data: target } = await admin
    .from('profiles')
    .select('id')
    .eq('id', parsed.data.profileId)
    .eq('role', 'accountant')
    .maybeSingle();
  if (!target) return { ok: false, error: 'not_found' };

  const { error } = await admin.auth.admin.updateUserById(parsed.data.profileId, {
    password: parsed.data.password,
  });
  if (error) return { ok: false, error: 'update_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'accountant.password_reset',
    entityType: 'profile',
    entityId: parsed.data.profileId,
  });
  return { ok: true };
}

/**
 * Set or change the phone an accountant's SMS sign-in codes go to (D-053).
 * Sessions verified through the old number are forgotten: whoever held it
 * must not keep a session that number vouched for.
 */
export async function setAccountantPhone(input: unknown): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const parsed = setAccountantPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation' };
  }
  const admin = createAdminClient();

  const { data: target } = await admin
    .from('profiles')
    .select('id')
    .eq('id', parsed.data.profileId)
    .eq('role', 'accountant')
    .maybeSingle();
  if (!target) return { ok: false, error: 'not_found' };

  // Kept apart from the auth phone (0038): the number may already be this
  // person's RIDER login, which Supabase would refuse to share.
  const { error } = await admin.from('staff_otp_phones').upsert({
    user_id: parsed.data.profileId,
    phone: parsed.data.phone,
    updated_by: ownerId,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: 'update_failed' };
  // Forget every session the OLD number vouched for. With sign-in codes on,
  // those sessions stop counting as staff in RLS on their next query (0037).
  // (auth.admin.signOut takes a JWT, not a user id, so it cannot do this.)
  await admin.from('staff_verified_sessions').delete().eq('user_id', parsed.data.profileId);

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'accountant.phone_set',
    entityType: 'profile',
    entityId: parsed.data.profileId,
    metadata: { phone: parsed.data.phone },
  });
  revalidatePath('/owner/staff');
  return { ok: true };
}

/**
 * Withdraw an accountant's access permanently.
 *
 * This deactivates and revokes sessions rather than DELETING the row: the
 * profile is referenced by audit_logs, financial_notes and payments.created_by,
 * and erasing it would break the financial audit trail this system is required
 * to keep (spec rule 6 — corrections are events, never deletions). The account
 * can no longer sign in, which is what "remove access" means operationally.
 */
export async function removeAccountantAccess(profileId: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const res = await setAccountantActive(profileId, false);
  if (!res.ok) return res;

  const admin = createAdminClient();
  // Also scramble the password so the old credentials are dead even if the
  // profile is ever reactivated by mistake — the owner must set a new one.
  const scrambled = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  try {
    await admin.auth.admin.updateUserById(profileId, { password: scrambled });
  } catch {
    /* deactivation already blocks access */
  }

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'accountant.access_removed',
    entityType: 'profile',
    entityId: profileId,
  });
  revalidatePath('/owner/staff');
  return { ok: true };
}
