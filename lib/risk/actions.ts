'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { recomputeRiskForRider } from './recompute';
import type { RiskLevel } from './scoring';

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function assertOwner() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

/** Recompute a rider's explainable risk from their obligations (spec §20). */
export async function recomputeRiderRisk(riderId: string): Promise<ActionResult<{ level: RiskLevel }>> {
  const ownerId = await assertOwner();
  const level = await recomputeRiskForRider(riderId);
  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'risk.recomputed',
    entityType: 'rider',
    entityId: riderId,
    metadata: { level },
  });
  revalidatePath(`/owner/riders/${riderId}`);
  return { ok: true, data: { level } };
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
