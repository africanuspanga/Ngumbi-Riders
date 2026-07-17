import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToProfile } from '@/lib/push/webpush';

/*
 * In-app notifications (spec §17.1) — the SOURCE OF TRUTH for notifications;
 * push is supplementary (§17.2). Persistent records with read/unread state,
 * deep links, and a dedupe key so reminders don't duplicate (§17.3).
 */
export type NotificationInput = {
  profileId: string;
  type: string;
  title: string;
  body?: string;
  deepLink?: string;
  dedupeKey?: string;
};

/** Insert a notification; a unique dedupe_key makes repeats a no-op. */
export async function createNotification(n: NotificationInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('notifications').insert({
    recipient_profile_id: n.profileId,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    deep_link: n.deepLink ?? null,
    dedupe_key: n.dedupeKey ?? null,
  });
  // Ignore duplicate-key (dedupe) errors; surface anything else to the caller.
  if (error && !/duplicate key/i.test(error.message)) {
    throw new Error(`notification insert failed: ${error.message}`);
  }
}

/** Resolve a rider's profile id and notify them. */
export async function notifyRider(riderId: string, n: Omit<NotificationInput, 'profileId'>): Promise<void> {
  const admin = createAdminClient();
  const { data: rider } = await admin.from('riders').select('profile_id').eq('id', riderId).maybeSingle();
  const profileId = (rider as { profile_id: string } | null)?.profile_id;
  if (!profileId) return;
  await createNotification({ ...n, profileId });
  // Push is supplementary (spec §17.2) and BEST-EFFORT — the highest-value
  // messages (payment due/overdue/completed) previously never reached push at
  // all: a rider had to open the app to learn they owed. No-ops until VAPID is
  // configured; a push failure never fails the in-app notification.
  try {
    await sendPushToProfile(profileId, {
      title: n.title,
      body: n.body ?? '',
      url: n.deepLink ?? '/rider/notifications',
    });
  } catch {
    /* push is never load-bearing */
  }
}

/** Notify the owner account(s). */
export async function notifyOwner(n: Omit<NotificationInput, 'profileId'>): Promise<void> {
  const admin = createAdminClient();
  const { data: owners } = await admin.from('profiles').select('id').eq('role', 'owner');
  for (const o of (owners ?? []) as { id: string }[]) {
    await createNotification({ ...n, profileId: o.id });
  }
}
