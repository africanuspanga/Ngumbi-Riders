'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { expenseSchema } from './validation';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function assertOwner() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'owner') throw new Error('forbidden');
  return profile.userId;
}

export async function addExpense(input: unknown): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();
  const { error } = await admin.from('motorcycle_expenses').insert({
    motorcycle_id: parsed.data.motorcycleId,
    expense_date: parsed.data.expenseDate,
    category: parsed.data.category,
    amount: parsed.data.amount,
    note: parsed.data.note || null,
    created_by: ownerId,
  });
  if (error) return { ok: false, error: 'insert_failed' };

  await writeAudit({
    actorId: ownerId,
    actorRole: 'owner',
    action: 'expense.added',
    entityType: 'motorcycle',
    entityId: parsed.data.motorcycleId,
    metadata: { amount: parsed.data.amount, category: parsed.data.category },
  });
  revalidatePath('/owner/expenses');
  revalidatePath(`/owner/motorcycles/${parsed.data.motorcycleId}`);
  return { ok: true };
}

export async function deleteExpense(id: string, motorcycleId: string): Promise<ActionResult> {
  const ownerId = await assertOwner();
  const admin = createAdminClient();
  const { error } = await admin.from('motorcycle_expenses').delete().eq('id', id);
  if (error) return { ok: false, error: 'delete_failed' };
  await writeAudit({ actorId: ownerId, actorRole: 'owner', action: 'expense.deleted', entityType: 'motorcycle', entityId: motorcycleId });
  revalidatePath('/owner/expenses');
  return { ok: true };
}
