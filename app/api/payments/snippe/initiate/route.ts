import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientEnv } from '@/lib/env';
import { normalizePhone } from '@/lib/auth/phone';
import { loadRiderPaymentContext } from '@/lib/payments/service';
import { selectOldest } from '@/lib/payments/selection';
import { newIdempotencyKey } from '@/lib/payments/idempotency';
import { createMobilePayment } from '@/lib/snippe/client';
import { writeAudit } from '@/lib/audit/audit';

// Rider payment initiation (spec §12.2). Entirely server-side: the server
// recomputes the selected obligations and amount, reserves them, and creates the
// Snippe intent. The client never supplies the amount or obligation ids.
export const runtime = 'nodejs';

const MIN_TZS = 500; // Snippe minimum

const bodySchema = z.object({
  count: z.number().int().min(1).max(365),
  payerPhone: z.string().min(7).max(20),
});

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  let payerPhone: string;
  try {
    payerPhone = normalizePhone(parsed.data.payerPhone);
  } catch {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 422 });
  }

  const ctx = await loadRiderPaymentContext(user.id);
  if (!ctx) return NextResponse.json({ error: 'no_active_contract' }, { status: 409 });

  const admin = createAdminClient();

  // One active pending attempt per rider+contract (spec §12.5).
  const { data: existing } = await admin
    .from('payments')
    .select('id')
    .eq('rider_id', ctx.riderId)
    .eq('contract_id', ctx.contractId)
    .in('status', ['created', 'pending'])
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'pending_exists' }, { status: 409 });
  }

  // Server recomputes obligations + amount (oldest-first).
  let selection;
  try {
    selection = selectOldest(ctx.obligations, parsed.data.count);
  } catch {
    return NextResponse.json({ error: 'invalid_selection' }, { status: 422 });
  }
  if (selection.amount < MIN_TZS) {
    return NextResponse.json({ error: 'below_minimum' }, { status: 422 });
  }

  // Create the local pending payment.
  const idemKey = newIdempotencyKey();
  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      rider_id: ctx.riderId,
      contract_id: ctx.contractId,
      method: 'mobile_money',
      amount: selection.amount,
      status: 'created',
      payer_phone: payerPhone,
      idempotency_key: idemKey,
    })
    .select('id')
    .single();
  if (payErr || !payment) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  const paymentId = (payment as { id: string }).id;

  // Reserve the obligations. The partial-unique index rejects any obligation
  // already reserved by another in-flight payment.
  const expiresAt = new Date(Date.now() + 4 * 60 * 60_000).toISOString();
  const { error: resErr } = await admin.from('payment_reservations').insert(
    selection.obligationIds.map((obligationId) => ({
      payment_id: paymentId,
      obligation_id: obligationId,
      is_active: true,
      expires_at: expiresAt,
    })),
  );
  if (resErr) {
    await admin.from('payments').delete().eq('id', paymentId);
    return NextResponse.json({ error: 'obligation_reserved' }, { status: 409 });
  }

  // Create the Snippe mobile-money intent (USSD push).
  const snippe = await createMobilePayment({
    amount: selection.amount,
    phone: payerPhone,
    firstname: ctx.firstName,
    lastname: ctx.lastName,
    email: ctx.email ?? '',
    idempotencyKey: idemKey,
    webhookUrl: `${clientEnv.NEXT_PUBLIC_APP_URL}/api/webhooks/snippe`,
    metadata: { payment_id: paymentId },
  });

  if (!snippe.ok) {
    await admin.from('payments').update({ status: 'failed' }).eq('id', paymentId);
    await admin.from('payment_reservations').update({ is_active: false }).eq('payment_id', paymentId);
    const status = snippe.error === 'not_configured' ? 503 : 502;
    return NextResponse.json({ error: snippe.error }, { status });
  }

  await admin
    .from('payments')
    .update({
      status: 'pending',
      snippe_reference: snippe.data.reference,
      provider_payment_id: snippe.data.reference,
    })
    .eq('id', paymentId);

  await writeAudit({
    actorId: user.id,
    actorRole: 'rider',
    action: 'payment.initiated',
    entityType: 'payment',
    entityId: paymentId,
    metadata: { amount: selection.amount, count: parsed.data.count },
  });

  return NextResponse.json({ ok: true, paymentId, status: 'pending', amount: selection.amount });
}
