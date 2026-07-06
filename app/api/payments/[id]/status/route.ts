import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

// Conservative status polling (spec §12.2 step 10). Returns only the CONFIRMED
// local payment state — a browser is never proof of payment (§12.1). RLS ensures
// a rider can read only their own payment.
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
  let receiptId: string | null = null;
  if (p.status === 'completed') {
    const { data: receipt } = await supabase
      .from('receipts')
      .select('id')
      .eq('payment_id', p.id)
      .maybeSingle();
    receiptId = (receipt as { id: string } | null)?.id ?? null;
  }

  return NextResponse.json({ status: p.status, amount: p.amount, receiptId });
}
