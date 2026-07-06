import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  rlsEnvReady,
  makeRider,
  makeOwner,
  anonClient,
  cleanupUsers,
} from './helpers';

/*
 * RLS isolation suite (spec §23, §31.4). Proves the Phase 1 exit criterion:
 * "cross-rider access is impossible." Skipped automatically unless
 * RLS_TEST_ENABLED=1 and a real Supabase is configured.
 *
 * Run once credentials are provided:
 *   RLS_TEST_ENABLED=1 npm run test:rls
 */
const d = rlsEnvReady() ? describe : describe.skip;

d('RLS rider isolation', () => {
  let riderA: Awaited<ReturnType<typeof makeRider>>;
  let riderB: Awaited<ReturnType<typeof makeRider>>;
  let owner: Awaited<ReturnType<typeof makeOwner>>;

  beforeAll(async () => {
    riderA = await makeRider();
    riderB = await makeRider();
    owner = await makeOwner();
  }, 60_000);

  afterAll(async () => {
    await cleanupUsers([
      riderA?.userId,
      riderB?.userId,
      owner?.userId,
    ].filter(Boolean) as string[]);
  }, 60_000);

  it('a rider can read their OWN rider row', async () => {
    const { data, error } = await riderA.client
      .from('riders')
      .select('id, phone')
      .eq('id', riderA.riderId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(riderA.riderId);
  });

  it('a rider CANNOT read another rider by id', async () => {
    const { data } = await riderA.client
      .from('riders')
      .select('id')
      .eq('id', riderB.riderId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('a rider listing riders sees only themselves', async () => {
    const { data } = await riderA.client.from('riders').select('id');
    expect(data?.map((r) => r.id)).toEqual([riderA.riderId]);
  });

  it('a rider CANNOT read another rider profile', async () => {
    const { data } = await riderA.client
      .from('profiles')
      .select('id')
      .eq('id', riderB.userId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('a rider cannot see rider_private_data (owner-only)', async () => {
    const { data } = await riderA.client
      .from('rider_private_data')
      .select('rider_id');
    expect(data ?? []).toHaveLength(0);
  });

  it('a rider cannot read the login_attempts / audit tables', async () => {
    const attempts = await riderA.client.from('login_attempts').select('id');
    const audit = await riderA.client.from('audit_logs').select('id');
    expect(attempts.data ?? []).toHaveLength(0);
    expect(audit.data ?? []).toHaveLength(0);
  });

  it('a rider cannot INSERT a payment directly', async () => {
    const { error } = await riderA.client.from('payments').insert({
      rider_id: riderA.riderId,
      contract_id: riderA.riderId, // arbitrary; RLS should block before FK
      method: 'cash',
      amount: 5000,
      idempotency_key: `evil-${Date.now()}`,
    });
    expect(error).not.toBeNull();
  });

  it('an anonymous client cannot read riders at all', async () => {
    const anon = anonClient();
    const { data } = await anon.from('riders').select('id');
    expect(data ?? []).toHaveLength(0);
  });

  it('the owner CAN read all riders', async () => {
    const { data, error } = await owner.client.from('riders').select('id');
    expect(error).toBeNull();
    const ids = data?.map((r) => r.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([riderA.riderId, riderB.riderId]));
  });

  it('the owner can read rider_private_data', async () => {
    const { error } = await owner.client
      .from('rider_private_data')
      .select('rider_id');
    expect(error).toBeNull();
  });
});
