import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { DAILY_TASKS } from '@/lib/jobs/tasks';

/*
 * Single daily cron dispatcher. Vercel Hobby only invokes crons once per day,
 * so this endpoint runs every job in sequence (midnight EAT = 21:00 UTC, see
 * vercel.json). Each job still records its own system_job_runs row, and a job
 * failure doesn't stop the ones after it. The per-job routes remain for
 * manual triggering and for a future Pro plan with frequent schedules.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const results: Record<string, { ok: boolean; counts: Record<string, number>; error?: string }> = {};
  for (const [name, task] of DAILY_TASKS) {
    results[name] = await runJob(name, task);
  }
  const ok = Object.values(results).every((r) => r.ok);
  return NextResponse.json({ ok, results });
}
