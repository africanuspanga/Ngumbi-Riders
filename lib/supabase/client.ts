'use client';

import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env';

// Browser client — only ever uses the publishable key. All privileged access is
// mediated by RLS or by server routes; the browser never sees a secret.
// (Precise generated row types are wired in once `supabase gen types` runs
// against the live database; see lib/supabase/types.ts.)
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
