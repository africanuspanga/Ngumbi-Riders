import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { reconcilePendingTask } from '@/lib/jobs/tasks';

// Pending Snippe reconciliation (spec §12.5). On Hobby this runs inside
// /api/cron/daily; this route remains for manual triggering.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await runJob('reconcile-pending', reconcilePendingTask));
}
