/*
 * Development auth seeding. Creates the owner account and a few demo riders
 * using the Supabase Admin API and the server-side PIN derivation. Requires a
 * live Supabase and a populated environment (.env.local).
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server' tsx scripts/seed.ts
 *
 * The react-server condition neutralises the `server-only` guard so the
 * privileged modules can execute under plain Node.
 */
import './load-env';

import { createRiderUser, createOwnerUser } from '@/lib/auth/provision';

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@ngumbi.co.tz';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe!Owner1';

const DEMO_RIDERS = [
  { phone: '+255712000001', pin: '4820', riderNumber: 'NGR-R-0001', firstName: 'Juma', lastName: 'Mwinyi' },
  { phone: '+255713000002', pin: '5931', riderNumber: 'NGR-R-0002', firstName: 'Asha', lastName: 'Kileo' },
  { phone: '+255714000003', pin: '6072', riderNumber: 'NGR-R-0003', firstName: 'Baraka', lastName: 'Mushi' },
];

async function main() {
  console.log('Seeding owner…');
  try {
    const owner = await createOwnerUser({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      fullName: 'Mr. Ng’umbi',
    });
    console.log(`  owner created: ${owner.userId} (${OWNER_EMAIL})`);
  } catch (e) {
    console.warn(`  owner skipped: ${(e as Error).message}`);
  }

  for (const r of DEMO_RIDERS) {
    try {
      const created = await createRiderUser({ ...r, mustChangePin: true });
      console.log(`  rider ${r.riderNumber} created: ${created.riderId} (${created.phone})`);
    } catch (e) {
      console.warn(`  rider ${r.riderNumber} skipped: ${(e as Error).message}`);
    }
  }

  console.log('Done. Temporary PINs must be changed on first login.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
