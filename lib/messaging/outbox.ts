import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/resend/client';
import { sendSms, isMobishastraConfigured } from '@/lib/mobishastra/client';
import type { Json } from '@/lib/supabase/types';

/*
 * Delivery outbox (spec §3.7, §17). Email is delivered via Resend, SMS via
 * Mobishastra (build spec #4/#6). WhatsApp is still DISABLED until a provider is
 * supplied — its messages are marked "skipped" so nothing is lost and the owner
 * can see them in system health. Email and SMS are always "enabled" here but
 * degrade to not_configured (message left pending) until their keys land, so a
 * message enqueued before credentials exist delivers on the first run after.
 */
export type OutboxChannel = 'email' | 'sms' | 'whatsapp';

// Feature flags — WhatsApp stays hard-off (no provider). Email/SMS gate on
// credentials at send time via not_configured, not on a static flag.
const ADAPTER_ENABLED: Record<OutboxChannel, boolean> = {
  email: true,
  sms: true,
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
    payload: input.payload as Json,
    status: 'pending',
  });
}

const MAX_ATTEMPTS = 5;

export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const admin = createAdminClient();
  // Failed messages are retried until MAX_ATTEMPTS — a single transient send
  // error must not permanently strand a message ("nothing is lost").
  const { data } = await admin
    .from('message_outbox')
    .select('id, channel, recipient, subject, payload, attempts')
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_ATTEMPTS})`)
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const m of (data ?? []) as {
    id: string;
    channel: OutboxChannel;
    recipient: string;
    subject: string | null;
    payload: { html?: string; text?: string };
    attempts: number;
  }[]) {
    if (!ADAPTER_ENABLED[m.channel]) {
      await admin.from('message_outbox').update({ status: 'skipped', last_error: 'adapter_disabled' }).eq('id', m.id);
      skipped++;
      continue;
    }

    // Each channel returns {ok} | {ok:false, error}. A not_configured result
    // leaves the message pending WITHOUT burning an attempt, so it delivers on
    // the first run after credentials land; any other error is a real failure
    // and is retried up to MAX_ATTEMPTS.
    const res =
      m.channel === 'email'
        ? await sendEmail({ to: m.recipient, subject: m.subject ?? 'Ng’umbi Riders', html: m.payload.html ?? '' })
        : m.channel === 'sms'
          ? await sendSms({ to: m.recipient, text: m.payload.text ?? '' })
          : ({ ok: false as const, error: 'unsupported_channel' });

    if (res.ok) {
      await admin.from('message_outbox').update({ status: 'sent' }).eq('id', m.id);
      sent++;
    } else if (res.error === 'not_configured') {
      await admin.from('message_outbox').update({ last_error: 'not_configured' }).eq('id', m.id);
      skipped++;
    } else {
      await admin
        .from('message_outbox')
        .update({ status: 'failed', attempts: m.attempts + 1, last_error: res.error })
        .eq('id', m.id);
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/** Enqueue an SMS for the outbox to deliver (build spec #4/#6). */
export async function enqueueSms(input: { recipient: string; text: string; subject?: string }): Promise<void> {
  await enqueueMessage({
    channel: 'sms',
    recipient: input.recipient,
    subject: input.subject,
    payload: { text: input.text },
  });
}

export { isMobishastraConfigured };
