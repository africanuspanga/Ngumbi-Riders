import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { isSnippeConfigured } from '@/lib/snippe/client';
import { isResendConfigured } from '@/lib/resend/client';
import { isPushConfigured } from '@/lib/push/webpush';

export type JobRunRow = {
  job_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  counts: Record<string, number>;
  error_summary: string | null;
};

export type SystemHealth = {
  integrations: { snippe: boolean; resend: boolean; push: boolean };
  lastWebhookAt: string | null;
  pendingPayments: number;
  lastReconciliationAt: string | null;
  lastDailySummaryAt: string | null;
  failedJobs: number;
  recentRuns: JobRunRow[];
};

export async function getSystemHealth(): Promise<SystemHealth> {
  const supabase = await createServerSupabase();

  const [{ data: lastEvent }, { data: pending }, { data: runs }, { data: lastSummary }, { data: failed }] =
    await Promise.all([
      supabase.from('payment_events').select('received_at').order('received_at', { ascending: false }).limit(1),
      supabase.from('payments').select('id').eq('status', 'pending'),
      supabase.from('system_job_runs').select('job_name, status, started_at, completed_at, counts, error_summary').order('started_at', { ascending: false }).limit(30),
      supabase.from('daily_summaries').select('email_sent_at').not('email_sent_at', 'is', null).order('summary_date', { ascending: false }).limit(1),
      supabase.from('system_job_runs').select('id').eq('status', 'failed'),
    ]);

  const runsRows = (runs ?? []) as unknown as JobRunRow[];
  const lastReconciliation = runsRows.find((r) => r.job_name === 'reconcile-pending' && r.status === 'success');

  return {
    integrations: {
      snippe: isSnippeConfigured(),
      resend: isResendConfigured(),
      push: isPushConfigured(),
    },
    lastWebhookAt: (lastEvent as { received_at: string }[] | null)?.[0]?.received_at ?? null,
    pendingPayments: (pending ?? []).length,
    lastReconciliationAt: lastReconciliation?.completed_at ?? null,
    lastDailySummaryAt: (lastSummary as { email_sent_at: string }[] | null)?.[0]?.email_sent_at ?? null,
    failedJobs: (failed ?? []).length,
    recentRuns: runsRows,
  };
}

export type AuditRow = {
  id: string;
  actor_role: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
};

export async function getAuditLog(limit = 200): Promise<AuditRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_role, action, entity_type, entity_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as AuditRow[];
}
