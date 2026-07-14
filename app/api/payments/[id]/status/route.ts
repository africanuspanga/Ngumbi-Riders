import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { reconcilePaymentWithProvider } from '@/lib/payments/settle';

// Conservative status polling (spec §12.2 step 10). Returns only the CONFIRMED
// local payment state — a browser is never proof of payment (§12.1). RLS ensures
// a rider can read only their own payment. When the payment is still pending we
// additionally ask Snippe directly (server-side, authoritative) and settle it,
// so completion does not depend solely on the webhook callback reaching us.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data } = await supabase
    .from('payments')
    .select('id, status, amount')
    .eq('id', id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const p = data as { id: string; status: string; amount: number };

  // The RLS read above proves this rider owns the payment. If it is still
  // pending, ask Snippe directly and settle — completion must not hang on the
  // webhook callback arriving. A provider hiccup must never break the poll, so
  // failure just leaves the status pending for the next poll.
  let status = p.status;
  if (status === 'pending') {
    try {
      status = await reconcilePaymentWithProvider(p.id);
    } catch (err) {
      console.error('[pay/status] reconcile failed for', p.id, err);
    }
  }

  let receiptId: string | null = null;
  if (status === 'completed') {
    const { data: receipt } = await supabase
      .from('receipts')
      .select('id')
      .eq('payment_id', p.id)
      .maybeSingle();
    receiptId = (receipt as { id: string } | null)?.id ?? null;
  }

  return NextResponse.json({ status, amount: p.amount, receiptId });
}
