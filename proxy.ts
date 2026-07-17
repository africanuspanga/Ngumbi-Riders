import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 proxy (formerly middleware.ts). Refreshes the Supabase session on
// every matched request and gates the /rider and /owner areas. Runs on the
// Node.js runtime so it can use the Supabase SSR client.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// The export MUST be named `config` — Next only extracts the matcher from an
// export with that exact name (verified against next@16.2's
// get-page-static-info: extractExportedConstValue(ast, 'config'); the type is
// exported as ProxyConfig but the value name is unchanged). This was previously
// exported as `proxyConfig`, which Next silently ignored — the proxy then ran
// on EVERY request, including _next/static chunks, images and sw.js, adding a
// Supabase auth round-trip per asset for signed-in users.
export const config = {
  // Skip static assets, image optimization, the PWA/service-worker files, and
  // the self-authenticating machine endpoints (webhook HMAC / CRON_SECRET) —
  // none of them use the session cookie the proxy exists to refresh.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|api/webhooks/|api/cron/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
