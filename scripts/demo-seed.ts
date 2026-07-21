/*
 * DEMO SEED + LIVE END-TO-END SMOKE TEST (owner-authorised, deletable).
 *
 * Puts real demo data through the FULL money lifecycle against the live DB so
 * we exercise the paths that node-only unit tests never touch (the PL/pgSQL
 * activation + settlement functions — the class of bug behind 0019):
 *
 *   1. create 4 demo riders (phone + PIN auth users)         — rider onboarding
 *   2. create 4 demo motorcycles (auto NGR-…-M-#### codes)   — fleet register
 *   3. assign each motorcycle to a rider                     — assignment
 *   4. build + sign + ACTIVATE a daily contract (rider 1)    — contract engine
 *      (activation runs as an AUTHENTICATED user, exactly like production —
 *       which also proves phone+PIN login works)
 *   5. record a cash payment over the 2 oldest days          — settlement + receipt
 *   6. read everything back and assert it is correct         — verification
 *
 * All demo rows are clearly marked and confined to a distinct phone range so
 * the owner can delete them from the dashboard, or run `npm run demo:cleanup`.
 *
 * Run:  NODE_OPTIONS='--conditions=react-server' tsx scripts/demo-seed.ts
 */
import './load-env';

import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRiderUser, createOwnerUser } from '@/lib/auth/provision';
import { derivePassword } from '@/lib/auth/pin-derive';
import { normalizePhone } from '@/lib/auth/phone';
import { nextRiderSeq, formatRiderNumber } from '@/lib/riders/numbering';
import { buildMotorcycleCode } from '@/lib/motorcycles/code';
import { generateSchedule, contractEndDate } from '@/lib/obligations/schedule';
import { localDateString } from '@/lib/dates/tz';

const REGION = 'Dar es Salaam';
const DISTRICT = 'Kinondoni';
const DEADLINE = '18:00';
const INSTALMENT = 5000; // TZS / day

// Distinct phone range so demo riders are trivially identifiable + deletable.
const DEMO_PHONES = ['+255762900001', '+255762900002', '+255762900003', '+255762900004'];
const DEMO_NAMES = [
  { first: 'Juma', last: 'Mtihani' },
  { first: 'Neema', last: 'Mtihani' },
  { first: 'Baraka', last: 'Mtihani' },
  { first: 'Rehema', last: 'Mtihani' },
];

function strongPin(): string {
  // Avoid all-same and simple ascending/descending runs.
  for (;;) {
    const p = String(randomInt(0, 10000)).padStart(4, '0');
    const d = p.split('').map(Number);
    const allSame = d.every((x) => x === d[0]);
    const asc = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
    const desc = d.every((x, i) => i === 0 || x === d[i - 1]! - 1);
    if (!allSame && !asc && !desc) return p;
  }
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function step(msg: string) {
  console.log(`\n▶ ${msg}`);
}
function fail(msg: string): never {
  console.error(`\n✗ FAILED: ${msg}`);
  process.exit(1);
}

async function main() {
  const admin = createAdminClient();
  const runTag = Date.now().toString(36).toUpperCase();

  step('Preflight — connectivity + guard against duplicate demo data');
  const { count: riderCount, error: pfErr } = await admin
    .from('riders')
    .select('*', { count: 'exact', head: true });
  if (pfErr) fail(`cannot reach the database: ${pfErr.message}`);
  ok(`connected — ${riderCount ?? 0} riders currently in the fleet`);

  const { data: existing } = await admin.from('riders').select('id, phone').in('phone', DEMO_PHONES);
  if (existing && existing.length > 0) {
    fail(
      `demo riders already exist (${existing.length}). Run \`npm run demo:cleanup\` first, ` +
        `then re-run this script.`,
    );
  }

  // ---- 1. Riders ---------------------------------------------------------
  step('1/6  Create 4 demo riders (phone + PIN auth users)');
  const riders: { id: string; phone: string; pin: string; number: string; name: string }[] = [];
  for (let i = 0; i < DEMO_PHONES.length; i++) {
    const pin = strongPin();
    const seq = await nextRiderSeq(admin);
    const number = formatRiderNumber(seq);
    const created = await createRiderUser({
      phone: DEMO_PHONES[i]!,
      pin,
      riderNumber: number,
      firstName: DEMO_NAMES[i]!.first,
      lastName: DEMO_NAMES[i]!.last,
      mustChangePin: false, // demo: log straight into the dashboard
    });
    riders.push({
      id: created.riderId,
      phone: created.phone,
      pin,
      number,
      name: `${DEMO_NAMES[i]!.first} ${DEMO_NAMES[i]!.last}`,
    });
    ok(`${number}  ${DEMO_NAMES[i]!.first} ${DEMO_NAMES[i]!.last}  ${created.phone}  PIN ${pin}`);
  }

  // ---- 2. Motorcycles ----------------------------------------------------
  step('2/6  Create 4 demo motorcycles (auto-generated codes)');
  const motos: { id: string; code: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const { count: bucket } = await admin
      .from('motorcycles')
      .select('*', { count: 'exact', head: true })
      .eq('region', REGION)
      .eq('district', DISTRICT);
    let motoId: string | null = null;
    let code = '';
    for (let attempt = 0; attempt < 6 && !motoId; attempt++) {
      code = buildMotorcycleCode({
        regionName: REGION,
        districtName: DISTRICT,
        sequence: (bucket ?? 0) + 1 + attempt,
      });
      const { data, error } = await admin
        .from('motorcycles')
        .insert({
          motorcycle_number: code,
          registration_number: `T${randomInt(100, 999)} DMO`,
          chassis_number: `DEMOCHS${runTag}${i}`,
          engine_number: `DEMOENG${runTag}${i}`,
          colour: ['Red', 'Blue', 'Black', 'Green'][i],
          make: 'Bajaj',
          model: 'Boxer',
          region: REGION,
          district: DISTRICT,
          status: 'available',
        })
        .select('id')
        .single();
      if (data) motoId = (data as { id: string }).id;
      else if (error && /motorcycle_number/i.test(error.message)) continue;
      else if (error) fail(`motorcycle insert failed: ${error.message}`);
    }
    if (!motoId) fail('could not allocate a unique motorcycle code');
    motos.push({ id: motoId, code });
    ok(`${code}`);
  }

  // ---- 3. Assignments ----------------------------------------------------
  step('3/6  Assign each motorcycle to a rider');
  const today = localDateString();
  for (let i = 0; i < 4; i++) {
    const { error } = await admin.from('motorcycle_assignments').insert({
      motorcycle_id: motos[i]!.id,
      rider_id: riders[i]!.id,
      is_active: true,
      start_date: today,
    });
    if (error) fail(`assignment failed: ${error.message}`);
    await admin.from('motorcycles').update({ status: 'assigned' }).eq('id', motos[i]!.id);
    ok(`${motos[i]!.code} → ${riders[i]!.name}`);
  }

  // ---- 4. Contract: build, sign, activate --------------------------------
  step('4/6  Build + sign + ACTIVATE a daily contract for rider 1');
  const rider1 = riders[0]!;
  const moto1 = motos[0]!;
  const { data: assignRow } = await admin
    .from('motorcycle_assignments')
    .select('id')
    .eq('rider_id', rider1.id)
    .eq('is_active', true)
    .maybeSingle();

  // Next contract number (max-based, delete-safe).
  const { data: lastC } = await admin
    .from('contracts')
    .select('contract_number')
    .order('contract_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSeq = lastC
    ? parseInt(/(\d+)$/.exec((lastC as { contract_number: string }).contract_number)?.[1] ?? '0', 10)
    : 0;
  const contractNumber = `NGR-C-${String(lastSeq + 1).padStart(4, '0')}`;

  const startDate = today;
  const endDate = contractEndDate({
    scheduleType: 'daily',
    startDate,
    durationMonths: 1,
    deadlineTime: DEADLINE,
  });
  const { data: contractRow, error: cErr } = await admin
    .from('contracts')
    .insert({
      contract_number: contractNumber,
      rider_id: rider1.id,
      motorcycle_id: moto1.id,
      assignment_id: (assignRow as { id: string } | null)?.id ?? null,
      contract_type: 'fixed_term_lease',
      ownership_transfers: false,
      start_date: startDate,
      end_date: endDate,
      duration_months: 1,
      schedule_type: 'daily',
      selected_weekdays: [],
      due_day_of_month: null,
      installment_amount: INSTALMENT,
      payment_deadline_time: DEADLINE,
      template_version: 1,
      status: 'draft',
      current_version: 1,
    })
    .select('id')
    .single();
  if (cErr || !contractRow) fail(`contract insert failed: ${cErr?.message}`);
  const contractId = (contractRow as { id: string }).id;
  ok(`draft contract ${contractNumber} created`);

  // Owner + rider signatures (activation requires both, or a signed copy).
  const { error: sigErr } = await admin.from('contract_signatures').insert([
    { contract_id: contractId, signer_role: 'owner', signer_name: 'Owner (demo)', method: 'drawn' },
    { contract_id: contractId, signer_role: 'rider', signer_name: rider1.name, method: 'drawn' },
  ]);
  if (sigErr) fail(`signature insert failed: ${sigErr.message}`);
  ok('owner + rider signatures captured');

  // Generate the schedule exactly as the contract action does.
  const obligations = generateSchedule({
    startDate,
    endDate,
    scheduleType: 'daily',
    selectedWeekdays: [],
    deadlineTime: DEADLINE,
  }).map((o) => ({ dueDate: o.dueDate, dueAtUtc: o.dueAtUtc, localDueTime: o.localDueTime }));

  // First prove phone + PIN login works end-to-end against the live auth
  // (the exact rider sign-in path).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const riderClient = createClient(url, anonKey);
  const { error: riderLoginErr } = await riderClient.auth.signInWithPassword({
    phone: normalizePhone(rider1.phone),
    password: derivePassword(normalizePhone(rider1.phone), rider1.pin),
  });
  if (riderLoginErr) fail(`phone+PIN login failed for ${rider1.phone}: ${riderLoginErr.message}`);
  ok(`phone+PIN login works (${rider1.phone})`);
  await riderClient.auth.signOut();

  // Activation runs the real SECURITY DEFINER function, which self-checks
  // is_owner(). Spin up a TEMPORARY demo owner, sign in as it, activate, then
  // delete it — so we exercise the true production path without touching the
  // real owner account. (Removed again at the end / by demo:cleanup.)
  const demoOwnerEmail = `demo-owner+${runTag.toLowerCase()}@ngumbi.local`;
  const demoOwnerPassword = `Demo!${runTag}${randomInt(1000, 9999)}`;
  const demoOwner = await createOwnerUser({
    email: demoOwnerEmail,
    password: demoOwnerPassword,
    fullName: 'Demo Owner (test)',
  });
  const ownerClient = createClient(url, anonKey);
  const { error: ownerLoginErr } = await ownerClient.auth.signInWithPassword({
    email: demoOwnerEmail,
    password: demoOwnerPassword,
  });
  if (ownerLoginErr) fail(`demo owner login failed: ${ownerLoginErr.message}`);

  const { data: generated, error: actErr } = await ownerClient.rpc(
    'activate_contract_and_generate_obligations',
    { p_contract_id: contractId, p_obligations: obligations },
  );
  await ownerClient.auth.signOut();
  // Remove the temporary owner immediately, whatever happened next.
  await admin.from('profiles').delete().eq('id', demoOwner.userId);
  await admin.auth.admin.deleteUser(demoOwner.userId);

  if (actErr) fail(`activation RPC failed: ${actErr.message}`);
  ok(`contract activated as owner — ${generated} obligations generated (expected ${obligations.length})`);
  if (Number(generated) !== obligations.length) {
    fail(`obligation count mismatch: got ${generated}, expected ${obligations.length}`);
  }

  // ---- 5. Settlement: record a cash payment ------------------------------
  step('5/6  Record a cash payment over the 2 oldest days (settlement + receipt)');
  const { data: oldest, error: obErr } = await admin
    .from('payment_obligations')
    .select('id, due_date, amount_due, status')
    .eq('contract_id', contractId)
    .in('status', ['scheduled', 'due', 'overdue'])
    .order('due_date', { ascending: true })
    .limit(2);
  if (obErr || !oldest || oldest.length !== 2) fail(`could not read outstanding obligations`);
  const payIds = (oldest as { id: string }[]).map((o) => o.id);
  const amount = (oldest as { amount_due: number }[]).reduce((s, o) => s + o.amount_due, 0);

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();

  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      rider_id: rider1.id,
      contract_id: contractId,
      method: 'cash',
      amount,
      status: 'created',
      created_by: (ownerProfile as { id: string } | null)?.id ?? null,
      idempotency_key: `demo-${runTag}-${randomInt(1000, 9999)}`,
    })
    .select('id')
    .single();
  if (payErr || !payment) fail(`payment insert failed: ${payErr?.message}`);
  const paymentId = (payment as { id: string }).id;

  const completedAt = new Date(`${today}T12:00:00+03:00`).toISOString();
  const { error: settleErr } = await admin.rpc('record_completed_payment', {
    p_payment_id: paymentId,
    p_obligation_ids: payIds,
    p_receipt_number: '',
    p_completed_at: completedAt,
  });
  if (settleErr) fail(`settlement RPC failed: ${settleErr.message}`);
  ok(`settled TZS ${amount.toLocaleString('en-US')} across 2 days`);

  // ---- 6. Read-back verification -----------------------------------------
  step('6/6  Verify settlement landed correctly');
  const { data: payAfter } = await admin
    .from('payments')
    .select('status')
    .eq('id', paymentId)
    .maybeSingle();
  if ((payAfter as { status: string } | null)?.status !== 'completed') {
    fail(`payment status is ${(payAfter as { status: string } | null)?.status}, expected completed`);
  }
  ok('payment marked completed');

  const { data: settledObs } = await admin
    .from('payment_obligations')
    .select('status')
    .in('id', payIds);
  const paidLike = new Set(['paid', 'paid_in_advance']);
  if (!(settledObs ?? []).every((o) => paidLike.has((o as { status: string }).status))) {
    fail('one or more settled obligations are not paid/paid_in_advance');
  }
  ok('both obligations now paid / paid_in_advance');

  const { data: receipt } = await admin
    .from('receipts')
    .select('receipt_number')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (!receipt) fail('no receipt row was generated by settlement');
  ok(`receipt generated: ${(receipt as { receipt_number: string }).receipt_number}`);

  const { data: allObs } = await admin
    .from('payment_obligations')
    .select('status')
    .eq('contract_id', contractId);
  const total = (allObs ?? []).length;
  const paid = (allObs ?? []).filter((o) => paidLike.has((o as { status: string }).status)).length;
  ok(`rider 1 contract: ${total} obligations, ${paid} paid`);

  // ---- Summary -----------------------------------------------------------
  console.log('\n========================================================');
  console.log('  ✅ LIVE END-TO-END SMOKE TEST PASSED');
  console.log('========================================================');
  console.log('\n  Demo rider logins (delete these after testing):');
  for (const r of riders) {
    console.log(`    ${r.number}  ${r.name.padEnd(16)}  ${r.phone}  PIN ${r.pin}`);
  }
  console.log(`\n  Rider 1 (${rider1.name}) has an ACTIVE contract ${contractNumber}`);
  console.log(`    ${total} daily obligations · 2 already paid (cash) · 1 receipt`);
  console.log('\n  Owner login: owner@ngumbi.co.tz (existing password)');
  console.log('\n  To remove ALL demo data:  npm run demo:cleanup');
  console.log('========================================================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
