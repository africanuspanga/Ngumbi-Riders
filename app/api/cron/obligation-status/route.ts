import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { obligationStatusTask } from '@/lib/jobs/tasks';

// Deadline processor (spec §11.4). On Hobby this runs inside /api/cron/daily;
// this route remains for manual triggering / frequent schedules on Pro.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Same budget as the daily dispatcher — a manual trigger of a long task must
// not die at the platform's short default timeout mid-run.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('obligation-status', obligationStatusTask));
}
