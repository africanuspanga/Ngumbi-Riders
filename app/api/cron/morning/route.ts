import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { MORNING_TASKS } from '@/lib/jobs/tasks';

/*
 * Morning cron dispatcher (08:00 EAT = 05:00 UTC, see vercel.json) for jobs
 * that TEXT people: late-payment reminders and the owner's summary. Kept off
 * the midnight dispatcher on purpose — an SMS at 00:05 is a complaint, not a
 * reminder. Same authorisation and run recording as /api/cron/daily.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const results: Record<string, { ok: boolean; counts: Record<string, number>; error?: string }> = {};
  for (const [name, task] of MORNING_TASKS) {
    results[name] = await runJob(name, task);
  }
  const ok = Object.values(results).every((r) => r.ok);
  return NextResponse.json({ ok, results });
}
