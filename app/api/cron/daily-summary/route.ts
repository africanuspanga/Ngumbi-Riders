import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { dailySummaryTask } from '@/lib/jobs/tasks';

// Daily owner summary via Resend (spec §18.1). Idempotent per date. On Hobby
// this runs inside /api/cron/daily; this route remains for manual triggering.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('daily-summary', dailySummaryTask));
}
