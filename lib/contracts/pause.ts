import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import { planPostponements } from '@/lib/loans/lease-pause';
import { releaseContractMotorcycle, type ReleaseOutcome } from '@/lib/assignments/release';

/*
 * Pausing a contract (client feedback 2026-10-29, D-055).
 *
 * "If a contract is paused by the owner the motorbike should be free to be
 *  given to someone else" and "I paused Victor but his debt keeps going up."
 *
 * A pause used to flip contracts.status and nothing else: the motorcycle stayed
 * assigned and the nightly sweep kept turning the rider's days overdue. A pause
 * now does three things:
 *
 *   1. records `paused_from` — the first day the pause covers;
 *   2. releases the motorcycle back to the fleet (D-050's helper), so it can be
 *      leased to another rider while this one is off;
 *   3. POSTPONES every lease day that falls inside the pause to the end of the
 *      calendar, one at a time as the days arrive (the phone-loan pause model,
 *      D-043): nothing forgiven, nothing invented, the lease just runs longer.
 *      Arrears from BEFORE the pause stay owed — the DB function refuses to
 *      move them.
 *
 * Plain server module (not 'use server'): it is called from actions and the
 * cron that have already checked permission, and must never be reachable from
 * the browser on its own.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type PauseOutcome = {
  postponed: number;
  failures: number;
  motorcycle: ReleaseOutcome | null;
};

/**
 * Postpone the lease days of ONE paused contract that have arrived (due date
 * on or before today) and fall on or after `paused_from`. Idempotent: a second
 * run finds nothing left to move.
 */
export async function postponePausedDays(
  admin: Admin,
  contractId: string,
  today: string = localDateString(),
): Promise<{ postponed: number; failures: number }> {
  const { data: row, error: cErr } = await admin
    .from('contracts')
    .select('id, status, paused_from, schedule_type, selected_weekdays, payment_deadline_time')
    .eq('id', contractId)
    .maybeSingle();
  if (cErr) throw new Error(`pause contract read failed: ${cErr.message}`);
  const c = row as {
    status: string;
    paused_from: string | null;
    schedule_type: string;
    selected_weekdays: number[] | null;
    payment_deadline_time: string | null;
  } | null;
  if (!c || c.status !== 'paused' || !c.paused_from) return { postponed: 0, failures: 0 };

  const { data: arrivingRows, error: aErr } = await admin
    .from('payment_obligations')
    .select('id, due_date')
    .eq('contract_id', contractId)
    .eq('kind', 'lease')
    .in('status', ['scheduled', 'due', 'overdue'])
    .gte('due_date', c.paused_from)
    .lte('due_date', today)
    .order('due_date', { ascending: true });
  if (aErr) throw new Error(`pause obligations read failed: ${aErr.message}`);
  const arriving = (arrivingRows ?? []) as { id: string; due_date: string }[];
  if (arriving.length === 0) return { postponed: 0, failures: 0 };

  const existing = await fetchAllPages<{ due_date: string }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('due_date')
        .eq('contract_id', contractId)
        .order('due_date', { ascending: true })
        .range(from, to),
    { label: 'contract-pause existing dates' },
  );
  const taken = new Set(existing.map((o) => o.due_date));
  const lastDate = existing.length ? existing[existing.length - 1]!.due_date : today;

  const plan = planPostponements(
    arriving.map((o) => o.id),
    lastDate,
    { scheduleType: c.schedule_type, selectedWeekdays: c.selected_weekdays },
    taken,
  );

  const deadline = (c.payment_deadline_time ?? '18:00').slice(0, 5);
  let postponed = 0;
  let failures = 0;
  for (const step of plan) {
    const { error } = await admin.rpc('postpone_day_for_contract_pause', {
      p_obligation_id: step.obligationId,
      p_new_date: step.newDate,
      p_due_at: new Date(`${step.newDate}T${deadline}:00+03:00`).toISOString(),
      p_local_due_time: `${deadline}:00`,
    });
    if (error) {
      // Per-day best effort (a day reserved by an in-flight payment cannot
      // move); the rest still do, and the next run retries.
      console.error('[contracts] pause postpone failed:', step.obligationId, error.message);
      failures++;
      continue;
    }
    postponed++;
  }
  return { postponed, failures };
}

/**
 * Pause an ACTIVE contract: record where the pause starts, free the
 * motorcycle, and move the days that have already arrived inside the pause.
 * Returns null when the contract was not active (nothing changed).
 */
export async function pauseContract(
  admin: Admin,
  contractId: string,
  opts: { pausedFrom?: string; reason: string },
): Promise<PauseOutcome | null> {
  const today = localDateString();
  const pausedFrom = opts.pausedFrom && opts.pausedFrom <= today ? opts.pausedFrom : today;

  const { data: changed, error } = await admin
    .from('contracts')
    .update({ status: 'paused', paused_from: pausedFrom })
    .eq('id', contractId)
    .eq('status', 'active')
    .select('id, rider_id, motorcycle_id');
  if (error) throw new Error(`pause update failed: ${error.message}`);
  const c = (changed ?? [])[0] as { rider_id: string; motorcycle_id: string | null } | undefined;
  if (!c) return null;

  let motorcycle: ReleaseOutcome | null = null;
  try {
    motorcycle = await releaseContractMotorcycle(admin, {
      contractId,
      riderId: c.rider_id,
      motorcycleId: c.motorcycle_id,
      endDate: today,
      reason: opts.reason,
    });
  } catch (e) {
    console.error('[contracts] motorcycle release on pause failed:', contractId, (e as Error).message);
  }

  const { postponed, failures } = await postponePausedDays(admin, contractId, today);
  return { postponed, failures, motorcycle };
}
