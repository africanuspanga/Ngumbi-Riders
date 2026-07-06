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

    const { data: released } = await admin
      .from('payment_reservations')
      .update({ is_active: false })
      .lt('expires_at', now)
      .eq('is_active', true)
      .select('id');

    const { data: failed } = await admin
      .from('payments')
      .update({ status: 'failed' })
      .eq('status', 'created')
      .lt('created_at', staleCutoff)
      .select('id');

    return { reservationsReleased: (released ?? []).length, paymentsFailed: (failed ?? []).length };
  });

  return NextResponse.json(result);
}
