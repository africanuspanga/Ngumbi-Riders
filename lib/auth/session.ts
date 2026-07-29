import 'server-only';

import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { can, homePathFor, type Permission } from '@/lib/auth/roles';
import type { UserRole } from '@/lib/supabase/types';

/*
 * Server-side authorization helpers. These read the *server-verified* user
 * (getUser revalidates the JWT) and the profile row. The database RLS policies
 * remain the decisive boundary; these helpers are for routing/UX and to avoid
 * leaking owner UI to riders or accountants.
 *
 * Every server action and route handler that does something privileged must
 * call `requirePermission()` (or one of the require* helpers) — a hidden button
 * is not access control (build spec #10).
 */

export type SessionProfile = {
  userId: string;
  role: UserRole;
  riderId: string | null;
  mustChangePin: boolean;
  fullName: string | null;
  /** Owner-controlled access switch (migration 0025). Deactivated = no access. */
  isActive: boolean;
};

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, must_change_pin, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;

  const p = profile as {
    role: UserRole;
    full_name: string | null;
    must_change_pin: boolean | null;
    is_active: boolean | null;
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
    // Older rows predate the column; absent means active.
    isActive: p.is_active ?? true,
  };
}

export async function requireOwner(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/owner');
  if (profile.role !== 'owner') redirect(homePathFor(profile.role));
  return profile;
}

export async function requireRider(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/rider');
  if (profile.role !== 'rider') redirect(homePathFor(profile.role));
  // First-login temporary PIN change is mandatory (spec §7.3).
  if (profile.mustChangePin) redirect('/rider/settings/pin?forced=1');
  return profile;
}

/**
 * An ACTIVE accountant (or the owner, who can see everything). A deactivated
 * accountant is signed out of the UI immediately — the owner revoking access
 * must take effect on the next request, not at the next login.
 */
export async function requireAccountant(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login/owner?next=/accountant');
  if (profile.role === 'owner') return profile;
  if (profile.role !== 'accountant') redirect(homePathFor(profile.role));
  if (!profile.isActive) redirect('/login/owner?disabled=1');
  return profile;
}

/**
 * Gate for anything privileged. Redirects a signed-out user to login and
 * throws `forbidden` for a signed-in user who lacks the permission — server
 * actions surface that as a failed result rather than a broken page.
 */
export async function requirePermission(permission: Permission): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'owner' && !profile.isActive) throw new Error('forbidden');
  if (!can(profile.role, permission)) throw new Error('forbidden');
  return profile;
}

/**
 * Non-redirecting variant for server actions: returns the profile or null.
 * Callers map null onto `{ ok: false, error: 'forbidden' }`.
 */
export async function checkPermission(
  permission: Permission,
): Promise<SessionProfile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  if (profile.role !== 'owner' && !profile.isActive) return null;
  return can(profile.role, permission) ? profile : null;
}
