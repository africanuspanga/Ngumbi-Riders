import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, clientEnv } from '@/lib/env';
import { localDateString } from '@/lib/dates/tz';
import { computeOwnerKpis, type KpiObligation } from '@/lib/dashboard/kpis';
import { composeDailySummaryHtml } from '@/lib/resend/summary';
import { sendEmail } from '@/lib/resend/client';

// Daily owner summary via Resend (spec §18.1), default 22:00 EAT. Idempotent:
// a daily_summaries row keyed by the date prevents duplicate emails on retry.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runJob('daily-summary', async (): Promise<Record<string, number>> => {
    const admin = createAdminClient();
    const today = localDateString();
    const todayStartUtc = new Date(`${today}T00:00:00+03:00`).toISOString();
    const tomorrowStartUtc = new Date(Date.parse(`${today}T00:00:00+03:00`) + 86_400_000).toISOString();

    const [{ data: obs }, { data: pays }, { data: pendingRows }, { data: appsRows }] = await Promise.all([
      admin.from('payment_obligations').select('rider_id, due_date, amount_due, status').lte('due_date', today).limit(10000),
      admin.from('payments').select('amount, status, method').eq('status', 'completed').gte('completed_at', todayStartUtc).lt('completed_at', tomorrowStartUtc),
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
      completedDate: today,
    }));
    const kpis = computeOwnerKpis(obligations, paymentsToday, today);
    const cashToday = paymentsToday.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    const mobileToday = paymentsToday.filter((p) => p.method === 'mobile_money').reduce((s, p) => s + p.amount, 0);

    const metrics = {
      date: today,
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
      .insert({ summary_date: today, metrics, idempotency_key: `daily:${today}` });
    if (insErr) {
      if (!/duplicate key/i.test(insErr.message)) {
        throw new Error(`summary_insert_failed: ${insErr.message}`);
      }
      const { data: existing } = await admin.from('daily_summaries').select('email_sent_at').eq('summary_date', today).maybeSingle();
      if ((existing as { email_sent_at: string | null } | null)?.email_sent_at) {
        return { emailed: 0, skipped: 1 };
      }
    }

    const to = serverEnv().OWNER_SUMMARY_EMAIL;
    if (!to) return { emailed: 0, no_recipient: 1 };
    const res = await sendEmail({ to, subject: `Ng'umbi Riders — Daily Summary ${today}`, html: composeDailySummaryHtml(metrics) });
    if (res.ok) {
      await admin.from('daily_summaries').update({ email_sent_at: new Date().toISOString() }).eq('summary_date', today);
      return { emailed: 1 };
    }
    return { emailed: 0, error: 1 };
  });

  return NextResponse.json(result);
}
