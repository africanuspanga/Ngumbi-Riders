'use client';

import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

// Browser client — only ever uses the publishable key. All privileged access is
// mediated by RLS or by server routes; the browser never sees a secret.
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
