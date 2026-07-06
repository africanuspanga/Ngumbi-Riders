import 'server-only';

import webpush from 'web-push';
import { serverEnv, clientEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/*
 * Web push (spec §17.2, §26.1). Supplementary to the in-app notification, which
 * remains the source of truth. Disabled until VAPID keys are configured. Dead
 * subscriptions (410/404) are pruned.
 */
export function isPushConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function configure(): boolean {
  const env = serverEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || 'mailto:owner@ngumbi.co.tz',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  return true;
}

export function pushPublicKey(): string | null {
  return serverEnv().VAPID_PUBLIC_KEY ?? null;
}

/** Best-effort push to all of a profile's subscriptions. */
export async function sendPushToProfile(
  profileId: string,
  payload: { title: string; body?: string; url?: string },
): Promise<number> {
  if (!configure()) return 0;
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('profile_id', profileId);

  let sent = 0;
  for (const s of (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, url: payload.url ?? clientEnv.NEXT_PUBLIC_APP_URL }),
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }
  return sent;
}
