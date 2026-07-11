import { z } from 'zod';

/*
 * Centralised, validated environment access.
 *
 * `clientEnv` holds ONLY NEXT_PUBLIC_* values and is safe to import anywhere.
 * `serverEnv()` reads secrets and MUST be called from server code only. The
 * modules that consume it (lib/supabase/admin.ts, lib/auth/*) import
 * `server-only`, so any attempt to pull a secret into a client bundle fails the
 * build. This keeps the service-role key, PIN pepper, Snippe and Resend
 * credentials out of the browser (spec §25.2, §36.8).
 */

// ---- Public (browser-safe) ----------------------------------------------
const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_URL:
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

// ---- Server-only ---------------------------------------------------------
// .env files keep placeholder keys around (`KEY=`); an empty value means
// "not configured" and must behave exactly like an absent one instead of
// failing format validation and crashing the first server use.
const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalEmail = z.preprocess(emptyAsUndefined, z.string().email().optional());

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
  AUTH_PIN_PEPPER: z
    .string()
    .min(32, 'AUTH_PIN_PEPPER must be at least 32 characters'),
  PII_ENCRYPTION_KEY: z
    .string()
    .min(32, 'PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key'),
  // Integration secrets are optional until their phase is configured.
  SNIPPE_API_KEY: z.string().optional(),
  SNIPPE_WEBHOOK_SECRET: z.string().optional(),
  SNIPPE_BASE_URL: z.preprocess(emptyAsUndefined, z.string().url().optional()),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: optionalEmail,
  OWNER_SUMMARY_EMAIL: optionalEmail,
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loudly at first server use rather than leaking undefined secrets.
    throw new Error(
      `Invalid server environment:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  cached = parsed.data;
  return cached;
}
