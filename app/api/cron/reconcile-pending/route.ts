import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentStatus } from '@/lib/snippe/client';
import { settlePaymentCompleted, markPaymentFailed } from '@/lib/payments/settle';

// Pending Snippe reconciliation (spec §12.5). Checks old pending payments
// against the provider status endpoint and resolves them. The webhook remains
// the primary path; this catches missed/dropped webhooks.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runJob('reconcile-pending', async () => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString(); // > 30 min old

    const { data } = await admin
      .from('payments')
      .select('id, rider_id, amount, snippe_reference')
      .eq('status', 'pending')
      .not('snippe_reference', 'is', null)
      .lt('created_at', cutoff)
      .limit(50);

    let settled = 0;
    let failed = 0;
    let unresolved = 0;

    for (const p of (data ?? []) as { id: string; rider_id: string; amount: number; snippe_reference: string }[]) {
      const status = await getPaymentStatus(p.snippe_reference);
      if (!status.ok) {
        unresolved++;
        continue;
      }
      if (status.data.status === 'completed') {
        // Same amount guard as the webhook path: never settle a payment whose
        // provider amount disagrees with the local row.
        if (status.data.amountValue !== p.amount) {
          unresolved++;
          continue;
        }
        const r = await settlePaymentCompleted(p.id, p.rider_id, new Date().toISOString());
        if (r.ok) settled++;
        else unresolved++;
      } else if (['failed', 'expired', 'voided'].includes(status.data.status)) {
        const mapped = status.data.status === 'failed' ? 'failed' : status.data.status === 'expired' ? 'expired' : 'cancelled';
        await markPaymentFailed(p.id, p.rider_id, mapped);
        failed++;
      } else {
        unresolved++;
      }
    }
    return { settled, failed, unresolved };
  });

  return NextResponse.json(result);
}
