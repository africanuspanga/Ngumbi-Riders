import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clientEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

// Request-scoped server client bound to the SSR cookie store. Runs as the
// signed-in user, so RLS applies. Use this for all authenticated reads/writes
// in Server Components, Server Actions and Route Handlers.
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only. The
            // proxy (lib/supabase/proxy.ts) refreshes the session instead.
          }
        },
      },
    },
  );
}
