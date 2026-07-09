import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { obligationStatusTask } from '@/lib/jobs/tasks';

// Deadline processor (spec §11.4). On Hobby this runs inside /api/cron/daily;
// this route remains for manual triggering / frequent schedules on Pro.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('obligation-status', obligationStatusTask));
}
