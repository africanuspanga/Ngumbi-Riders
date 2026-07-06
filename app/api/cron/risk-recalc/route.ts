import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase/admin';
import { recomputeRiskForRider } from '@/lib/risk/recompute';

// Daily risk recalculation for active riders (spec §20, §27).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runJob('risk-recalc', async () => {
    const admin = createAdminClient();
    const { data } = await admin.from('riders').select('id').eq('status', 'active').limit(2000);
    let count = 0;
    for (const r of (data ?? []) as { id: string }[]) {
      await recomputeRiskForRider(r.id);
      count++;
    }
    return { riders: count };
  });

  return NextResponse.json(result);
}
