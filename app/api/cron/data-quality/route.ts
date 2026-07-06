import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOwner } from '@/lib/notifications/service';

// Data-quality checks (spec §32): allocation mismatches, orphaned active
// assignments, and settled obligations without an allocation. Reports counts to
// system_job_runs and alerts the owner if anything is found.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runJob('data-quality', async () => {
    const admin = createAdminClient();

    // Fetch allocations once (payment + obligation links + amount).
    const { data: allocs } = await admin
      .from('payment_allocations')
      .select('payment_id, obligation_id, amount')
      .limit(50000);
    const allocations = (allocs ?? []) as { payment_id: string; obligation_id: string; amount: number }[];

    // 1. Completed payments whose allocations don't sum to the amount.
    const { data: completed } = await admin.from('payments').select('id, amount').eq('status', 'completed').limit(10000);
    const sumByPayment = new Map<string, number>();
    for (const a of allocations) sumByPayment.set(a.payment_id, (sumByPayment.get(a.payment_id) ?? 0) + a.amount);
    let allocationMismatch = 0;
    for (const p of (completed ?? []) as { id: string; amount: number }[]) {
      if ((sumByPayment.get(p.id) ?? 0) !== p.amount) allocationMismatch++;
    }

    // 2. Active assignments whose motorcycle isn't marked assigned.
    const { data: activeAssignments } = await admin
      .from('motorcycle_assignments')
      .select('motorcycle_id, motorcycles(status)')
      .eq('is_active', true)
      .limit(5000);
    let orphanedAssignments = 0;
    for (const a of (activeAssignments ?? []) as unknown as { motorcycles: { status: string } | null }[]) {
      if (a.motorcycles?.status !== 'assigned') orphanedAssignments++;
    }

    // 3. Settled obligations with no allocation.
    const { data: settled } = await admin
      .from('payment_obligations')
      .select('id')
      .in('status', ['paid', 'paid_in_advance'])
      .limit(50000);
    const allocatedObligationIds = new Set(allocations.map((a) => a.obligation_id));
    let settledWithoutAllocation = 0;
    for (const o of (settled ?? []) as { id: string }[]) {
      if (!allocatedObligationIds.has(o.id)) settledWithoutAllocation++;
    }

    const counts = { allocationMismatch, orphanedAssignments, settledWithoutAllocation };
    const total = allocationMismatch + orphanedAssignments + settledWithoutAllocation;
    if (total > 0) {
      await notifyOwner({
        type: 'data_quality_alert',
        title: 'Data quality issues detected',
        body: `Mismatched allocations: ${allocationMismatch}, orphaned assignments: ${orphanedAssignments}, settled w/o allocation: ${settledWithoutAllocation}.`,
        deepLink: '/owner/system',
        dedupeKey: `data_quality:${new Date().toISOString().slice(0, 10)}`,
      });
    }
    return counts;
  });

  return NextResponse.json(result);
}
