import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Tailwind v4 dropped the v3 shorthand `utility-[--css-var]`. v4 compiles it to
 * the literal, invalid `border-radius: --radius-card` — no error, no warning,
 * the declaration is simply ignored by the browser. 485 elements rendered with
 * square corners for months this way (design pass 2026-10-24). The v4 spelling
 * is `utility-(--css-var)`.
 */
const ROOTS = ['app', 'components', 'lib'];
const V3_VAR = /\b[a-z][a-z0-9-]*-\[--[a-zA-Z0-9-]+\]/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('Tailwind v4 syntax', () => {
  it('never uses the v3 `utility-[--var]` form (it compiles to invalid CSS)', () => {
    const hits = ROOTS.flatMap(files).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(V3_VAR)].map((m) => `${file}: ${m[0]} → use ${m[0].replace('-[', '-(').replace(/\]$/, ')')}`),
    );
    expect(hits).toEqual([]);
  });
});
