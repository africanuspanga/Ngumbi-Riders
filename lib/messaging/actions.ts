'use server';

import { requireOwner } from '@/lib/auth/session';
import { enqueueSms } from './outbox';
import { toMsisdn } from '@/lib/mobishastra/text';
import { writeAudit } from '@/lib/audit/audit';

/**
 * Send one test SMS from the owner's System page, so "is SMS working?" has a
 * one-click answer instead of waiting for a rider to fall two days behind.
 * Owner-only, Tanzanian numbers only, audited.
 */
export async function sendTestSms(
  phone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = await requireOwner();
  const msisdn = toMsisdn(phone ?? '');
  if (!/^255[67]\d{8}$/.test(msisdn)) return { ok: false, error: 'invalid_phone' };

  const res = await enqueueSms({
    recipient: `+${msisdn}`,
    subject: 'test_sms',
    text: "Ng'umbi Riders: Huu ni ujumbe wa majaribio. SMS zinafanya kazi.",
  });
  await writeAudit({
    actorId: owner.userId,
    actorRole: 'owner',
    action: 'sms.test_sent',
    entityType: 'message_outbox',
    entityId: null,
    metadata: { to: `***${msisdn.slice(-4)}`, sent: res.sent, error: res.error ?? null },
  });
  return res.sent ? { ok: true } : { ok: false, error: res.error ?? 'send_failed' };
}
