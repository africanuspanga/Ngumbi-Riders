/*
 * Dead internal links (client report 2026-10-23: "it still happened to some
 * page — can we finally remove this fully").
 *
 * Every internal href written in the source must resolve to a real page or
 * API route. The accountant's rider profile linked to
 * /accountant/contracts/[id] and /accountant/motorcycles/[id] for months —
 * neither existed, so both were a 404 the build never noticed (the build does
 * not follow links) and the smoke test never saw (it requests pages, it does
 * not click them).
 *
 * This reads the source: string and template literals starting with a
 * role-area path. `${…}` interpolations become wildcards; anything after a
 * `?` or `#` is ignored. Pure apart from node:fs, so it runs in vitest.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCAN_DIRS = ['app', 'components', 'lib'];
const IGNORED = new Set(['node_modules', '.next', 'dev']);
const LINK = /[`'"](\/(?:owner|accountant|rider|apply|login)(?:\/[^`'"\s?#]*)?)[`'"?#]/g;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

/** URL patterns of every page and route handler, as regexes. */
export function routeMatchers(appDir: string): RegExp[] {
  const files: string[] = [];
  walk(appDir, files);
  return files
    .filter((f) => /\/(page|route)\.tsx?$/.test(f))
    .map((f) =>
      ('/' + relative(appDir, f))
        .replace(/\/(page|route)\.tsx?$/, '')
        .replace(/\/\([^)]+\)/g, '') || '/',
    )
    .map(
      (pattern) =>
        new RegExp(
          '^' +
            pattern
              .replace(/\[\[?\.\.\.[^\]]+\]\]?/g, '.+')
              .replace(/\[[^\]]+\]/g, '[^/]+') +
            '/?$',
        ),
    );
}

export type DeadLink = { file: string; line: number; href: string };

export function findDeadLinksInSource(source: string, matchers: RegExp[]): { line: number; href: string }[] {
  const out: { line: number; href: string }[] = [];
  for (const m of source.matchAll(LINK)) {
    const href = m[1]!;
    // A template interpolation stands for one path segment (an id).
    const path = href.replace(/\$\{[^}]*\}/g, 'X');
    // A literal that ENDS mid-interpolation (`/owner/${base}`) or is a base
    // path concatenated with more later (`/owner/payments/rider` + id) cannot
    // be judged from the source alone; only judge complete paths.
    if (path.includes('${')) continue;
    if (matchers.some((r) => r.test(path))) continue;
    out.push({ line: source.slice(0, m.index).split('\n').length, href });
  }
  return out;
}

/** Literals that are deliberately NOT links (prefixes, revalidation paths). */
const ALLOWED: RegExp[] = [
  // `${basePath}/payments/rider/${id}` is built from this prefix at runtime.
  /^\/(owner|accountant)\/payments\/rider$/,
];

export function findDeadLinks(repoRoot: string): DeadLink[] {
  const matchers = routeMatchers(join(repoRoot, 'app'));
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(repoRoot, d), files);
  const dead: DeadLink[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const d of findDeadLinksInSource(source, matchers)) {
      if (ALLOWED.some((r) => r.test(d.href))) continue;
      // revalidatePath() of a page that does not exist is harmless and not a link.
      const lineText = source.split('\n')[d.line - 1] ?? '';
      if (/revalidatePath\(/.test(lineText)) continue;
      dead.push({ file: relative(repoRoot, file), ...d });
    }
  }
  return dead;
}
