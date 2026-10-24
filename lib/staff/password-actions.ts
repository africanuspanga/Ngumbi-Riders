'use server';

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSessionProfile } from '@/lib/auth/session';
import { checkLoginRateLimit, recordLoginAttempt } from '@/lib/auth/rate-limit';
import { checkStaffPassword, staffPhone } from '@/lib/auth/staff-otp';
import { sessionIdFromAccessToken } from '@/lib/auth/staff-otp-core';
import { getClientIp } from '@/lib/security/request';
import { sendSms } from '@/lib/mobishastra/client';
import { writeAudit } from '@/lib/audit/audit';
import { changeOwnPasswordSchema } from './validation';

/*
 * A staff member (owner or accountant) changing their OWN password.
 *
 * - The current password is checked on a throwaway client, exactly like step 1
 *   of sign-in, and a wrong one counts toward the same lockout — so this form
 *   cannot be used to guess the password of a laptop left signed in.
 * - The new password is set with the service role AFTER that check; the
 *   browser never needs a "recent sign-in" nonce.
 * - Every OTHER verified session of this person is forgotten (0037), so a
 *   device signed in with the old password loses staff access on its next
 *   query. The session making the change keeps working.
 * - An SMS tells the person their password changed. If it was not them, that
 *   text is how they find out.
 */

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'wrong_current' | 'locked' | 'update_failed' | 'validation';
      message?: string;
      field?: 'currentPassword' | 'newPassword' | 'confirmPassword';
    };

export async function changeOwnPassword(input: unknown): Promise<ChangePasswordResult> {
  const me = await getSessionProfile();
  if (!me || (me.role !== 'owner' && me.role !== 'accountant')) return { ok: false, error: 'forbidden' };
  if (me.role !== 'owner' && !me.isActive) return { ok: false, error: 'forbidden' };

  const parsed = changeOwnPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: 'validation',
      message: issue?.message,
      field: issue?.path[0] as 'currentPassword' | 'newPassword' | 'confirmPassword' | undefined,
    };
  }

  const admin = createAdminClient();
  const { data: userData } = await admin.auth.admin.getUserById(me.userId);
  const email = userData?.user?.email;
  if (!email) return { ok: false, error: 'update_failed' };

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders);
  const decision = await checkLoginRateLimit(email, ip);
  if (!decision.allowed) return { ok: false, error: 'locked' };

  const check = await checkStaffPassword({ email }, parsed.data.currentPassword);
  if (!check.ok || check.userId !== me.userId) {
    await recordLoginAttempt({
      phone: email,
      ip,
      outcome: 'invalid_credentials',
      userAgent: requestHeaders.get('user-agent'),
    });
    return { ok: false, error: 'wrong_current', field: 'currentPassword' };
  }

  const { error } = await admin.auth.admin.updateUserById(me.userId, {
    password: parsed.data.newPassword,
  });
  if (error) return { ok: false, error: 'update_failed' };

  // Forget every other device. Only when the current session is known —
  // deleting blind would also sign out the person making the change.
  const supabase = await createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const currentSessionId = session ? sessionIdFromAccessToken(session.access_token) : null;
  if (currentSessionId) {
    await admin
      .from('staff_verified_sessions')
      .delete()
      .eq('user_id', me.userId)
      .neq('session_id', currentSessionId);
  }

  await writeAudit({
    actorId: me.userId,
    actorRole: me.role,
    action: `${me.role}.password_changed`,
    entityType: 'profile',
    entityId: me.userId,
    ip,
  });

  const phone = await staffPhone(me.userId);
  if (phone) {
    await sendSms({
      to: phone,
      text:
        "Ng'umbi Riders: nywila yako ya kuingia imebadilishwa sasa hivi. Kama si wewe, " +
        'mjulishe Mkurugenzi mara moja. / Your sign-in password was just changed.',
    }).catch(() => undefined);
  }

  return { ok: true };
}
