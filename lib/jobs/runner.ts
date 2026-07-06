import 'server-only';

import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

/*
 * Scheduled-job infrastructure (spec §27). Every job records a run in
 * system_job_runs (started, completed, status, counts) and must be idempotent.
 * Cron endpoints are authorized with the shared CRON_SECRET — on Vercel Cron
 * this arrives as `Authorization: Bearer <CRON_SECRET>`.
 */
export function authorizeCron(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export type JobResult = { ok: boolean; counts: Record<string, number>; error?: string };

export async function runJob(
  jobName: string,
  fn: () => Promise<Record<string, number>>,
): Promise<JobResult> {
  const admin = createAdminClient();
  const { data: run } = await admin
    .from('system_job_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single();
  const runId = (run as { id: string } | null)?.id;

  try {
    const counts = await fn();
    if (runId) {
      await admin
        .from('system_job_runs')
        .update({ status: 'success', completed_at: new Date().toISOString(), counts })
        .eq('id', runId);
    }
    return { ok: true, counts };
  } catch (e) {
    const error = (e as Error).message;
    if (runId) {
      await admin
        .from('system_job_runs')
        .update({ status: 'failed', completed_at: new Date().toISOString(), error_summary: error })
        .eq('id', runId);
    }
    return { ok: false, counts: {}, error };
  }
}
