/*
 * Set (or reset) the owner account's password using the Supabase Admin API.
 *
 * Run:
 *   OWNER_NEW_PASSWORD='your-new-password' npm run owner:password
 *
 * Optionally set SEED_OWNER_EMAIL if the owner email differs from the default.
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY (server-only).
 */
import './load-env';

import { createAdminClient } from '@/lib/supabase/admin';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@ngumbi.co.tz';

async function main() {
  const password = process.env.OWNER_NEW_PASSWORD;
  if (!password || password.length < 10) {
    console.error('Set OWNER_NEW_PASSWORD to a password of at least 10 characters.');
    process.exit(1);
  }

  const admin = createAdminClient();

  // Find the owner's auth user id via the profiles table (single-owner app;
  // the owner profile row does not store the email, so verify it via Auth).
  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'owner');
  const rows = (profiles ?? []) as { id: string }[];
  if (profErr || rows.length === 0) {
    console.error('Owner profile not found. Run "npm run seed" first.');
    process.exit(1);
  }

  let userId: string | null = null;
  for (const row of rows) {
    const { data: user } = await admin.auth.admin.getUserById(row.id);
    if (user?.user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
      userId = row.id;
      break;
    }
  }
  if (!userId) {
    console.error(`No owner auth user matches ${OWNER_EMAIL} (set SEED_OWNER_EMAIL if it differs).`);
    process.exit(1);
  }
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error(`Password update failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`Password updated for ${OWNER_EMAIL}. Sign in at /login/owner.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
