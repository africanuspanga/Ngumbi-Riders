import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Unit tests run in node; RLS integration tests talk to a live Supabase
    // (local `supabase start` or a provided project) via env vars.
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only`/`client-only` throw under plain Node. Neutralise them so
      // server modules (admin client, PIN derivation, provisioning) can be
      // exercised by unit and RLS integration tests.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/empty.ts', import.meta.url),
      ),
      'client-only': fileURLToPath(
        new URL('./tests/stubs/empty.ts', import.meta.url),
      ),
    },
  },
});
