/*
 * Loads .env.local before any other module evaluates. Must be the FIRST
 * import of every script entrypoint — ESM hoists imports, so calling
 * dotenv's config() inline in the entrypoint runs too late for modules
 * (like lib/env.ts) that validate process.env at import time.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
