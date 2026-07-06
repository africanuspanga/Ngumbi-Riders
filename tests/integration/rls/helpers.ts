import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createRiderUser, createOwnerUser } from '@/lib/auth/provision';
import { createAdminClient } from '@/lib/supabase/admin';
import { derivePassword } from '@/lib/auth/pin-derive';

/*
 * Shared fixtures for the RLS isolation suite. These tests require a live
 * Supabase with the Phase 1 migrations applied. When the required env is
 * absent (e.g. CI without a database, or this Docker-less build machine) the
 * suite is skipped rather than failing.
 */

export function rlsEnvReady(): boolean {
  // Opt-in: the caller sets RLS_TEST_ENABLED once a live Supabase (local or a
  // provided project) has the Phase 1 migrations applied and env is populated.
  const hasRealEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    Boolean(process.env.AUTH_PIN_PEPPER) &&
    !String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes('localhost:54321');
  return Boolean(process.env.RLS_TEST_ENABLED) && hasRealEnv;
}

const SUITE = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
let seq = 0;
function uniquePhone(): string {
  // +255 7 XXXXXXXX — deterministic-ish unique tail per run.
  seq += 1;
  const tail = (Number(SUITE) * 100 + seq).toString().padStart(8, '0').slice(-8);
  return `+2557${tail}`;
}

export function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function makeRider(opts?: { pin?: string }) {
  const pin = opts?.pin ?? '4820';
  const phone = uniquePhone();
  const riderNumber = `NGR-R-T${SUITE}${seq}`;
  const created = await createRiderUser({
    phone,
    pin,
    riderNumber,
    firstName: 'Test',
    lastName: `Rider${seq}`,
    mustChangePin: false,
  });

  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    phone: created.phone,
    password: derivePassword(created.phone, pin),
  });
  if (error) throw new Error(`rider sign-in failed: ${error.message}`);

  return { ...created, pin, client };
}

export async function makeOwner() {
  const email = `owner+${SUITE}-${seq}@ngumbi.test`;
  const password = `Owner!${SUITE}aA1`;
  const { userId } = await createOwnerUser({
    email,
    password,
    fullName: 'Test Owner',
  });
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`owner sign-in failed: ${error.message}`);
  return { userId, email, client };
}

/** Best-effort teardown of everything created by a test run. */
export async function cleanupUsers(userIds: string[]) {
  const admin = createAdminClient();
  for (const id of userIds) {
    // Deleting the auth user cascades to profiles -> riders (on delete cascade
    // / restrict handled by removing dependents first where needed).
    await admin.from('riders').delete().eq('profile_id', id);
    await admin.from('profiles').delete().eq('id', id);
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
}
