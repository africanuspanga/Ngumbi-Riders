import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { clientEnv, serverEnv } from '@/lib/env';
import { tryNormalizePhone } from '@/lib/auth/phone';
import { sendSms } from '@/lib/mobishastra/client';
import {
  OTP_POLICY,
  canResend,
  checkOtp,
  generateOtpCode,
  hashOtpCode,
  maskPhone,
  otpSmsText,
  sessionIdFromAccessToken,
} from './staff-otp-core';

/*
 * Staff SMS sign-in codes, the server half (D-053; pure rules in
 * ./staff-otp-core.ts).
 *
 *   1. /api/auth/owner-login checks the password on a THROWAWAY client — no
 *      cookie is written — and calls startStaffChallenge(), which texts a code.
 *   2. /api/auth/owner-login/verify calls verifyStaffChallenge(); on success
 *      mintVerifiedStaffSession() creates the real cookie session and records
 *      its session_id in staff_verified_sessions, which is what the RLS
 *      helpers (0037 staff_session_ok) look for.
 *
 * The password is never stored between the two steps: the second step mints a
 * session with an admin-generated one-time login (the same mechanism the smoke
 * test uses — generateLink generates, it does not send mail).
 */

export type StaffChallengeStart =
  | { ok: true; challengeId: string; maskedPhone: string }
  | { ok: false; error: 'no_phone' | 'too_many_codes' | 'sms_failed' | 'server_error' };

/** The kill switch (app_settings.staff_otp_required). Fails CLOSED. */
export async function isStaffOtpRequired(): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('staff_otp_required')
    .limit(1)
    .maybeSingle();
  // An unreadable setting must not silently drop the second factor.
  if (error || !data) return true;
  return data.staff_otp_required;
}

/** The phone on the auth user (where the owner set it), as E.164, or null. */
export async function staffPhone(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.phone) return null;
  return tryNormalizePhone(data.user.phone);
}

export async function startStaffChallenge(input: {
  userId: string;
  ip: string;
}): Promise<StaffChallengeStart> {
  const phone = await staffPhone(input.userId);
  if (!phone) return { ok: false, error: 'no_phone' };

  const admin = createAdminClient();
  const since = new Date(Date.now() - OTP_POLICY.windowSeconds * 1000).toISOString();
  const { count, error: countError } = await admin
    .from('staff_login_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', input.userId)
    .gte('created_at', since);
  if (countError) return { ok: false, error: 'server_error' };
  if ((count ?? 0) >= OTP_POLICY.maxChallengesPerWindow) return { ok: false, error: 'too_many_codes' };

  const challengeId = crypto.randomUUID();
  const code = generateOtpCode();
  const { error: insertError } = await admin.from('staff_login_challenges').insert({
    id: challengeId,
    user_id: input.userId,
    code_hash: hashOtpCode(serverEnv().AUTH_PIN_PEPPER, challengeId, code),
    phone,
    expires_at: new Date(Date.now() + OTP_POLICY.ttlSeconds * 1000).toISOString(),
    ip: input.ip,
  });
  if (insertError) return { ok: false, error: 'server_error' };

  const sent = await sendSms({ to: phone, text: otpSmsText(code) });
  if (!sent.ok) {
    // A code nobody received must not stay guessable.
    await admin
      .from('staff_login_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challengeId);
    console.error('[staff-otp] SMS failed:', sent.error);
    return { ok: false, error: 'sms_failed' };
  }
  return { ok: true, challengeId, maskedPhone: maskPhone(phone) };
}

type ChallengeRow = {
  id: string;
  user_id: string;
  code_hash: string;
  phone: string;
  expires_at: string;
  attempts: number;
  sent_count: number;
  last_sent_at: string;
  consumed_at: string | null;
};

async function loadChallenge(challengeId: string): Promise<ChallengeRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('staff_login_challenges')
    .select('id, user_id, code_hash, phone, expires_at, attempts, sent_count, last_sent_at, consumed_at')
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw new Error(`loadChallenge failed: ${error.message}`);
  return data as ChallengeRow | null;
}

export type StaffResend =
  | { ok: true; maskedPhone: string }
  | { ok: false; error: 'not_found' | 'consumed' | 'too_many_sends' | 'too_many_attempts' | 'cooldown' | 'sms_failed' | 'server_error'; retryAfterSeconds?: number };

/** Send a NEW code on the same challenge (the old one stops working). */
export async function resendStaffChallenge(challengeId: string): Promise<StaffResend> {
  const row = await loadChallenge(challengeId);
  if (!row) return { ok: false, error: 'not_found' };
  const verdict = canResend({
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    sentCount: row.sent_count,
    lastSentAt: new Date(row.last_sent_at),
    attempts: row.attempts,
  });
  if (!verdict.ok) return { ok: false, error: verdict.reason, retryAfterSeconds: verdict.retryAfterSeconds };

  const code = generateOtpCode();
  const admin = createAdminClient();
  // Conditional on sent_count so two simultaneous resends cannot both pass.
  const { data: updated, error } = await admin
    .from('staff_login_challenges')
    .update({
      code_hash: hashOtpCode(serverEnv().AUTH_PIN_PEPPER, row.id, code),
      sent_count: row.sent_count + 1,
      last_sent_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + OTP_POLICY.ttlSeconds * 1000).toISOString(),
    })
    .eq('id', row.id)
    .eq('sent_count', row.sent_count)
    .is('consumed_at', null)
    .select('id');
  if (error) return { ok: false, error: 'server_error' };
  if (!updated?.length) return { ok: false, error: 'cooldown', retryAfterSeconds: OTP_POLICY.resendCooldownSeconds };

  const sent = await sendSms({ to: row.phone, text: otpSmsText(code) });
  if (!sent.ok) {
    console.error('[staff-otp] SMS resend failed:', sent.error);
    return { ok: false, error: 'sms_failed' };
  }
  return { ok: true, maskedPhone: maskPhone(row.phone) };
}

export type StaffVerify =
  | { ok: true; userId: string; challengeId: string }
  | { ok: false; error: 'not_found' | 'consumed' | 'expired' | 'too_many_attempts' | 'malformed' | 'wrong_code'; attemptsLeft?: number };

/** Check a code and, if right, consume the challenge exactly once. */
export async function verifyStaffChallenge(challengeId: string, code: string): Promise<StaffVerify> {
  const row = await loadChallenge(challengeId);
  if (!row) return { ok: false, error: 'not_found' };

  const verdict = checkOtp(
    {
      codeHash: row.code_hash,
      expiresAt: new Date(row.expires_at),
      attempts: row.attempts,
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    },
    { pepper: serverEnv().AUTH_PIN_PEPPER, challengeId: row.id, code },
  );

  const admin = createAdminClient();
  if (!verdict.ok) {
    if (verdict.reason === 'wrong_code') {
      // Conditional on the attempts we read: concurrent guesses cannot share
      // one count. A lost race simply re-reads as a burned attempt next time.
      await admin
        .from('staff_login_challenges')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id)
        .eq('attempts', row.attempts);
      return {
        ok: false,
        error: 'wrong_code',
        attemptsLeft: Math.max(OTP_POLICY.maxAttempts - row.attempts - 1, 0),
      };
    }
    return { ok: false, error: verdict.reason };
  }

  // Consume atomically: of two simultaneous correct submissions, one wins.
  const { data: consumed, error } = await admin
    .from('staff_login_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id');
  if (error || !consumed?.length) return { ok: false, error: 'consumed' };
  return { ok: true, userId: row.user_id, challengeId: row.id };
}

/**
 * Create the browser's session for a user who has passed the code, and record
 * it as verified. Writes the auth cookies through the request's cookie store.
 */
export async function mintVerifiedStaffSession(input: {
  userId: string;
  challengeId: string | null;
  /**
   * false while the kill switch is off: recording the session is then only a
   * courtesy (so switching codes on later does not sign this person out), and
   * a failure — e.g. the app deployed before migration 0037 — must not block
   * the sign-in.
   */
  mustRecord: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(input.userId);
  const email = userData?.user?.email;
  if (userError || !email) return { ok: false, error: 'no_email' };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const otp = link?.properties?.email_otp;
  if (linkError || !otp) return { ok: false, error: 'link_failed' };

  const supabase = await createServerSupabase();
  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: otp,
    type: 'email',
  });
  if (verifyError || !verified.session) return { ok: false, error: 'session_failed' };

  const sessionId = sessionIdFromAccessToken(verified.session.access_token);
  if (!sessionId && !input.mustRecord) return { ok: true };
  if (!sessionId) {
    await supabase.auth.signOut({ scope: 'local' });
    return { ok: false, error: 'no_session_id' };
  }
  const { error: recordError } = await admin.from('staff_verified_sessions').insert({
    session_id: sessionId,
    user_id: input.userId,
    challenge_id: input.challengeId,
  });
  if (recordError && input.mustRecord) {
    await supabase.auth.signOut({ scope: 'local' });
    return { ok: false, error: 'record_failed' };
  }
  return { ok: true };
}

/**
 * Check a password WITHOUT creating a browser session: a throwaway client with
 * no storage. The session Supabase opens for it is revoked straight away — it
 * was never verified, so RLS would refuse it anyway, but it should not linger.
 */
export async function checkStaffPassword(
  identifier: { phone: string } | { email: string },
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const probe = createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } =
    'phone' in identifier
      ? await probe.auth.signInWithPassword({ phone: identifier.phone, password })
      : await probe.auth.signInWithPassword({ email: identifier.email, password });
  if (error || !data.user) return { ok: false };
  await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return { ok: true, userId: data.user.id };
}

/** Is the CURRENT request's staff session one that passed the code? */
export async function currentStaffSessionOk(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('staff_session_ok');
  // Before 0037 is applied the function does not exist: behave as before.
  if (error) return error.code === 'PGRST202' || error.code === '42883';
  return data === true;
}
