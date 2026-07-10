import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, clientEnv } from '@/lib/env';
import { localDateString } from '@/lib/dates/tz';
import { computeObligationTransitions, type TransitionObligation } from '@/lib/obligations/transitions';
import { notifyRider, notifyOwner } from '@/lib/notifications/service';
import { getPaymentStatus } from '@/lib/snippe/client';
import { settlePaymentCompleted, markPaymentFailed } from '@/lib/payments/settle';
import { processOutbox } from '@/lib/messaging/outbox';
import { recomputeRiskForRider } from '@/lib/risk/recompute';
import { computeOwnerKpis, type KpiObligation } from '@/lib/dashboard/kpis';
import { composeDailySummaryHtml } from '@/lib/resend/summary';
import { sendEmail } from '@/lib/resend/client';

/*
 * Scheduled-job task bodies (spec §27), shared by the per-job cron routes and
 * the single daily dispatcher (/api/cron/daily — Vercel Hobby allows only
 * daily cron invocations). Every task is idempotent and returns the counts
 * that runJob() records in system_job_runs.
 */
export type CronTask = () => Promise<Record<string, number>>;

/** Deadline processor (spec §11.4): scheduled→due and unpaid→overdue. */
export const obligationStatusTask: CronTask = async () => {
  const admin = createAdminClient();
  const today = localDateString();
  const nowMs = Date.now();

  // Transitions only ever touch obligations whose due date has arrived —
  // without the due_date filter this query pulls the ENTIRE future calendar
  // and the row cap silently drops an arbitrary subset (including today's
  // actionable rows) once contracts × days exceed it.
  const { data } = await admin
    .from('payment_obligations')
    .select('id, rider_id, due_date, due_at, status')
    .in('status', ['scheduled', 'due'])
    .lte('due_date', today)
    .order('due_date', { ascending: true })
    .limit(10000);
  const rows = (data ?? []) as { id: string; rider_id: string; due_date: string; due_at: string; status: string }[];

  const obligations: TransitionObligation[] = rows.map((o) => ({
    id: o.id,
    dueDate: o.due_date,
    dueAtUtcMs: Date.parse(o.due_at),
    status: o.status,
  }));
  const { toDue: toDueCandidates, toOverdue: toOverdueCandidates } =
    computeObligationTransitions(obligations, nowMs, today);
  const riderOf = new Map(rows.map((o) => [o.id, o.rider_id]));

  // Status predicates guard against the select→update race: a payment can
  // settle an obligation between our read and this write, and a blanket
  // update would flip a PAID obligation back to due/overdue.
  let toDue: string[] = [];
  let toOverdue: string[] = [];
  if (toDueCandidates.length) {
    const { data: updated } = await admin
      .from('payment_obligations')
      .update({ status: 'due' })
      .in('id', toDueCandidates)
      .eq('status', 'scheduled')
      .select('id');
    toDue = ((updated ?? []) as { id: string }[]).map((o) => o.id);
  }
  if (toOverdueCandidates.length) {
    const { data: updated } = await admin
      .from('payment_obligations')
      .update({ status: 'overdue' })
      .in('id', toOverdueCandidates)
      .in('status', ['scheduled', 'due'])
      .select('id');
    toOverdue = ((updated ?? []) as { id: string }[]).map((o) => o.id);
  }

  // Rider reminders (deduped so repeated runs don't spam). Best-effort: the
  // status flips above are already committed, so a notify failure mid-loop
  // must not abort the job — the remaining riders would never be notified
  // (re-runs re-select zero updated rows).
  let notifyErrors = 0;
  for (const id of toDue) {
    try {
      await notifyRider(riderOf.get(id)!, {
        type: 'payment_due',
        title: 'Malipo ya leo',
        body: 'Kumbuka kulipa malipo ya leo kabla ya muda.',
        deepLink: '/rider/pay',
        dedupeKey: `payment_due:${id}`,
      });
    } catch {
      notifyErrors++;
    }
  }
  for (const id of toOverdue) {
    try {
      await notifyRider(riderOf.get(id)!, {
        type: 'payment_overdue',
        title: 'Una deni',
        body: 'Malipo yako yamechelewa. Tafadhali lipa haraka.',
        deepLink: '/rider/pay',
        dedupeKey: `payment_overdue:${id}:${today}`,
      });
    } catch {
      notifyErrors++;
    }
  }

  // Owner overdue digest (once per day).
  if (toOverdue.length > 0) {
    await notifyOwner({
      type: 'owner_overdue_digest',
      title: 'Waendeshaji wenye madeni',
      body: `${toOverdue.length} obligation(s) became overdue today.`,
      deepLink: '/owner',
      dedupeKey: `owner_overdue_digest:${today}`,
    });
  }

  return { due: toDue.length, overdue: toOverdue.length, notifyErrors };
};

/** Pending Snippe reconciliation (spec §12.5): resolves missed webhooks. */
export const reconcilePendingTask: CronTask = async () => {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString(); // > 30 min old

  const { data } = await admin
    .from('payments')
    .select('id, rider_id, amount, snippe_reference')
    .eq('status', 'pending')
    .not('snippe_reference', 'is', null)
    .lt('created_at', cutoff)
    .limit(50);

  let settled = 0;
  let failed = 0;
  let unresolved = 0;

  for (const p of (data ?? []) as { id: string; rider_id: string; amount: number; snippe_reference: string }[]) {
    const status = await getPaymentStatus(p.snippe_reference);
    if (!status.ok) {
      unresolved++;
      continue;
    }
    if (status.data.status === 'completed') {
      // Same amount guard as the webhook path: never settle a payment whose
      // provider amount disagrees with the local row.
      if (status.data.amountValue !== p.amount) {
        unresolved++;
        continue;
      }
      const r = await settlePaymentCompleted(p.id, p.rider_id, new Date().toISOString());
      if (r.ok) settled++;
      else unresolved++;
    } else if (['failed', 'expired', 'voided'].includes(status.data.status)) {
      const mapped = status.data.status === 'failed' ? 'failed' : status.data.status === 'expired' ? 'expired' : 'cancelled';
      await markPaymentFailed(p.id, p.rider_id, mapped);
      failed++;
    } else {
      unresolved++;
    }
  }
  return { settled, failed, unresolved };
};

/** Release expired reservations / fail stale created payments (spec §12.5). */
export const reservationCleanupTask: CronTask = async () => {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 60 * 60_000).toISOString();

  // First fail stale 'created' payments that never reached the provider, so
  // their reservations become releasable below.
  const { data: failed } = await admin
    .from('payments')
    .update({ status: 'failed' })
    .eq('status', 'created')
    .lt('created_at', staleCutoff)
    .select('id');

  // Release expired reservations ONLY for payments in a terminal state. A
  // still-pending payment keeps its reservations: they are the record of
  // which obligations it covers, and freeing them early would let another
  // payment settle the same obligations while the first can still complete.
  const { data: expired } = await admin
    .from('payment_reservations')
    .select('id, payments!inner(status)')
    .eq('is_active', true)
    .lt('expires_at', now)
    .limit(1000);
  const terminal = new Set(['failed', 'expired', 'cancelled', 'completed', 'reversed']);
  const releasable = ((expired ?? []) as unknown as { id: string; payments: { status: string } }[])
    .filter((r) => terminal.has(r.payments.status))
    .map((r) => r.id);
  let released = 0;
  if (releasable.length) {
    const { data: rel } = await admin
      .from('payment_reservations')
      .update({ is_active: false })
      .in('id', releasable)
      .select('id');
    released = (rel ?? []).length;
  }

  return { reservationsReleased: released, paymentsFailed: (failed ?? []).length };
};

/** Message outbox delivery (spec §27). */
export const outboxTask: CronTask = async () => processOutbox();

/** Daily risk recalculation for active riders (spec §20). */
export const riskRecalcTask: CronTask = async () => {
  const admin = createAdminClient();
  const { data } = await admin.from('riders').select('id').eq('status', 'active').limit(2000);
  let count = 0;
  for (const r of (data ?? []) as { id: string }[]) {
    await recomputeRiskForRider(r.id);
    count++;
  }
  return { riders: count };
};

/** Data-quality checks (spec §32). */
export const dataQualityTask: CronTask = async () => {
  const admin = createAdminClient();

  // Fetch allocations once (payment + obligation links + amount).
  const { data: allocs } = await admin
    .from('payment_allocations')
    .select('payment_id, obligation_id, amount')
    .limit(50000);
  const allocations = (allocs ?? []) as { payment_id: string; obligation_id: string; amount: number }[];

  // 1. Completed payments whose allocations don't sum to the amount.
  const { data: completed } = await admin.from('payments').select('id, amount').eq('status', 'completed').limit(10000);
  const sumByPayment = new Map<string, number>();
  for (const a of allocations) sumByPayment.set(a.payment_id, (sumByPayment.get(a.payment_id) ?? 0) + a.amount);
  let allocationMismatch = 0;
  for (const p of (completed ?? []) as { id: string; amount: number }[]) {
    if ((sumByPayment.get(p.id) ?? 0) !== p.amount) allocationMismatch++;
  }

  // 2. Active assignments whose motorcycle isn't marked assigned.
  const { data: activeAssignments } = await admin
    .from('motorcycle_assignments')
    .select('motorcycle_id, motorcycles(status)')
    .eq('is_active', true)
    .limit(5000);
  let orphanedAssignments = 0;
  for (const a of (activeAssignments ?? []) as unknown as { motorcycles: { status: string } | null }[]) {
    if (a.motorcycles?.status !== 'assigned') orphanedAssignments++;
  }

  // 3. Settled obligations with no allocation.
  const { data: settled } = await admin
    .from('payment_obligations')
    .select('id')
    .in('status', ['paid', 'paid_in_advance'])
    .limit(50000);
  const allocatedObligationIds = new Set(allocations.map((a) => a.obligation_id));
  let settledWithoutAllocation = 0;
  for (const o of (settled ?? []) as { id: string }[]) {
    if (!allocatedObligationIds.has(o.id)) settledWithoutAllocation++;
  }

  const counts = { allocationMismatch, orphanedAssignments, settledWithoutAllocation };
  const total = allocationMismatch + orphanedAssignments + settledWithoutAllocation;
  if (total > 0) {
    await notifyOwner({
      type: 'data_quality_alert',
      title: 'Data quality issues detected',
      body: `Mismatched allocations: ${allocationMismatch}, orphaned assignments: ${orphanedAssignments}, settled w/o allocation: ${settledWithoutAllocation}.`,
      deepLink: '/owner/system',
      dedupeKey: `data_quality:${localDateString()}`,
    });
  }
  return counts;
};

/** Daily owner summary via Resend (spec §18.1). Idempotent per date. */
export const dailySummaryTask: CronTask = async (): Promise<Record<string, number>> => {
  const admin = createAdminClient();
  // The dispatcher fires at 00:00 EAT — the day worth summarizing is the one
  // that just ENDED. Using the minute-old new day would permanently report
  // zero collections (and the idempotency row would lock that in all day).
  const summaryDate = localDateString(new Date(Date.now() - 86_400_000));
  const dayStartUtc = new Date(`${summaryDate}T00:00:00+03:00`).toISOString();
  const dayEndUtc = new Date(Date.parse(`${summaryDate}T00:00:00+03:00`) + 86_400_000).toISOString();

  const [{ data: obs }, { data: pays }, { data: pendingRows }, { data: appsRows }] = await Promise.all([
    // Only rows the KPI math actually uses: still-unpaid history (arrears) and
    // everything due on the summary day — NOT all paid history, which would
    // blow past the row cap within months and silently skew every number.
    admin
      .from('payment_obligations')
      .select('rider_id, due_date, amount_due, status')
      .lte('due_date', summaryDate)
      .or(`status.in.(scheduled,due,overdue),due_date.eq.${summaryDate}`)
      .limit(10000),
    admin.from('payments').select('amount, status, method').eq('status', 'completed').gte('completed_at', dayStartUtc).lt('completed_at', dayEndUtc),
    admin.from('payments').select('id').eq('status', 'pending'),
    admin.from('rider_applications').select('id').in('status', ['submitted', 'under_review', 'interview', 'verification']),
  ]);

  const obligations: KpiObligation[] = (
    (obs ?? []) as { rider_id: string; due_date: string; amount_due: number; status: string }[]
  ).map((o) => ({ riderId: o.rider_id, dueDate: o.due_date, amountDue: o.amount_due, status: o.status }));
  const paymentsToday = ((pays ?? []) as { amount: number; status: string; method: string }[]).map((p) => ({
    amount: p.amount,
    status: p.status,
    method: p.method,
    completedDate: summaryDate,
  }));
  const kpis = computeOwnerKpis(obligations, paymentsToday, summaryDate);
  const cashToday = paymentsToday.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const mobileToday = paymentsToday.filter((p) => p.method === 'mobile_money').reduce((s, p) => s + p.amount, 0);

  const metrics = {
    date: summaryDate,
    expectedToday: kpis.expectedToday,
    settledToday: kpis.settledToday,
    collectedToday: kpis.collectedToday,
    cashToday,
    mobileToday,
    outstandingToday: kpis.outstandingToday,
    collectionRate: kpis.collectionRate,
    totalArrears: kpis.totalArrears,
    paidRiders: kpis.paidRiders,
    unpaidRiders: kpis.unpaidRiders,
    pendingPayments: (pendingRows ?? []).length,
    applicationsAwaiting: (appsRows ?? []).length,
    appUrl: clientEnv.NEXT_PUBLIC_APP_URL,
  };

  // Idempotency: insert-or-skip on the date. Any non-duplicate insert error
  // must abort — sending the email without a summary row means every retry
  // in that state would re-send it.
  const { error: insErr } = await admin
    .from('daily_summaries')
    .insert({ summary_date: summaryDate, metrics, idempotency_key: `daily:${summaryDate}` });
  if (insErr) {
    if (insErr.code !== '23505' && !/duplicate key/i.test(insErr.message)) {
      throw new Error(`summary_insert_failed: ${insErr.message}`);
    }
    const { data: existing } = await admin.from('daily_summaries').select('email_sent_at').eq('summary_date', summaryDate).maybeSingle();
    if ((existing as { email_sent_at: string | null } | null)?.email_sent_at) {
      return { emailed: 0, skipped: 1 };
    }
  }

  const to = serverEnv().OWNER_SUMMARY_EMAIL;
  if (!to) return { emailed: 0, no_recipient: 1 };
  const res = await sendEmail({ to, subject: `Ng'umbi Riders — Daily Summary ${summaryDate}`, html: composeDailySummaryHtml(metrics) });
  if (res.ok) {
    await admin.from('daily_summaries').update({ email_sent_at: new Date().toISOString() }).eq('summary_date', summaryDate);
    return { emailed: 1 };
  }
  if (res.error === 'not_configured') return { emailed: 0, not_configured: 1 };
  // The email IS this job's deliverable — a send failure must surface as a
  // failed run in system_job_runs, not a green "success" with error: 1.
  throw new Error(`summary_email_failed: ${res.error}`);
};

/**
 * All tasks in daily-dispatch order (midnight EAT): flip statuses for the new
 * day first, resolve pending payments, then clean up, score risk, check data
 * quality, send the summary and flush the outbox.
 */
export const DAILY_TASKS: [name: string, task: CronTask][] = [
  ['obligation-status', obligationStatusTask],
  ['reconcile-pending', reconcilePendingTask],
  ['reservation-cleanup', reservationCleanupTask],
  ['risk-recalc', riskRecalcTask],
  ['data-quality', dataQualityTask],
  ['daily-summary', dailySummaryTask],
  ['outbox', outboxTask],
];
