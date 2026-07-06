import 'server-only';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/supabase/types';

/*
 * Server-side authorization helpers. These read the *server-verified* user
 * (getUser revalidates the JWT) and the profile row. The database RLS policies
 * remain the decisive boundary; these helpers are for routing/UX and to avoid
 * leaking owner UI to riders.
 */

export type SessionProfile = {
  userId: string;
  role: UserRole;
  riderId: string | null;
  mustChangePin: boolean;
  fullName: string | null;
};

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, must_change_pin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;

  const p = profile as {
    role: UserRole;
    full_name: string | null;
    must_change_pin: boolean | null;
  };

  let riderId: string | null = null;
  if (p.role === 'rider') {
    const { data: rider } = await supabase
      .from('riders')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    riderId = (rider as { id: string } | null)?.id ?? null;
  }

  return {
    userId: user.id,
    role: p.role,
    riderId,
    mustChangePin: p.must_change_pin ?? false,
    fullName: p.full_name,
  };
}

export async function requireOwner(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/owner');
  if (profile!.role !== 'owner') redirect('/rider');
  return profile!;
}

export async function requireRider(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/rider');
  if (profile!.role !== 'rider') redirect('/owner');
  // First-login temporary PIN change is mandatory (spec §7.3).
  if (profile!.mustChangePin) redirect('/rider/settings/pin?forced=1');
  return profile!;
}
