'use server';

import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { financialNoteSchema } from './validation';

/*
 * Internal financial notes (build spec #10). Append-only: the owner and an
 * active accountant may add notes, and both may read them, but nothing edits or
 * deletes one — a note about money is a record, and records are corrected by
 * adding another note (spec rule 6).
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type FinancialNote = {
  id: string;
  entityType: string;
  entityId: string | null;
  body: string;
  authorName: string;
  createdAt: string;
};

/** Notes, newest first. Readable by the owner and active accountants. */
export async function listFinancialNotes(limit = 100): Promise<FinancialNote[]> {
  const actor = await checkPermission('notes.read');
  if (!actor) return [];

  // RLS-scoped client: the policies added in 0025 decide what is visible.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('financial_notes')
    .select('id, entity_type, entity_id, body, created_at, profiles:author_id(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];

  type Row = {
    id: string;
    entity_type: string;
    entity_id: string | null;
    body: string;
    created_at: string;
    profiles: { full_name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((n) => ({
    id: n.id,
    entityType: n.entity_type,
    entityId: n.entity_id,
    body: n.body,
    authorName: n.profiles?.full_name ?? 'Staff',
    createdAt: n.created_at,
  }));
}

/** Add an internal financial note. Owner or active accountant. */
export async function addFinancialNote(input: unknown): Promise<ActionResult> {
  const actor = await checkPermission('notes.write');
  if (!actor) return { ok: false, error: 'forbidden' };

  const parsed = financialNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation' };
  }
  const { entityType, entityId, body } = parsed.data;
  // A scoped note needs its target; 'general' notes deliberately have none.
  if (entityType !== 'general' && !entityId) return { ok: false, error: 'entity_required' };

  const admin = createAdminClient();
  const { error } = await admin.from('financial_notes').insert({
    entity_type: entityType,
    entity_id: entityId || null,
    body,
    author_id: actor.userId,
  });
  if (error) return { ok: false, error: 'insert_failed' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'financial_note.added',
    entityType: entityType,
    entityId: entityId || null,
  });
  revalidatePath('/accountant/notes');
  revalidatePath('/owner/staff');
  return { ok: true };
}
