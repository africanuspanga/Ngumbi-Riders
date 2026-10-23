/*
 * The gate that keeps "clicking that link gives a 404" out of production
 * (client report 2026-10-23). If this fails, a link in the source points at a
 * page that does not exist: create the page or fix the link — do not skip it.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { findDeadLinks, findDeadLinksInSource } from '@/lib/dev/dead-links';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('internal links — the repository', () => {
  it('every internal href resolves to a real page or route', () => {
    const dead = findDeadLinks(REPO_ROOT);
    const report = dead.map((d) => `${d.file}:${d.line}  ${d.href}`).join('\n');
    expect(report === '' ? '' : `\n${report}\n`).toBe('');
  });
});

describe('findDeadLinksInSource', () => {
  const matchers = [/^\/owner\/contracts\/[^/]+\/?$/, /^\/accountant\/contracts\/?$/];

  it('flags a link to a page that does not exist — the shipped bug', () => {
    const src = 'contractHref={(cid) => `/accountant/contracts/${cid}`}';
    expect(findDeadLinksInSource(src, matchers)).toEqual([
      { line: 1, href: '/accountant/contracts/${cid}' },
    ]);
  });

  it('accepts dynamic segments and ignores query strings', () => {
    expect(findDeadLinksInSource('href={`/owner/contracts/${c.id}`}', matchers)).toEqual([]);
    expect(findDeadLinksInSource("href='/accountant/contracts?tab=all'", matchers)).toEqual([]);
  });
});
