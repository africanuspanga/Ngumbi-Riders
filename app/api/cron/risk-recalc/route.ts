import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { riskRecalcTask } from '@/lib/jobs/tasks';

// Daily risk recalculation for active riders (spec §20, §27). On Hobby this
// runs inside /api/cron/daily; this route remains for manual triggering.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('risk-recalc', riskRecalcTask));
}
