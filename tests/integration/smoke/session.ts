/*
 * Minting real signed-in sessions for the smoke test, without knowing anybody's
 * password.
 *
 * Owner and accountant are email users, so the service role generates a
 * one-time OTP for them (`generateLink` GENERATES, it does not send mail — no
 * email reaches the real owner). Riders are phone-only with no email address,
 * so no OTP can be generated for them; a rider session needs a real phone and
 * PIN supplied through the environment. See the header of routes.test.ts.
 *
 * The session cookies are produced by @supabase/ssr itself, writing into a jar
 * we own, rather than hand-assembled here. The cookie name, the base64 framing
 * and the chunking of long values are all internal details of that library —
 * spelling them out by hand would work today and silently break on upgrade,
 * which is precisely the failure mode this suite exists to catch.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

export type CookieJar = Map<string, string>;

/** Serialize the jar into a request `Cookie:` header. */
export function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function adminClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Wrap a session's tokens in the cookies the app will accept.
 *
 * `setSession` makes the library write through the cookie adapter exactly as it
 * would in a real request, so whatever format this version uses is the format
 * we send.
 */
async function jarFromTokens(
  url: string,
  publishableKey: string,
  accessToken: string,
  refreshToken: string,
): Promise<CookieJar> {
  const jar: CookieJar = new Map();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) jar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  if (jar.size === 0) throw new Error('no session cookies were written');
  return jar;
}

/**
 * A signed-in cookie jar for an email user, via an admin-generated OTP.
 *
 * Nothing is written to the user's row and no mail is sent; the OTP is consumed
 * immediately by verifyOtp, which is what yields the session.
 */
export async function sessionForEmail(opts: {
  url: string;
  serviceRoleKey: string;
  publishableKey: string;
  email: string;
}): Promise<CookieJar> {
  const admin = adminClient(opts.url, opts.serviceRoleKey);
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: opts.email,
  });
  if (error) throw new Error(`generateLink(${opts.email}) failed: ${error.message}`);

  const otp = data.properties?.email_otp;
  if (!otp) throw new Error(`no email_otp returned for ${opts.email}`);

  const verifier = createClient(opts.url, opts.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.verifyOtp({
    email: opts.email,
    token: otp,
    type: 'email',
  });
  if (verifyError || !verified.session) {
    throw new Error(`verifyOtp(${opts.email}) failed: ${verifyError?.message ?? 'no session'}`);
  }

  return jarFromTokens(
    opts.url,
    opts.publishableKey,
    verified.session.access_token,
    verified.session.refresh_token,
  );
}

/**
 * A signed-in cookie jar for a rider, by going through the app's OWN login
 * route with a real phone and PIN.
 *
 * Deliberately not a direct Supabase call: the route derives the password from
 * the pepper, enforces the rate limit and refuses a disabled rider, so driving
 * it means the smoke run also proves rider login still works end to end. The
 * cookies come straight off its Set-Cookie header.
 */
export async function sessionForRider(opts: {
  baseUrl: string;
  phone: string;
  pin: string;
}): Promise<CookieJar> {
  const response = await fetch(new URL('/api/auth/rider-login', opts.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: opts.phone, pin: opts.pin }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `rider-login returned ${response.status}. ` +
        `Check SMOKE_RIDER_PHONE / SMOKE_RIDER_PIN — a wrong PIN counts toward ` +
        `the lockout for that rider. Body: ${body.slice(0, 200)}`,
    );
  }

  const jar: CookieJar = new Map();
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (!pair || eq <= 0) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  if (jar.size === 0) throw new Error('rider-login set no cookies');
  return jar;
}
