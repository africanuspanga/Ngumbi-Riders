import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase/admin';

// Frequent: release expired reservations and fail stale 'created' payments that
// never produced a provider reference (spec §12.5, §27). Never frees a
// reservation just because the browser closed — only on expiry.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runJob('reservation-cleanup', async () => {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const staleCutoff = new Date(Date.now() - 60 * 60_000).toISOString();

    // First fail stale 'created' payments that never reached the provider, so
    // their reservations become releasable below.
    const { data: failed } = await admin
      .from('payments')
      .update({ status: 'failed' })
      .eq('status', 'created')
      .lt('created_at', staleCutoff)
      .select('id');

    // Release expired reservations ONLY for payments in a terminal state. A
    // still-pending payment keeps its reservations: they are the record of
    // which obligations it covers, and freeing them early would let another
    // payment settle the same obligations while the first can still complete.
    const { data: expired } = await admin
      .from('payment_reservations')
      .select('id, payments!inner(status)')
      .eq('is_active', true)
      .lt('expires_at', now)
      .limit(1000);
    const terminal = new Set(['failed', 'expired', 'cancelled', 'completed', 'reversed']);
    const releasable = ((expired ?? []) as unknown as { id: string; payments: { status: string } }[])
      .filter((r) => terminal.has(r.payments.status))
      .map((r) => r.id);
    let released = 0;
    if (releasable.length) {
      const { data: rel } = await admin
        .from('payment_reservations')
        .update({ is_active: false })
        .in('id', releasable)
        .select('id');
      released = (rel ?? []).length;
    }

    return { reservationsReleased: released, paymentsFailed: (failed ?? []).length };
  });

  return NextResponse.json(result);
}
