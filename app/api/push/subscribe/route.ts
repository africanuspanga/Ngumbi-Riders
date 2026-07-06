import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pushPublicKey } from '@/lib/push/webpush';

// PWA web-push subscription (spec §17.2, §26.1). GET returns the VAPID public
// key; POST stores the subscription for the signed-in user.
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ publicKey: pushPublicKey() });
}

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = subSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from('push_subscriptions').upsert(
    {
      profile_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    },
    { onConflict: 'endpoint' },
  );
  if (error) return NextResponse.json({ error: 'store_failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
