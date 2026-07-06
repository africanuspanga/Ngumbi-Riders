import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 proxy (formerly middleware.ts). Refreshes the Supabase session on
// every matched request and gates the /rider and /owner areas. Runs on the
// Node.js runtime so it can use the Supabase SSR client.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const proxyConfig = {
  // Skip static assets, image optimization and the PWA/service-worker files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
