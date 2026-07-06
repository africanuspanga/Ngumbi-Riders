import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { normalizePhone } from './phone';
import { derivePassword } from './pin-derive';

/*
 * Privileged account provisioning (spec §7.2, §9.2). Runs only on the server
 * with the service-role client. Rider auth users are created with the phone
 * pre-confirmed and a server-derived password — the raw PIN is never stored and
 * never sent to Supabase in plaintext.
 */

export type CreateRiderInput = {
  phone: string;
  pin: string;
  riderNumber: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName?: string;
  mustChangePin?: boolean;
};

export type CreatedRider = { userId: string; riderId: string; phone: string };

export async function createRiderUser(
  input: CreateRiderInput,
): Promise<CreatedRider> {
  const admin = createAdminClient();
  const canonicalPhone = normalizePhone(input.phone);
  const password = derivePassword(canonicalPhone, input.pin);

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      phone: canonicalPhone,
      password,
      phone_confirm: true,
    });
  if (createError || !created.user) {
    throw new Error(`createUser failed: ${createError?.message}`);
  }
  const userId = created.user.id;

  const fullName =
    input.fullName ?? `${input.firstName} ${input.lastName}`.trim();

  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    role: 'rider',
    full_name: fullName,
    must_change_pin: input.mustChangePin ?? true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`profile insert failed: ${profileError.message}`);
  }

  const { data: rider, error: riderError } = await admin
    .from('riders')
    .insert({
      profile_id: userId,
      rider_number: input.riderNumber,
      phone: canonicalPhone,
      first_name: input.firstName,
      middle_name: input.middleName ?? null,
      last_name: input.lastName,
      status: 'active',
    })
    .select('id')
    .single();
  if (riderError || !rider) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`rider insert failed: ${riderError?.message}`);
  }

  return {
    userId,
    riderId: (rider as { id: string }).id,
    phone: canonicalPhone,
  };
}

export async function createOwnerUser(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<{ userId: string }> {
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !created.user) {
    throw new Error(`owner createUser failed: ${error?.message}`);
  }
  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    role: 'owner',
    full_name: input.fullName,
    must_change_pin: false,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`owner profile insert failed: ${profileError.message}`);
  }
  return { userId: created.user.id };
}
