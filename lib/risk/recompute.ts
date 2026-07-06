import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { localDateString } from '@/lib/dates/tz';
import { computeRisk, type RiskLevel } from './scoring';

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

  const { data: obs } = await admin
    .from('payment_obligations')
    .select('due_date, amount_due, status')
    .eq('rider_id', riderId);
  const rows = ((obs ?? []) as { due_date: string; amount_due: number; status: string }[]).sort((a, b) =>
    a.due_date < b.due_date ? -1 : 1,
  );

  const overdueLast30 = rows.filter((o) => o.status === 'overdue' && o.due_date >= thirtyAgo && o.due_date < today).length;
  const arrearsAmount = rows
    .filter((o) => o.due_date < today && UNPAID.has(o.status))
    .reduce((s, o) => s + o.amount_due, 0);

  let consecutiveMisses = 0;
  for (const o of [...rows].filter((o) => o.due_date <= today).reverse()) {
    if (o.status === 'overdue' || (o.status === 'due' && o.due_date < today)) consecutiveMisses++;
    else if (o.status === 'paid' || o.status === 'paid_in_advance') break;
    else if (UNPAID.has(o.status)) continue;
    else break;
  }

  const result = computeRisk({ overdueLast30, consecutiveMisses, arrearsAmount });
  await admin.from('riders').update({ risk_level: result.level, risk_reasons: result.reasons }).eq('id', riderId);
  await admin.from('risk_snapshots').insert({ rider_id: riderId, level: result.level, reasons: result.reasons });
  return result.level;
}
