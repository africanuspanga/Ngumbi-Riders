import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, clientEnv } from '@/lib/env';
import { fetchAllPages, chunkIds } from '@/lib/supabase/fetch-all';
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
  // without the due_date filter this query pulls the ENTIRE future calendar.
  // Paginated with a stable order: PostgREST's server-side row cap (1000)
  // silently truncates ANY single select regardless of .limit(), which is how
  // this job "succeeded" nightly while transitioning nothing (D-033).
  const rows = await fetchAllPages<{
    id: string;
    rider_id: string;
    due_date: string;
    due_at: string;
    status: string;
  }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('id, rider_id, due_date, due_at, status')
        .in('status', ['scheduled', 'due'])
        .lte('due_date', today)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'obligation-status select' },
  );

  const obligations: TransitionObligation[] = rows.map((o) => ({
    id: o.id,
    dueDate: o.due_date,
    dueAtUtcMs: Date.parse(o.due_at),
    status: o.status,
  }));
  const { toDue: toDueCandidates, toOverdue: toOverdueCandidates } =
    computeObligationTransitions(obligations, nowMs, today);
  const byId = new Map(rows.map((o) => [o.id, o]));

  // Status predicates guard against the select→update race: a payment can
  // settle an obligation between our read and this write, and a blanket
  // update would flip a PAID obligation back to due/overdue. Updates are
  // CHUNKED (an .in() with ~1000 ids builds a querystring upstream proxies
  // reject outright) and every chunk's error THROWS — a failed update must
  // fail the run, never read as "0 rows updated".
  const toDue: string[] = [];
  const toOverdue: string[] = [];
  for (const ids of chunkIds(toDueCandidates)) {
    const { data: updated, error } = await admin
      .from('payment_obligations')
      .update({ status: 'due' })
      .in('id', ids)
      .eq('status', 'scheduled')
      .select('id');
    if (error) throw new Error(`toDue update failed: ${error.message}`);
    for (const o of (updated ?? []) as { id: string }[]) toDue.push(o.id);
  }
  for (const ids of chunkIds(toOverdueCandidates)) {
    const { data: updated, error } = await admin
      .from('payment_obligations')
      .update({ status: 'overdue' })
      .in('id', ids)
      .in('status', ['scheduled', 'due'])
      .select('id');
    if (error) throw new Error(`toOverdue update failed: ${error.message}`);
    for (const o of (updated ?? []) as { id: string }[]) toOverdue.push(o.id);
  }

  // Rider reminders (deduped so repeated runs don't spam). Best-effort: the
  // status flips above are already committed, so a notify failure mid-loop
  // must not abort the job — the remaining riders would never be notified
  // (re-runs re-select zero updated rows). Only RECENT transitions notify:
  // backdated contracts can flip months of history in one run (the pilot's
  // backlog was ~1,150 rows) and a notification per ancient obligation would
  // bury every rider's inbox — old rows flip silently.
  const recentCutoff = localDateString(new Date(nowMs - 2 * 86_400_000));
  const isRecent = (id: string) => (byId.get(id)?.due_date ?? '') >= recentCutoff;
  let notifyErrors = 0;
  for (const id of toDue.filter(isRecent)) {
    try {
      await notifyRider(byId.get(id)!.rider_id, {
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
  for (const id of toOverdue.filter(isRecent)) {
    try {
      await notifyRider(byId.get(id)!.rider_id, {
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

  const { data, error } = await admin
    .from('payments')
    .select('id, rider_id, amount, snippe_reference')
    .eq('status', 'pending')
    .not('snippe_reference', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new Error(`reconcile select failed: ${error.message}`);

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
  const { data: failed, error: failErr } = await admin
    .from('payments')
    .update({ status: 'failed' })
    .eq('status', 'created')
    .lt('created_at', staleCutoff)
    .select('id');
  if (failErr) throw new Error(`stale-created update failed: ${failErr.message}`);

  // Release expired reservations ONLY for payments in a terminal state. A
  // still-pending payment keeps its reservations: they are the record of
  // which obligations it covers, and freeing them early would let another
  // payment settle the same obligations while the first can still complete.
  const expired = await fetchAllPages<{ id: string; payments: { status: string } }>(
    (from, to) =>
      admin
        .from('payment_reservations')
        .select('id, payments!inner(status)')
        .eq('is_active', true)
        .lt('expires_at', now)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: { id: string; payments: { status: string } }[] | null;
        error: { message: string } | null;
      }>,
    { label: 'reservation-cleanup select' },
  );
  const terminal = new Set(['failed', 'expired', 'cancelled', 'completed', 'reversed']);
  const releasable = expired.filter((r) => terminal.has(r.payments.status)).map((r) => r.id);
  let released = 0;
  for (const ids of chunkIds(releasable)) {
    const { data: rel, error } = await admin
      .from('payment_reservations')
      .update({ is_active: false })
      .in('id', ids)
      .select('id');
    if (error) throw new Error(`reservation release failed: ${error.message}`);
    released += (rel ?? []).length;
  }

  return { reservationsReleased: released, paymentsFailed: (failed ?? []).length };
};

/** Message outbox delivery (spec §27). */
export const outboxTask: CronTask = async () => processOutbox();

/** Daily risk recalculation for active riders (spec §20). */
export const riskRecalcTask: CronTask = async () => {
  const admin = createAdminClient();
  const riders = await fetchAllPages<{ id: string }>(
    (from, to) =>
      admin.from('riders').select('id').eq('status', 'active').order('id', { ascending: true }).range(from, to),
    { label: 'risk-recalc riders' },
  );
  let count = 0;
  for (const r of riders) {
    await recomputeRiskForRider(r.id);
    count++;
  }
  return { riders: count };
};

/** Data-quality checks (spec §32). */
export const dataQualityTask: CronTask = async () => {
  const admin = createAdminClient();

  // Every set here is cross-referenced against the others, so ALL of them must
  // be COMPLETE — a capped/arbitrary subset produces false alerts (an
  // allocation outside the fetched window reads as "settled without
  // allocation") and hides real corruption. Paginated with stable order.
  const allocations = await fetchAllPages<{ payment_id: string; obligation_id: string; amount: number }>(
    (from, to) =>
      admin
        .from('payment_allocations')
        .select('payment_id, obligation_id, amount')
        .order('payment_id', { ascending: true })
        .order('obligation_id', { ascending: true })
        .range(from, to),
    { label: 'data-quality allocations' },
  );

  // 1. Completed payments whose allocations don't sum to the amount.
  const completed = await fetchAllPages<{ id: string; amount: number }>(
    (from, to) =>
      admin.from('payments').select('id, amount').eq('status', 'completed').order('id', { ascending: true }).range(from, to),
    { label: 'data-quality completed payments' },
  );
  const sumByPayment = new Map<string, number>();
  for (const a of allocations) sumByPayment.set(a.payment_id, (sumByPayment.get(a.payment_id) ?? 0) + a.amount);
  let allocationMismatch = 0;
  for (const p of completed) {
    if ((sumByPayment.get(p.id) ?? 0) !== p.amount) allocationMismatch++;
  }

  // 2. Active assignments whose motorcycle isn't marked assigned.
  const activeAssignments = await fetchAllPages<{ motorcycle_id: string; motorcycles: { status: string } | null }>(
    (from, to) =>
      admin
        .from('motorcycle_assignments')
        .select('motorcycle_id, motorcycles(status)')
        .eq('is_active', true)
        .order('motorcycle_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: { motorcycle_id: string; motorcycles: { status: string } | null }[] | null;
        error: { message: string } | null;
      }>,
    { label: 'data-quality assignments' },
  );
  let orphanedAssignments = 0;
  for (const a of activeAssignments) {
    if (a.motorcycles?.status !== 'assigned') orphanedAssignments++;
  }

  // 3. Settled obligations with no allocation.
  const settled = await fetchAllPages<{ id: string }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('id')
        .in('status', ['paid', 'paid_in_advance'])
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'data-quality settled obligations' },
  );
  const allocatedObligationIds = new Set(allocations.map((a) => a.obligation_id));
  let settledWithoutAllocation = 0;
  for (const o of settled) {
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

  // Only rows the KPI math actually uses: still-unpaid history (arrears) and
  // everything due on the summary day — NOT all paid history. Paginated: the
  // unpaid backlog alone can exceed the 1000-row PostgREST cap (it did in the
  // pilot), and a capped fetch silently skews every number in the email.
  const [obsRows, { data: pays, error: paysErr }, pendingRes, appsRes] = await Promise.all([
    fetchAllPages<{ rider_id: string; due_date: string; amount_due: number; status: string }>(
      (from, to) =>
        admin
          .from('payment_obligations')
          .select('rider_id, due_date, amount_due, status')
          .lte('due_date', summaryDate)
          .or(`status.in.(scheduled,due,overdue),due_date.eq.${summaryDate}`)
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'daily-summary obligations' },
    ),
    admin.from('payments').select('amount, status, method').eq('status', 'completed').gte('completed_at', dayStartUtc).lt('completed_at', dayEndUtc),
    admin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin
      .from('rider_applications')
      .select('id', { count: 'exact', head: true })
      .in('status', ['submitted', 'under_review', 'interview', 'verification']),
  ]);
  if (paysErr) throw new Error(`daily-summary payments failed: ${paysErr.message}`);

  const obligations: KpiObligation[] = obsRows.map((o) => ({
    riderId: o.rider_id,
    dueDate: o.due_date,
    amountDue: o.amount_due,
    status: o.status,
  }));
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
    pendingPayments: (pendingRes as { count: number | null }).count ?? 0,
    applicationsAwaiting: (appsRes as { count: number | null }).count ?? 0,
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
