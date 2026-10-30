/*
 * Pause a contract from a PAST date (D-055) — for a rider the owner took off
 * the road before the pause existed in the app, e.g. VIKTA MZOVELA
 * (NGR-C-0008), "Suspended on 19 Monday; October 2026".
 *
 * The same `pauseContract` the app's Pause button calls: the motorcycle is
 * released and every unpaid lease day from --from to today is postponed to the
 * end of the calendar. Days before --from stay owed. Prints the plan and does
 * nothing without --apply.
 *
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/pause-contract.ts \
 *     --contract NGR-C-0008 --from 2026-10-19 [--apply]
 */
import { loadEnv } from './load-env';

loadEnv();

const { createAdminClient } = await import('../lib/supabase/admin');
const { pauseContract } = await import('../lib/contracts/pause');
const { localDateString } = await import('../lib/dates/tz');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const contractNumber = arg('contract');
const from = arg('from');
const apply = process.argv.includes('--apply');
const today = localDateString();

if (!contractNumber || !from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || from > today) {
  console.error('usage: --contract <NGR-C-xxxx> --from <YYYY-MM-DD, not in the future> [--apply]');
  process.exit(1);
}

const admin = createAdminClient();
const { data: c, error } = await admin
  .from('contracts')
  .select('id, status, motorcycle_id, end_date')
  .eq('contract_number', contractNumber)
  .maybeSingle();
if (error || !c) {
  console.error('contract not found', error?.message);
  process.exit(1);
}
if (c.status !== 'active') {
  console.error(`contract is ${c.status}; only an active contract can be paused`);
  process.exit(1);
}

const { data: days } = await admin
  .from('payment_obligations')
  .select('due_date, status, amount_due')
  .eq('contract_id', c.id)
  .eq('kind', 'lease')
  .in('status', ['scheduled', 'due', 'overdue'])
  .gte('due_date', from)
  .lte('due_date', today)
  .order('due_date');
const moving = days ?? [];
console.log(
  JSON.stringify(
    {
      contract: contractNumber,
      pausedFrom: from,
      motorcycleToRelease: c.motorcycle_id,
      daysToPostpone: moving.length,
      amountMovedToEnd: moving.reduce((s, d) => s + d.amount_due, 0),
      dates: moving.map((d) => `${d.due_date} (${d.status})`),
      endDateBefore: c.end_date,
    },
    null,
    2,
  ),
);

if (!apply) {
  console.log('\nDry run — nothing changed. Re-run with --apply.');
  process.exit(0);
}

const outcome = await pauseContract(admin, c.id, {
  pausedFrom: from,
  reason: `Contract paused from ${from} (backfilled)`,
});
await admin.from('audit_logs').insert({
  actor_role: 'system',
  action: 'contract.pause',
  entity_type: 'contract',
  entity_id: c.id,
  metadata: { to: 'paused', pausedFrom: from, backfill: true, ...(outcome ?? {}) },
});
console.log('\nApplied:', JSON.stringify(outcome));
