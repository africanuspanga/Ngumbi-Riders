import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToProfile } from '@/lib/push/webpush';
import { enqueueSms } from '@/lib/messaging/outbox';
import { serverEnv } from '@/lib/env';

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

/**
 * Insert a notification; a unique dedupe_key makes repeats a no-op. Returns
 * true when a NEW row was written, so callers can attach a side effect (an
 * SMS) that must happen once per event, not once per retry.
 */
export async function createNotification(n: NotificationInput): Promise<boolean> {
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
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return false;
    throw new Error(`notification insert failed: ${error.message}`);
  }
  return true;
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

/** The owner's phone numbers for important-update SMS (OWNER_NOTIFY_PHONE). */
export function ownerPhones(): string[] {
  return (serverEnv().OWNER_NOTIFY_PHONE ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Notify the owner account(s) in-app and, when `sms` is given, by SMS to
 * OWNER_NOTIFY_PHONE (client request 2026-10-23: "Owner should be given
 * important update via sms"). The SMS is sent only when the in-app row is NEW,
 * so a retried job or a double-clicked button never texts the owner twice, and
 * it is best-effort: an SMS failure never fails the action that caused it.
 */
export async function notifyOwner(
  n: Omit<NotificationInput, 'profileId'> & { sms?: string },
): Promise<void> {
  const { sms, ...notification } = n;
  const admin = createAdminClient();
  const { data: owners } = await admin.from('profiles').select('id').eq('role', 'owner');
  let fresh = false;
  for (const o of (owners ?? []) as { id: string }[]) {
    if (await createNotification({ ...notification, profileId: o.id })) fresh = true;
  }
  // No dedupe key means every call is an event of its own.
  if (!sms || (!fresh && notification.dedupeKey)) return;
  for (const phone of ownerPhones()) {
    try {
      await enqueueSms({ recipient: phone, text: sms, subject: n.type });
    } catch (e) {
      console.error('[notify] owner sms failed:', n.type, (e as Error).message);
    }
  }
}
