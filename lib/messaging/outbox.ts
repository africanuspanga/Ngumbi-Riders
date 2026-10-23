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
}): Promise<{ ok: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from('message_outbox').insert({
    channel: input.channel,
    recipient: input.recipient,
    subject: input.subject ?? null,
    payload: input.payload as Json,
    status: 'pending',
  });
  if (error) {
    // A silently-lost enqueue is indistinguishable from "sent" — at minimum it
    // must leave a server-side trace (the guarantor-confirmation SMS is a
    // fraud-prevention control; vanishing without record defeats it).
    console.error('[outbox] enqueue failed:', input.channel, error.message);
    return { ok: false };
  }
  return { ok: true };
}

const MAX_ATTEMPTS = 5;

export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const admin = createAdminClient();
  // Failed messages are retried until MAX_ATTEMPTS — a single transient send
  // error must not permanently strand a message ("nothing is lost"). Oldest
  // first: under a backlog larger than `limit`, an unordered select would let
  // an arbitrary subset jump the queue while old messages rot.
  const { data, error: selErr } = await admin
    .from('message_outbox')
    .select('id, channel, recipient, subject, payload, attempts')
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_ATTEMPTS})`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (selErr) throw new Error(`outbox select failed: ${selErr.message}`);

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
      // If marking 'sent' fails, the next run re-sends the message (duplicate
      // SMS/email). Record the failure loudly; the row keeps its pending state
      // so at worst the recipient gets a duplicate, never a silent loss.
      const { error: sentErr } = await admin.from('message_outbox').update({ status: 'sent' }).eq('id', m.id);
      if (sentErr) console.error('[outbox] sent-status update failed (message may re-send):', m.id, sentErr.message);
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

/**
 * Queue an SMS and try to deliver it NOW (client request 2026-10-23: the owner
 * must hear about a new requisition when it happens, not at midnight).
 *
 * The row is written first, so the message exists even if the send fails or
 * the function dies mid-request; the nightly outbox run then retries it like
 * any other pending/failed message. A not_configured result leaves it pending
 * without burning an attempt, exactly as processOutbox does.
 */
export async function enqueueSms(input: {
  recipient: string;
  text: string;
  subject?: string;
  /** false = leave it for the next outbox run (bulk jobs pace themselves). */
  deliverNow?: boolean;
}): Promise<{ queued: boolean; sent: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('message_outbox')
    .insert({
      channel: 'sms',
      recipient: input.recipient,
      subject: input.subject ?? null,
      payload: { text: input.text } as Json,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[outbox] sms enqueue failed:', error?.message);
    return { queued: false, sent: false, error: 'enqueue_failed' };
  }
  if (input.deliverNow === false) return { queued: true, sent: false };

  const id = (data as { id: string }).id;
  const res = await sendSms({ to: input.recipient, text: input.text });
  if (res.ok) {
    const { error: sentErr } = await admin.from('message_outbox').update({ status: 'sent' }).eq('id', id);
    if (sentErr) console.error('[outbox] sent-status update failed (may re-send):', id, sentErr.message);
    return { queued: true, sent: true };
  }
  if (res.error === 'not_configured') {
    await admin.from('message_outbox').update({ last_error: 'not_configured' }).eq('id', id);
  } else {
    await admin
      .from('message_outbox')
      .update({ status: 'failed', attempts: 1, last_error: res.error })
      .eq('id', id);
  }
  return { queued: true, sent: false, error: res.error };
}

export { isMobishastraConfigured };
