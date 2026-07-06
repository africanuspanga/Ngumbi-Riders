'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/service';
import { sendPushToProfile } from '@/lib/push/webpush';
import { writeAudit } from '@/lib/audit/audit';

export type Audience = 'all_active' | 'arrears';
export type ActionResult = { ok: true; sent: number } | { ok: false; error: string };

/** Owner broadcasts an announcement to an audience (spec §17.5). */
export async function sendAnnouncement(input: {
  audience: Audience;
  title: string;
  body: string;
}): Promise<ActionResult> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') return { ok: false, error: 'forbidden' };
  if (!input.title.trim() || !input.body.trim()) return { ok: false, error: 'validation' };

  const admin = createAdminClient();

  // Resolve the audience to a set of rider ids.
  let riderIds: string[] = [];
  if (input.audience === 'arrears') {
    const { data } = await admin.from('payment_obligations').select('rider_id').eq('status', 'overdue');
    riderIds = [...new Set(((data ?? []) as { rider_id: string }[]).map((r) => r.rider_id))];
  } else {
    const { data } = await admin.from('riders').select('id').eq('status', 'active');
    riderIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  if (riderIds.length === 0) return { ok: true, sent: 0 };

  const { data: announcement } = await admin
    .from('announcements')
    .insert({ created_by: profile.userId, title: input.title, body: input.body, audience: input.audience })
    .select('id')
    .single();
  const announcementId = (announcement as { id: string } | null)?.id;

  // Map riders -> profile ids for notification + push.
  const { data: riders } = await admin.from('riders').select('id, profile_id').in('id', riderIds);
  const riderRows = (riders ?? []) as { id: string; profile_id: string }[];

  let sent = 0;
  for (const r of riderRows) {
    await createNotification({
      profileId: r.profile_id,
      type: 'announcement',
      title: input.title,
      body: input.body,
      deepLink: '/rider/notifications',
      dedupeKey: announcementId ? `announcement:${announcementId}:${r.id}` : undefined,
    });
    if (announcementId) {
      await admin.from('announcement_recipients').insert({ announcement_id: announcementId, rider_id: r.id }).select('id');
    }
    await sendPushToProfile(r.profile_id, { title: input.title, body: input.body, url: '/rider/notifications' });
    sent++;
  }

  await writeAudit({
    actorId: profile.userId,
    actorRole: 'owner',
    action: 'announcement.sent',
    entityType: 'announcement',
    entityId: announcementId ?? null,
    metadata: { audience: input.audience, sent },
  });
  revalidatePath('/owner/announcements');
  return { ok: true, sent };
}
