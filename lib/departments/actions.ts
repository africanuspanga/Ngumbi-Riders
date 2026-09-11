'use server';

import { revalidatePath } from 'next/cache';
import { checkPermission } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAudit } from '@/lib/audit/audit';
import { formatTZS } from '@/lib/money/format';
import { yearOf } from '@/lib/requisitions/constants';
import {
  departmentSchema,
  departmentEditSchema,
  budgetSchema,
  departmentExpenseSchema,
} from './validation';

/*
 * Department, budget and expense writes (client feedback 2026-09-11 #2).
 *
 * SEPARATION OF DUTIES, as everywhere else in this codebase:
 *
 *   departments.write / budgets.write   OWNER ONLY. Creating a cost centre and
 *                                       deciding what it may spend is the
 *                                       Director's act. An accountant who
 *                                       could raise their own budget could
 *                                       authorise their own spending.
 *   expenses.record                     owner AND accountant. Writing down
 *                                       what was actually spent is
 *                                       bookkeeping, and it is the
 *                                       accountant's daily job.
 *
 * All three tables revoke direct writes from `authenticated` (0030), so every
 * change goes through this file, after requirePermission, on the service role.
 * Nothing here is money in the rider-ledger sense: no payment, obligation,
 * allocation or receipt is ever created.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function revalidateDepartmentSurfaces(departmentId?: string) {
  revalidatePath('/owner/departments');
  revalidatePath('/accountant/departments');
  revalidatePath('/owner/reports');
  revalidatePath('/accountant/reports');
  if (departmentId) {
    revalidatePath(`/owner/departments/${departmentId}`);
    revalidatePath(`/accountant/departments/${departmentId}`);
  }
}

/* ------------------------------------------------------------------------ *
 * Departments
 * ------------------------------------------------------------------------ */

export async function createDepartment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await checkPermission('departments.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  const parsed = departmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('departments')
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !data) {
    // 23505 = the unique code. Say which constraint bit, because the fix is
    // different for each: pick another code vs. report a bug.
    if (error?.code === '23505') return { ok: false, error: 'code_taken' };
    return { ok: false, error: 'server_error' };
  }
  const id = (data as { id: string }).id;

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'department.created',
    entityType: 'department',
    entityId: id,
    metadata: { code: parsed.data.code, name: parsed.data.name },
  });
  revalidateDepartmentSurfaces(id);
  return { ok: true, data: { id } };
}

/**
 * Rename a department, change its description, or deactivate it.
 *
 * The CODE is never editable. It is an identifier that exports, saved report
 * filters and (eventually) the client's own spreadsheets quote, and reference
 * data encoded into identifiers is append-only in this project (spec rule 15 —
 * the rule that came out of renaming a region and orphaning every row that
 * stored its name as text).
 */
export async function updateDepartment(
  departmentId: string,
  input: unknown,
): Promise<ActionResult> {
  const actor = await checkPermission('departments.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  const parsed = departmentEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();
  const { error } = await admin
    .from('departments')
    .update({
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      is_active: parsed.data.isActive,
    })
    .eq('id', departmentId);
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'department.updated',
    entityType: 'department',
    entityId: departmentId,
    metadata: { name: parsed.data.name, isActive: parsed.data.isActive },
  });
  revalidateDepartmentSurfaces(departmentId);
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * Budgets
 * ------------------------------------------------------------------------ */

export async function createBudget(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await checkPermission('budgets.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('department_budgets')
    .insert({
      department_id: parsed.data.departmentId,
      label: parsed.data.label,
      // The fiscal year is DERIVED from the period start, read textually so a
      // 1 January budget cannot land in the previous year (build spec #5).
      fiscal_year: yearOf(parsed.data.periodStart),
      period_start: parsed.data.periodStart,
      period_end: parsed.data.periodEnd,
      amount: parsed.data.amount,
      note: parsed.data.note?.trim() || null,
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'server_error' };
  const id = (data as { id: string }).id;

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'department.budget_created',
    entityType: 'department_budget',
    entityId: id,
    metadata: {
      departmentId: parsed.data.departmentId,
      amount: parsed.data.amount,
      period: `${parsed.data.periodStart}..${parsed.data.periodEnd}`,
    },
  });
  revalidateDepartmentSurfaces(parsed.data.departmentId);
  return { ok: true, data: { id } };
}

/**
 * Remove a budget allocation.
 *
 * Allowed, unlike deleting an expense: a budget is a PLAN, not a record of
 * something that happened, and correcting a plan by adding a compensating
 * negative line would be absurd. The audit row keeps what was removed.
 */
export async function deleteBudget(budgetId: string): Promise<ActionResult> {
  const actor = await checkPermission('budgets.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('department_budgets')
    .select('id, department_id, label, amount, period_start, period_end')
    .eq('id', budgetId)
    .maybeSingle();
  const row = existing as
    | {
        id: string;
        department_id: string;
        label: string;
        amount: number;
        period_start: string;
        period_end: string;
      }
    | null;
  if (!row) return { ok: false, error: 'not_found' };

  const { error } = await admin.from('department_budgets').delete().eq('id', budgetId);
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'department.budget_deleted',
    entityType: 'department_budget',
    entityId: budgetId,
    metadata: {
      departmentId: row.department_id,
      label: row.label,
      amount: row.amount,
      period: `${row.period_start}..${row.period_end}`,
    },
  });
  revalidateDepartmentSurfaces(row.department_id);
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------------ */

export async function recordDepartmentExpense(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const actor = await checkPermission('expenses.record');
  if (!actor) return { ok: false, error: 'forbidden' };
  const parsed = departmentExpenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const admin = createAdminClient();

  // A requisition link is optional, but if one is given it must exist and be
  // APPROVED: attaching spend to a request the Director refused would make the
  // retirement figures claim authorisation that was never granted.
  let requisitionId: string | null = null;
  if (parsed.data.requisitionId) {
    const { data: reqn } = await admin
      .from('purchase_requisitions')
      .select('id, status')
      .eq('id', parsed.data.requisitionId)
      .maybeSingle();
    const r = reqn as { id: string; status: string } | null;
    if (!r) return { ok: false, error: 'requisition_not_found' };
    if (r.status !== 'approved') return { ok: false, error: 'requisition_not_approved' };
    requisitionId = r.id;
  }

  const { data, error } = await admin
    .from('department_expenses')
    .insert({
      department_id: parsed.data.departmentId,
      expense_date: parsed.data.expenseDate,
      category: parsed.data.category,
      amount: parsed.data.amount,
      description: parsed.data.description,
      supplier: parsed.data.supplier?.trim() || null,
      reference: parsed.data.reference?.trim() || null,
      requisition_id: requisitionId,
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'server_error' };
  const id = (data as { id: string }).id;

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'department.expense_recorded',
    entityType: 'department_expense',
    entityId: id,
    metadata: {
      departmentId: parsed.data.departmentId,
      amount: parsed.data.amount,
      category: parsed.data.category,
      requisitionId,
      description: parsed.data.description.slice(0, 120),
    },
  });
  revalidateDepartmentSurfaces(parsed.data.departmentId);
  return { ok: true, data: { id } };
}

/**
 * Delete an expense. OWNER ONLY, and deliberately narrow.
 *
 * An expense is a record of something that happened, and this codebase corrects
 * records with reversal events rather than deletions (spec rule 6). It is
 * allowed here only because the alternative for a genuine typo — a negative
 * expense line — would break the `amount > 0` constraint and make every
 * category total meaningless. The audit row preserves exactly what was removed,
 * so the deletion is itself a record.
 */
export async function deleteDepartmentExpense(expenseId: string): Promise<ActionResult> {
  const actor = await checkPermission('departments.write');
  if (!actor || actor.role !== 'owner') return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('department_expenses')
    .select('id, department_id, amount, category, description, expense_date')
    .eq('id', expenseId)
    .maybeSingle();
  const row = existing as
    | {
        id: string;
        department_id: string;
        amount: number;
        category: string;
        description: string;
        expense_date: string;
      }
    | null;
  if (!row) return { ok: false, error: 'not_found' };

  const { error } = await admin.from('department_expenses').delete().eq('id', expenseId);
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: 'owner',
    action: 'department.expense_deleted',
    entityType: 'department_expense',
    entityId: expenseId,
    metadata: {
      departmentId: row.department_id,
      amount: row.amount,
      amountLabel: formatTZS(row.amount),
      category: row.category,
      description: row.description,
      expenseDate: row.expense_date,
    },
  });
  revalidateDepartmentSurfaces(row.department_id);
  return { ok: true };
}

/**
 * File an existing MOTORCYCLE expense under a department, so fleet spend rolls
 * up into the budget board without moving a single row between tables.
 */
export async function tagMotorcycleExpense(
  expenseId: string,
  departmentId: string | null,
): Promise<ActionResult> {
  const actor = await checkPermission('expenses.record');
  if (!actor) return { ok: false, error: 'forbidden' };

  const admin = createAdminClient();
  const { error } = await admin
    .from('motorcycle_expenses')
    .update({ department_id: departmentId })
    .eq('id', expenseId);
  if (error) return { ok: false, error: 'server_error' };

  await writeAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'department.motorcycle_expense_tagged',
    entityType: 'motorcycle_expense',
    entityId: expenseId,
    metadata: { departmentId },
  });
  revalidateDepartmentSurfaces(departmentId ?? undefined);
  revalidatePath('/owner/expenses');
  return { ok: true };
}
