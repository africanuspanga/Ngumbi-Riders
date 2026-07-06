// Vitest global setup. Runs before any test module is imported, so the env is
// populated before lib/env parses the public schema at import time.
//
// Unit tests (phone/PIN/money/dates/lockout) need no real backend and rely on
// the dummy fallbacks below. RLS integration tests read real values from
// .env.test / .env.local and connect to a live Supabase.
import { config } from 'dotenv';

config({ path: '.env.test' });
config({ path: '.env.local' });

// Public (browser-safe) fallbacks so lib/env's clientEnv.parse() succeeds.
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';

// Server-only fallbacks for pure crypto tests (overridden by real env if set).
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.AUTH_PIN_PEPPER ??=
  'test-only-pepper-please-override-with-32+chars-in-env';
process.env.PII_ENCRYPTION_KEY ??=
  'dGVzdC1vbmx5LTMyLWJ5dGUta2V5LWJhc2U2NGVuYw==';
