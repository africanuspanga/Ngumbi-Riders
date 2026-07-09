import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { clientEnv, serverEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

/*
 * Service-role client — BYPASSES RLS. The `server-only` import above makes any
 * client bundle that reaches this module fail to build.
 *
 * Use ONLY for narrowly scoped privileged operations that cannot be expressed
 * under RLS: creating rider auth users with a server-derived password, applying
 * verified Snippe webhooks, and running scheduled jobs. Never hand this client
 * an unvalidated client-supplied amount, role, rider id or payment status.
 */
export function createAdminClient() {
  return createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
