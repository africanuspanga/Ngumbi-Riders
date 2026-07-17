import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/fetch-all';
import { localDateString } from '@/lib/dates/tz';
import { computeRisk, scaleThresholdsForInstalment, type RiskLevel } from './scoring';

/*
 * Shared risk recomputation (spec §20) used by the owner action and the daily
 * risk cron. Reads a rider's obligations, derives the risk inputs, and persists
 * the level + explainable reasons plus a risk_snapshots row.
 */
const UNPAID = new Set(['scheduled', 'due', 'overdue']);

export async function recomputeRiskForRider(riderId: string): Promise<RiskLevel> {
  const admin = createAdminClient();
  const today = localDateString();
  const thirtyAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);

  const rows = await fetchAllPages<{ due_date: string; amount_due: number; status: string }>(
    (from, to) =>
      admin
        .from('payment_obligations')
        .select('due_date, amount_due, status')
        .eq('rider_id', riderId)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'risk obligations' },
  );

  // Misses are DATE-derived (past due date + still unpaid), not read from the
  // status enum — so the risk signal cannot go blind if a status-transition
  // job falls behind (the pilot ran weeks with past rows stuck 'scheduled',
  // which made status-based counting report a healthy fleet).
  const isMissed = (o: { due_date: string; status: string }) => o.due_date < today && UNPAID.has(o.status);
  const overdueLast30 = rows.filter((o) => isMissed(o) && o.due_date >= thirtyAgo).length;
  const arrearsAmount = rows.filter(isMissed).reduce((s, o) => s + o.amount_due, 0);

  // Trailing run of missed obligations, newest first. Exempted / postponed /
  // cancelled days are neutral (skipped); the run breaks at the first paid one.
  let consecutiveMisses = 0;
  for (const o of [...rows].reverse()) {
    if (o.due_date >= today) continue; // today/future: not missable yet
    if (isMissed(o)) consecutiveMisses++;
    else if (o.status === 'paid' || o.status === 'paid_in_advance') break;
    else continue; // exempted / postponed / cancelled — neutral
  }

  // Arrears thresholds scale with the contract's instalment size: fixed TZS
  // cliffs calibrated for ~10k daily instalments would flag a monthly rider
  // (e.g. 250k/month) critical ONE day after their first due date.
  const { data: contract } = await admin
    .from('contracts')
    .select('installment_amount')
    .eq('rider_id', riderId)
    .eq('status', 'active')
    .maybeSingle();
  const instalment = (contract as { installment_amount: number } | null)?.installment_amount ?? 0;

  const result = computeRisk(
    { overdueLast30, consecutiveMisses, arrearsAmount },
    scaleThresholdsForInstalment(instalment),
  );
  await admin.from('riders').update({ risk_level: result.level, risk_reasons: result.reasons }).eq('id', riderId);
  await admin.from('risk_snapshots').insert({ rider_id: riderId, level: result.level, reasons: result.reasons });
  return result.level;
}
