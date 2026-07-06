'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { localDateString } from '@/lib/dates/tz';
import { computeRisk, type RiskLevel } from './scoring';

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function assertOwner() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

const UNPAID = new Set(['scheduled', 'due', 'overdue']);

/** Recompute a rider's explainable risk from their obligations (spec §20). */
export async function recomputeRiderRisk(riderId: string): Promise<ActionResult<{ level: RiskLevel }>> {
  const ownerId = await assertOwner();
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

  // Trailing run of consecutive missed obligations up to today.
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

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'risk.recomputed',
    entityType: 'rider',
    entityId: riderId,
    metadata: { level: result.level, overdueLast30, consecutiveMisses, arrearsAmount },
  });
  revalidatePath(`/owner/riders/${riderId}`);
  return { ok: true, data: { level: result.level } };
}

/** Owner manual risk override with a note (spec §20). */
export async function setManualRisk(riderId: string, level: RiskLevel, note: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();
  const reasons = ['Owner manual override', note].filter(Boolean);
  await admin.from('riders').update({ risk_level: level, risk_reasons: reasons }).eq('id', riderId);
  await admin.from('risk_snapshots').insert({ rider_id: riderId, level, reasons });
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'risk.manual_override',
    entityType: 'rider',
    entityId: riderId,
    metadata: { level, note },
  });
  revalidatePath(`/owner/riders/${riderId}`);
  return { ok: true };
}
