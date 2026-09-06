/*
 * The gate that keeps React Server Component boundary bugs out of production.
 *
 * Two of them have shipped to the owner (formatClockDate crashing /owner,
 * editHref crashing /owner/payments/approvals). Both were invisible to
 * `npm run build`, which never executes a dynamic page, and to the rest of
 * this suite, which is node-only and renders nothing. Both were plainly
 * visible in the source.
 *
 * This test reads the source. If it fails, the named file WILL throw at
 * runtime on the page that uses it — fix it, do not skip it.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  findBoundaryViolations,
  formatViolations,
  isClientModule,
  isComponentName,
  parseImports,
  findFunctionProps,
} from '@/lib/dev/rsc-boundary';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('RSC boundary — the repository', () => {
  it('has no server module importing a non-component from a client module', () => {
    const violations = findBoundaryViolations(REPO_ROOT).filter(
      (v) => v.rule === 'non-component-import',
    );
    expect(
      violations.length === 0 ? '' : '\n' + formatViolations(violations) + '\n',
    ).toBe('');
  });

  it('passes no function props to client components', () => {
    const violations = findBoundaryViolations(REPO_ROOT).filter(
      (v) => v.rule === 'function-prop',
    );
    expect(
      violations.length === 0 ? '' : '\n' + formatViolations(violations) + '\n',
    ).toBe('');
  });
});

describe('isClientModule', () => {
  it('detects the directive on the first line', () => {
    expect(isClientModule("'use client';\nexport function A() {}")).toBe(true);
    expect(isClientModule('"use client";\n')).toBe(true);
  });

  it('detects it after the house-style leading comment', () => {
    expect(isClientModule('/*\n * Why this file exists.\n */\n\n"use client";\n')).toBe(true);
    expect(isClientModule('// a note\n\n\'use client\';\n')).toBe(true);
  });

  it('does not treat a server module as client', () => {
    expect(isClientModule("import x from 'y';\n'use client';")).toBe(false);
    expect(isClientModule('export const a = 1;')).toBe(false);
    expect(isClientModule("'use server';\n")).toBe(false);
  });
});

describe('isComponentName', () => {
  it('accepts PascalCase components', () => {
    expect(isComponentName('LiveClock')).toBe(true);
    expect(isComponentName('CashApprovalQueue')).toBe(true);
    expect(isComponentName('Badge')).toBe(true);
  });

  it('rejects helpers and hooks', () => {
    expect(isComponentName('formatClockDate')).toBe(false);
    expect(isComponentName('useSidebar')).toBe(false);
  });

  it('rejects SCREAMING_SNAKE constants that merely start with a capital', () => {
    // The exact shape that let RIDER_VIEW_COOKIE cross unnoticed: capitalised,
    // but a string constant, so the server received a throwing stub.
    expect(isComponentName('RIDER_VIEW_COOKIE')).toBe(false);
    expect(isComponentName('CONTRACT_STATUS_LABELS')).toBe(false);
  });
});

describe('parseImports', () => {
  it('reads named, default and aliased value imports', () => {
    const named = parseImports("import { A, b as c } from '@/x';")[0];
    expect(named?.names).toEqual(['A', 'b']);
    expect(named?.specifier).toBe('@/x');

    expect(parseImports("import Thing from './thing';")[0]?.names).toEqual(['Thing']);

    const both = parseImports("import Thing, { helper } from './thing';")[0];
    expect(both?.names.slice().sort()).toEqual(['Thing', 'helper']);
  });

  it('ignores type-only imports, which are erased and cannot throw', () => {
    expect(parseImports("import type { Row } from '@/x';")).toEqual([]);
    expect(parseImports("import { A, type Row } from '@/x';")[0]?.names).toEqual(['A']);
  });

  it('handles a multi-line import clause', () => {
    expect(parseImports("import {\n  A,\n  b,\n} from '@/x';")[0]?.names).toEqual(['A', 'b']);
  });
});

describe('findFunctionProps', () => {
  it('catches the editHref bug that crashed the approvals page', () => {
    const source = `<CashApprovalQueue
        requests={pending}
        canDecide
        editHref={(r) => \`/owner/payments/approvals/\${r.id}\`}
      />`;
    const found = findFunctionProps(source, ['CashApprovalQueue']);
    expect(found.map((f) => f.prop)).toEqual(['editHref']);
  });

  it('catches inline handlers and async and single-argument arrows', () => {
    expect(findFunctionProps('<C onClick={() => go()} />', ['C'])).toHaveLength(1);
    expect(findFunctionProps('<C onSave={async (v) => save(v)} />', ['C'])).toHaveLength(1);
    expect(findFunctionProps('<C fmt={v => String(v)} />', ['C'])).toHaveLength(1);
    expect(findFunctionProps('<C render={function () {}} />', ['C'])).toHaveLength(1);
  });

  it('allows serializable props, including ones containing > or =>in a string', () => {
    expect(findFunctionProps('<C editBasePath="/owner/x" count={3} ok />', ['C'])).toEqual([]);
    expect(findFunctionProps('<C label="a => b" />', ['C'])).toEqual([]);
  });

  it('does not read past the end of the tag it is inspecting', () => {
    // The arrow belongs to a sibling SERVER component, not to <C>.
    const source = '<C name="x" />\n<ServerThing hrefFor={(r) => r.id} />';
    expect(findFunctionProps(source, ['C'])).toEqual([]);
  });

  it('ignores components it was not asked about', () => {
    expect(findFunctionProps('<Other cb={() => 1} />', ['C'])).toEqual([]);
  });
});
