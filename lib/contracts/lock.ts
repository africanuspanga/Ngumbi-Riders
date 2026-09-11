'use server';

import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit';

/*
 * THE AMENDMENT PROCESS (client feedback 2026-09-11 #10).
 *
 * "After completion and final print/final approval, contract and registration
 *  details should become locked. Any change should require a special amendment
 *  process, not normal editing."
 *
 * The difference between an amendment and an edit is a TRACE. Unlocking is
 * therefore its own recorded act: it demands a reason, writes an audit row
 * BEFORE anything moves, and leaves the reason on the contract row itself, so
 * a reader a year later can see that the record was reopened, by whom, and
 * why.
 *
 * The unlock goes through `unlock_contract_for_amendment` (migration 0034), a
 * SECURITY DEFINER function that checks `is_owner()` itself — so even a caller
 * who reached this file without the permission cannot get past the database.
 *
 * NOTE what unlocking does NOT do: it does not reverse the completion, reissue
 * the certificate, or undo the ownership transfer. Those are records of things
 * that happened. It only reopens the contract's own fields for correction.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function unlockContractForAmendment(
  contractId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await checkPermission('contracts.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('contracts')
    .select('id, contract_number, locked_at')
    .eq('id', contractId)
    .maybeSingle();
  const contract = data as
    | { id: string; contract_number: string; locked_at: string | null }
    | null;
  if (!contract) return { ok: false, error: 'not_found' };
  if (!contract.locked_at) return { ok: false, error: 'not_locked' };

  // The audit row is written BEFORE the unlock. If the unlock then fails, the
  // worst outcome is an audit row for an amendment that did not happen —
  // noticeable and harmless. The reverse order risks an unlocked contract with
  // no record of who opened it, which is the one thing this must never allow.
  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'contract.unlocked_for_amendment',
    entityType: 'contract',
    entityId: contractId,
    metadata: {
      contractNumber: contract.contract_number,
      lockedAt: contract.locked_at,
      reason: trimmed.slice(0, 500),
    },
  });

  // Called with the OWNER's session (not the service role) so the function's
  // own is_owner() check is meaningful rather than trivially satisfied.
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('unlock_contract_for_amendment', {
    p_contract_id: contractId,
    p_reason: trimmed.slice(0, 500),
  });
  if (error) return { ok: false, error: 'server_error' };

  revalidatePath(`/owner/contracts/${contractId}`);
  revalidatePath(`/owner/contracts/${contractId}/edit`);
  revalidatePath('/owner/contracts');
  return { ok: true };
}

/** Unlock a transferred motorcycle's registration fields for correction. */
export async function unlockMotorcycleForAmendment(
  motorcycleId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await checkPermission('motorcycles.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3) return { ok: false, error: 'reason_required' };

  const admin = createAdminClient();
  const { data } = await admin
    .from('motorcycles')
    .select('id, motorcycle_number, locked_at')
    .eq('id', motorcycleId)
    .maybeSingle();
  const moto = data as
    | { id: string; motorcycle_number: string; locked_at: string | null }
    | null;
  if (!moto) return { ok: false, error: 'not_found' };
  if (!moto.locked_at) return { ok: false, error: 'not_locked' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'motorcycle.unlocked_for_amendment',
    entityType: 'motorcycle',
    entityId: motorcycleId,
    metadata: {
      motorcycleNumber: moto.motorcycle_number,
      lockedAt: moto.locked_at,
      reason: trimmed.slice(0, 500),
    },
  });

  const { error } = await admin
    .from('motorcycles')
    .update({ locked_at: null, locked_by: null })
    .eq('id', motorcycleId);
  if (error) return { ok: false, error: 'server_error' };

  revalidatePath(`/owner/motorcycles/${motorcycleId}`);
  revalidatePath('/owner/motorcycles');
  return { ok: true };
}
