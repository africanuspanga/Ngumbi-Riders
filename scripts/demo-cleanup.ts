/*
 * Remove ALL demo data created by scripts/demo-seed.ts.
 *
 * Deletes in FK-safe order (financial records use `on delete restrict`, so
 * children must go before parents). Scoped strictly to the demo phone range and
 * the DEMOCHS… chassis prefix, so it can never touch real riders or money.
 *
 * Run:  NODE_OPTIONS='--conditions=react-server' tsx scripts/demo-cleanup.ts
 */
import './load-env';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

const DEMO_PHONES = ['+255762900001', '+255762900002', '+255762900003', '+255762900004'];

function ids<T extends { id: string }>(rows: T[] | null): string[] {
  return (rows ?? []).map((r) => r.id);
}

async function main() {
  const admin = createAdminClient();

  const { data: riders } = await admin
    .from('riders')
    .select('id, profile_id, phone')
    .in('phone', DEMO_PHONES);
  if (!riders || riders.length === 0) {
    console.log('No demo riders found — nothing to clean up.');
    return;
  }
  const riderIds = ids(riders as { id: string }[]);
  const profileIds = (riders as { profile_id: string }[]).map((r) => r.profile_id);
  console.log(`Found ${riders.length} demo riders. Removing their data…`);

  const { data: contracts } = await admin.from('contracts').select('id').in('rider_id', riderIds);
  const contractIds = ids(contracts as { id: string }[]);
  const { data: payments } = await admin.from('payments').select('id').in('rider_id', riderIds);
  const paymentIds = ids(payments as { id: string }[]);
  const { data: motos } = await admin.from('motorcycles').select('id').like('chassis_number', 'DEMOCHS%');
  const motoIds = ids(motos as { id: string }[]);

  // Order matters: settle-time children → payments/obligations → contract
  // children → contracts → fleet → rider → auth. Use an untyped handle so the
  // table name can be a plain string in this generic delete loop.
  const db = admin as unknown as SupabaseClient;
  const del = async (table: string, col: string, vals: string[]) => {
    if (vals.length === 0) return;
    const { error } = await db.from(table).delete().in(col, vals);
    if (error) console.warn(`  ! ${table}.${col}: ${error.message}`);
    else console.log(`  - ${table} (${vals.length})`);
  };

  await del('receipts', 'payment_id', paymentIds);
  await del('payment_allocations', 'payment_id', paymentIds);
  await del('payment_events', 'payment_id', paymentIds);
  await del('payment_reservations', 'payment_id', paymentIds);
  await del('payments', 'id', paymentIds);
  await del('payment_obligations', 'contract_id', contractIds);
  await del('contract_documents', 'contract_id', contractIds);
  await del('contract_signatures', 'contract_id', contractIds);
  await del('contract_versions', 'contract_id', contractIds);
  await del('contract_events', 'contract_id', contractIds);
  await del('contracts', 'id', contractIds);
  await del('motorcycle_assignments', 'rider_id', riderIds);
  await del('motorcycles', 'id', motoIds);
  await del('risk_snapshots', 'rider_id', riderIds);
  await del('notifications', 'recipient_profile_id', profileIds);
  await del('login_attempts', 'phone', DEMO_PHONES);
  await del('riders', 'id', riderIds);
  await del('profiles', 'id', profileIds);

  for (const pid of profileIds) {
    const { error } = await admin.auth.admin.deleteUser(pid);
    if (error) console.warn(`  ! auth user ${pid}: ${error.message}`);
  }
  console.log(`  - auth users (${profileIds.length})`);

  // Any orphaned temporary demo-owner accounts (created for the activation test).
  const { data: demoOwners } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'owner')
    .eq('full_name', 'Demo Owner (test)');
  for (const p of (demoOwners ?? []) as { id: string }[]) {
    await admin.from('profiles').delete().eq('id', p.id);
    await admin.auth.admin.deleteUser(p.id);
    console.log(`  - demo owner ${p.id}`);
  }

  console.log('\n✅ Demo data removed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
