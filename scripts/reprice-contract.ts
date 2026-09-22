/*
 * Apply a contract price correction from the command line.
 *
 * This is the SAME correction `repriceContract` performs in the app — it calls
 * the same pure planner (`planReprice`), the same schedule generator and the
 * same guards, in the same order — for the one case the app cannot serve: a
 * contract that needs correcting on the LIVE database before the fix has been
 * deployed there (D-029: no DB password locally, no owner session in a shell).
 *
 * It is deliberately not a general admin tool. It refuses anything the server
 * action refuses, prints the full plan, and does nothing at all without
 * `--apply`.
 *
 *   npx tsx scripts/reprice-contract.ts --contract <id> --daily-rate 10000 \
 *     --reason "..." [--no-recover] [--apply]
 */
import { loadEnv } from './load-env';

loadEnv();

const { createAdminClient } = await import('../lib/supabase/admin');
const { planReprice, addDaysIso, extensionHorizon, REPRICEABLE_STATUSES, describeReprice } =
  await import('../lib/contracts/reprice');
const { instalmentFromDailyRate } = await import('../lib/contracts/pricing');
const { generateSchedule } = await import('../lib/obligations/schedule');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const contractId = arg('contract');
const dailyRate = Number(arg('daily-rate'));
const reason = arg('reason') ?? '';
const recoverShortfall = !has('no-recover');
const apply = has('apply');

if (!contractId || !Number.isInteger(dailyRate) || dailyRate <= 0 || reason.trim().length < 10) {
  console.error('usage: --contract <id> --daily-rate <int> --reason "<why>" [--no-recover] [--apply]');
  process.exit(1);
}

const admin = createAdminClient();

const { data: contractRow, error: readErr } = await admin
  .from('contracts')
  .select(
    'id, contract_number, rider_id, motorcycle_id, status, locked_at, end_date, schedule_type, selected_weekdays, due_day_of_month, installment_amount, daily_rate, payment_deadline_time, current_version',
  )
  .eq('id', contractId)
  .maybeSingle();
if (readErr) throw new Error(`read failed: ${readErr.message}`);
if (!contractRow) throw new Error('contract not found');
// The generated types already describe this row precisely — no cast needed.
const c = contractRow;

if (c.locked_at) throw new Error('contract is locked');
if (c.status !== 'active' && c.status !== 'paused') throw new Error(`status is ${c.status}`);
if (!c.end_date) throw new Error('contract has no end date');

const newInstalment = instalmentFromDailyRate(dailyRate, c.schedule_type);

// Read the whole calendar, not the first PostgREST page (D-033).
const obligations: { id: string; due_date: string; amount_due: number; status: string }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('payment_obligations')
    .select('id, due_date, amount_due, status')
    .eq('contract_id', contractId)
    .order('due_date', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(`obligations read failed: ${error.message}`);
  const page = (data ?? []) as typeof obligations;
  obligations.push(...page);
  if (page.length < 1000) break;
}

const plan = planReprice(
  obligations.map((o) => ({
    id: o.id,
    dueDate: o.due_date,
    amountDue: o.amount_due,
    status: o.status as never,
  })),
  newInstalment,
);

// The extension dates, from the same generator the app uses.
let extra: { dueDate: string; dueAtUtc: string; localDueTime: string }[] = [];
if (recoverShortfall && plan.extraPaymentDays > 0) {
  const from = addDaysIso(c.end_date, 1);
  extra = generateSchedule({
    startDate: from,
    endDate: extensionHorizon(from, c.schedule_type, plan.extraPaymentDays),
    scheduleType: c.schedule_type,
    selectedWeekdays: c.selected_weekdays ?? [],
    dueDayOfMonth: c.due_day_of_month ?? undefined,
    monthlyCount: c.schedule_type === 'monthly' ? plan.extraPaymentDays : undefined,
    deadlineTime: String(c.payment_deadline_time).slice(0, 5),
  }).slice(0, plan.extraPaymentDays);
  if (extra.length < plan.extraPaymentDays) throw new Error('could not generate the extension');
}
const newEndDate = extra.length > 0 ? extra[extra.length - 1]!.dueDate : c.end_date;

console.log(
  JSON.stringify(
    {
      contract: c.contract_number,
      status: c.status,
      cadence: c.schedule_type,
      instalment: { before: c.installment_amount, after: newInstalment },
      dailyRate: { before: c.daily_rate, after: dailyRate },
      plan: {
        unsettledCount: plan.unsettledCount,
        toReprice: plan.repriceIds.length,
        unsettledTotal: [plan.unsettledTotalBefore, plan.unsettledTotalAfter],
        settledCount: plan.settledCount,
        settledTotal: plan.settledTotal,
        shortfall: plan.shortfall,
        extraPaymentDays: plan.extraPaymentDays,
        unrecovered: plan.unrecovered,
        contractTotalAfter: plan.contractTotalAfter,
      },
      extension: extra.map((e) => e.dueDate),
      endDate: { before: c.end_date, after: newEndDate },
      summary: describeReprice(plan, recoverShortfall),
      willWrite: apply,
    },
    null,
    2,
  ),
);

if (!apply) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply to commit.');
  process.exit(0);
}

// --- guards, then writes, in the server action's order --------------------
for (let i = 0; i < plan.repriceIds.length; i += 150) {
  const batch = plan.repriceIds.slice(i, i + 150);
  const { data: held, error } = await admin
    .from('payment_reservations')
    .select('obligation_id')
    .in('obligation_id', batch)
    .eq('is_active', true)
    .limit(1);
  if (error) throw new Error(`reservation check failed: ${error.message}`);
  if (held && held.length > 0) throw new Error('an obligation is reserved by an in-flight payment');
}

let repriced = 0;
for (let i = 0; i < plan.repriceIds.length; i += 150) {
  const batch = plan.repriceIds.slice(i, i + 150);
  const { data, error } = await admin
    .from('payment_obligations')
    .update({ amount_due: newInstalment })
    .in('id', batch)
    .in('status', [...REPRICEABLE_STATUSES])
    .select('id');
  if (error) throw new Error(`reprice failed: ${error.message}`);
  repriced += (data ?? []).length;
}

let added = 0;
if (extra.length > 0) {
  const { data, error } = await admin
    .from('payment_obligations')
    .upsert(
      extra.map((o) => ({
        contract_id: contractId,
        rider_id: c.rider_id,
        motorcycle_id: c.motorcycle_id,
        due_date: o.dueDate,
        due_at: o.dueAtUtc,
        local_due_time: o.localDueTime,
        amount_due: newInstalment,
        status: 'scheduled' as const,
        contract_version: c.current_version,
        kind: 'lease' as const,
      })),
      { onConflict: 'contract_id,due_date', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`extension failed: ${error.message}`);
  added = (data ?? []).length;
}

const { error: updErr } = await admin
  .from('contracts')
  .update({
    daily_rate: dailyRate,
    installment_amount: newInstalment,
    end_date: newEndDate,
    last_edited_at: new Date().toISOString(),
  })
  .eq('id', contractId);
if (updErr) throw new Error(`contract update failed: ${updErr.message}`);

const { error: auditErr } = await admin.from('audit_logs').insert({
  actor_role: 'owner',
  action: 'contract.repriced',
  entity_type: 'contract',
  entity_id: contractId,
  metadata: {
    reason,
    via: 'scripts/reprice-contract.ts',
    dailyRate,
    instalmentBefore: c.installment_amount,
    instalmentAfter: newInstalment,
    repriced,
    settledUntouched: plan.settledCount,
    shortfall: plan.shortfall,
    recoverShortfall,
    extraPaymentDaysAdded: added,
    unrecovered: recoverShortfall ? plan.unrecovered : plan.shortfall,
    endDateBefore: c.end_date,
    endDateAfter: newEndDate,
  },
});
if (auditErr) throw new Error(`audit write failed: ${auditErr.message}`);

console.log(JSON.stringify({ applied: true, repriced, added, endDate: newEndDate }, null, 2));
