import { NextResponse } from 'next/server';
import { authorizeCron, runJob } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase/admin';
import { localDateString } from '@/lib/dates/tz';
import { computeObligationTransitions, type TransitionObligation } from '@/lib/obligations/transitions';
import { notifyRider, notifyOwner } from '@/lib/notifications/service';

// Deadline processor (spec §11.4). Frequent cron: flips scheduled→due and
// unpaid→overdue past the deadline, generates rider reminders and an owner
// overdue digest. Idempotent (dedupe keys + status guards).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!authorizeCron(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await runJob('obligation-status', async () => {
    const admin = createAdminClient();
    const today = localDateString();
    const nowMs = Date.now();

    const { data } = await admin
      .from('payment_obligations')
      .select('id, rider_id, due_date, due_at, status')
      .in('status', ['scheduled', 'due'])
      .limit(10000);
    const rows = (data ?? []) as { id: string; rider_id: string; due_date: string; due_at: string; status: string }[];

    const obligations: TransitionObligation[] = rows.map((o) => ({
      id: o.id,
      dueDate: o.due_date,
      dueAtUtcMs: Date.parse(o.due_at),
      status: o.status,
    }));
    const { toDue, toOverdue } = computeObligationTransitions(obligations, nowMs, today);
    const riderOf = new Map(rows.map((o) => [o.id, o.rider_id]));

    if (toDue.length) await admin.from('payment_obligations').update({ status: 'due' }).in('id', toDue);
    if (toOverdue.length) await admin.from('payment_obligations').update({ status: 'overdue' }).in('id', toOverdue);

    // Rider reminders (deduped so repeated runs don't spam).
    for (const id of toDue) {
      await notifyRider(riderOf.get(id)!, {
        type: 'payment_due',
        title: 'Malipo ya leo',
        body: 'Kumbuka kulipa malipo ya leo kabla ya muda.',
        deepLink: '/rider/pay',
        dedupeKey: `payment_due:${id}`,
      });
    }
    for (const id of toOverdue) {
      await notifyRider(riderOf.get(id)!, {
        type: 'payment_overdue',
        title: 'Una deni',
        body: 'Malipo yako yamechelewa. Tafadhali lipa haraka.',
        deepLink: '/rider/pay',
        dedupeKey: `payment_overdue:${id}:${today}`,
      });
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

    return { due: toDue.length, overdue: toOverdue.length };
  });

  return NextResponse.json(result);
}
