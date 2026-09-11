/*
 * Run SQL against the LIVE database through the Supabase Management API.
 *
 * There is no local Postgres and no DB password on this machine (D-029), so
 * this endpoint is how every schema change since go-live has been applied.
 *
 *   npx tsx scripts/db-query.ts --file supabase/migrations/0030_x.sql
 *   npx tsx scripts/db-query.ts --sql "select 1"
 *   npx tsx scripts/db-query.ts --file x.sql --dry-run
 *
 * --dry-run wraps the SQL in BEGIN … ROLLBACK so NOTHING is committed. That
 * wrapper is only trustworthy if the endpoint honours an explicit transaction,
 * so `--prove-rollback` tests exactly that with a throwaway table before you
 * rely on it. Run it first. A dry run you have not proved is a dry run you are
 * guessing about.
 *
 * Output is JSON on stdout so callers can assert on it.
 */
import { readFileSync } from 'node:fs';
import { loadEnv } from './load-env';

loadEnv();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'rdofxxxdrqnhtewwzous';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is not set (.env.local). Refusing to run.');
  process.exit(1);
}

async function run(sql: string): Promise<unknown> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(
      `HTTP ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );
    (err as Error & { body?: unknown }).body = body;
    throw err;
  }
  return body;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  /*
   * THE NEGATIVE CONTROL for the dry-run mechanism itself.
   *
   * Creates a table inside BEGIN … ROLLBACK, then checks it is gone. If the
   * endpoint were to ignore the explicit transaction, this prints FAILED and
   * every later --dry-run must be treated as a real apply.
   */
  if (has('prove-rollback')) {
    const probe = `_dryrun_probe_${Date.now()}`;
    await run(`BEGIN;\ncreate table public.${probe} (x int);\nROLLBACK;`);
    const after = (await run(
      `select to_regclass('public.${probe}') is null as rolled_back;`,
    )) as { rolled_back: boolean }[];
    const ok = Array.isArray(after) && after[0]?.rolled_back === true;
    console.log(
      JSON.stringify(
        {
          check: 'rollback-honoured',
          result: ok ? 'PASSED' : 'FAILED',
          detail: ok
            ? 'BEGIN … ROLLBACK is honoured; --dry-run commits nothing.'
            : 'The probe table SURVIVED a ROLLBACK. Do NOT trust --dry-run.',
        },
        null,
        2,
      ),
    );
    process.exit(ok ? 0 : 1);
  }

  const file = arg('file');
  const inline = arg('sql');
  let sql = file ? readFileSync(file, 'utf8') : inline;
  if (!sql) {
    console.error('Pass --file <path>, --sql "<query>", or --prove-rollback.');
    process.exit(1);
  }

  // Extra assertions to run INSIDE the same transaction as the migration.
  const assertFile = arg('assert');
  if (assertFile) sql = `${sql}\n\n${readFileSync(assertFile, 'utf8')}`;

  if (has('dry-run')) sql = `BEGIN;\n${sql}\nROLLBACK;`;

  try {
    const out = await run(sql);
    console.log(JSON.stringify({ ok: true, dryRun: has('dry-run'), result: out }, null, 2));
  } catch (e) {
    console.log(
      JSON.stringify({ ok: false, dryRun: has('dry-run'), error: (e as Error).message }, null, 2),
    );
    process.exit(1);
  }
}

void main();
