import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/resend/client';

/*
 * Delivery outbox (spec §3.7, §17). Email is delivered via Resend. SMS and
 * WhatsApp adapters are intentionally DISABLED until a provider + credentials
 * are supplied — their messages are marked "skipped" so nothing is lost and the
 * owner can see them in system health.
 */
export type OutboxChannel = 'email' | 'sms' | 'whatsapp';

// Feature flags — flip on when providers are configured (spec §36.16).
const ADAPTER_ENABLED: Record<OutboxChannel, boolean> = {
  email: true,
  sms: false,
  whatsapp: false,
};

export async function enqueueMessage(input: {
  channel: OutboxChannel;
  recipient: string;
  subject?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from('message_outbox').insert({
    channel: input.channel,
    recipient: input.recipient,
    subject: input.subject ?? null,
    payload: input.payload,
    status: 'pending',
  });
}

export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('message_outbox')
    .select('id, channel, recipient, subject, payload, attempts')
    .eq('status', 'pending')
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const m of (data ?? []) as {
    id: string;
    channel: OutboxChannel;
    recipient: string;
    subject: string | null;
    payload: { html?: string };
    attempts: number;
  }[]) {
    if (!ADAPTER_ENABLED[m.channel]) {
      await admin.from('message_outbox').update({ status: 'skipped', last_error: 'adapter_disabled' }).eq('id', m.id);
      skipped++;
      continue;
    }
    if (m.channel === 'email') {
      const res = await sendEmail({ to: m.recipient, subject: m.subject ?? 'Ng’umbi Riders', html: m.payload.html ?? '' });
      if (res.ok) {
        await admin.from('message_outbox').update({ status: 'sent' }).eq('id', m.id);
        sent++;
      } else {
        await admin
          .from('message_outbox')
          .update({ status: 'failed', attempts: m.attempts + 1, last_error: res.error })
          .eq('id', m.id);
        failed++;
      }
    }
  }
  return { sent, failed, skipped };
}
