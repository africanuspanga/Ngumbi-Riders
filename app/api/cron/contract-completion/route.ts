import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { contractCompletionTask } from '@/lib/jobs/tasks';

// Automatic contract completion (build spec #8). On Hobby this runs inside
// /api/cron/daily; this route exists for manual triggering and for a more
// frequent schedule on Pro.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('contract-completion', contractCompletionTask));
}
