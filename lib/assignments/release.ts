import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/*
 * Motorcycle ↔ contract lifecycle (client request 2026-10-23).
 *
 * "When a rider's contract is terminated or becomes inactive, the motorcycle
 *  previously assigned to that rider should automatically become available in
 *  the system so it can be reassigned to another rider."
 *
 * Termination used to cancel the future payment days and stop there: the
 * assignment stayed open and the motorcycle stayed 'assigned' forever, so it
 * could never be leased again without a manual release nobody knew to do.
 *
 * Both helpers are plain server modules (not 'use server'): they are called
 * from inside actions that have ALREADY checked the owner's permission, and
 * must never be reachable from the browser on their own.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ReleaseOutcome =
  | { released: true; motorcycleId: string }
  | { released: false; reason: 'no_motorcycle' | 'locked' | 'still_in_contract' };

/**
 * Close the rider's assignment of this contract's motorcycle and put the
 * motorcycle back in the pool. Idempotent: a second call finds nothing open
 * and changes nothing.
 *
 * Refuses (and says why) when the motorcycle is locked — its ownership was
 * transferred, so it is not the fleet's to lease — or when another live
 * contract still names it.
 */
export async function releaseContractMotorcycle(
  admin: Admin,
  input: { contractId: string; riderId: string; motorcycleId: string | null; endDate: string; reason: string },
): Promise<ReleaseOutcome> {
  if (!input.motorcycleId) return { released: false, reason: 'no_motorcycle' };

  const { data: moto, error: motoErr } = await admin
    .from('motorcycles')
    .select('id, status, locked_at')
    .eq('id', input.motorcycleId)
    .maybeSingle();
  if (motoErr) throw new Error(`motorcycle read failed: ${motoErr.message}`);
  const m = moto as { id: string; status: string; locked_at: string | null } | null;
  if (!m) return { released: false, reason: 'no_motorcycle' };
  if (m.locked_at) return { released: false, reason: 'locked' };

  const { data: other, error: otherErr } = await admin
    .from('contracts')
    .select('id')
    .eq('motorcycle_id', input.motorcycleId)
    .neq('id', input.contractId)
    .in('status', ['draft', 'awaiting_signatures', 'scheduled', 'active', 'paused'])
    .limit(1);
  if (otherErr) throw new Error(`live contract check failed: ${otherErr.message}`);
  if ((other ?? []).length > 0) return { released: false, reason: 'still_in_contract' };

  // Close THIS rider's open assignment of this motorcycle. History is kept:
  // the row is ended, never deleted (spec §9.4).
  const { error: closeErr } = await admin
    .from('motorcycle_assignments')
    .update({ is_active: false, end_date: input.endDate, transfer_reason: input.reason.slice(0, 500) })
    .eq('motorcycle_id', input.motorcycleId)
    .eq('rider_id', input.riderId)
    .eq('is_active', true);
  if (closeErr) throw new Error(`assignment close failed: ${closeErr.message}`);

  // Only a motorcycle nobody else holds goes back to 'available'. If another
  // rider somehow has an open assignment of it, leave it 'assigned'.
  const { data: stillHeld, error: heldErr } = await admin
    .from('motorcycle_assignments')
    .select('id')
    .eq('motorcycle_id', input.motorcycleId)
    .eq('is_active', true)
    .limit(1);
  if (heldErr) throw new Error(`assignment check failed: ${heldErr.message}`);
  if ((stillHeld ?? []).length === 0 && m.status === 'assigned') {
    const { error: freeErr } = await admin
      .from('motorcycles')
      .update({ status: 'available' })
      .eq('id', input.motorcycleId)
      .eq('status', 'assigned');
    if (freeErr) throw new Error(`motorcycle release failed: ${freeErr.message}`);
  }
  return { released: true, motorcycleId: input.motorcycleId };
}

export type ReclaimOutcome =
  | { ok: true; assignmentId: string | null }
  | { ok: false; error: 'motorcycle_reassigned' | 'rider_has_other_motorcycle' | 'motorcycle_unavailable' };

/**
 * The reverse, for reactivating a contract: give the rider their motorcycle
 * back. If it has been leased to somebody else in the meantime, reactivation
 * must stop rather than put two riders on one motorcycle.
 */
export async function reclaimContractMotorcycle(
  admin: Admin,
  input: { contractId: string; riderId: string; motorcycleId: string | null; startDate: string },
): Promise<ReclaimOutcome> {
  if (!input.motorcycleId) return { ok: true, assignmentId: null };

  const { data: open } = await admin
    .from('motorcycle_assignments')
    .select('id, rider_id')
    .eq('motorcycle_id', input.motorcycleId)
    .eq('is_active', true)
    .maybeSingle();
  const current = open as { id: string; rider_id: string } | null;
  if (current) {
    return current.rider_id === input.riderId
      ? { ok: true, assignmentId: current.id }
      : { ok: false, error: 'motorcycle_reassigned' };
  }

  const { data: riderOpen } = await admin
    .from('motorcycle_assignments')
    .select('id')
    .eq('rider_id', input.riderId)
    .eq('is_active', true)
    .limit(1);
  if ((riderOpen ?? []).length > 0) return { ok: false, error: 'rider_has_other_motorcycle' };

  const { data: moto } = await admin
    .from('motorcycles')
    .select('status, locked_at')
    .eq('id', input.motorcycleId)
    .maybeSingle();
  const m = moto as { status: string; locked_at: string | null } | null;
  if (!m || m.locked_at || m.status === 'inactive') return { ok: false, error: 'motorcycle_unavailable' };

  const { data: created, error } = await admin
    .from('motorcycle_assignments')
    .insert({
      motorcycle_id: input.motorcycleId,
      rider_id: input.riderId,
      is_active: true,
      start_date: input.startDate,
    })
    .select('id')
    .single();
  // The partial unique indexes make a concurrent lease of the same motorcycle
  // fail here rather than double-assign it.
  if (error || !created) return { ok: false, error: 'motorcycle_reassigned' };
  const assignmentId = (created as { id: string }).id;

  await admin.from('motorcycles').update({ status: 'assigned' }).eq('id', input.motorcycleId);
  await admin.from('contracts').update({ assignment_id: assignmentId }).eq('id', input.contractId);
  return { ok: true, assignmentId };
}
