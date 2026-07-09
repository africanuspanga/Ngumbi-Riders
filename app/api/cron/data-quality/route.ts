import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { dataQualityTask } from '@/lib/jobs/tasks';

// Data-quality checks (spec §32). On Hobby this runs inside /api/cron/daily;
// this route remains for manual triggering.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('data-quality', dataQualityTask));
}
