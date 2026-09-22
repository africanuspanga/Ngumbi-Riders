/*
 * The gate that keeps "clicking the avatar crashes the app" out of production.
 *
 * `components/nav-user.tsx` rendered `DropdownMenuLabel` outside
 * `DropdownMenuGroup`. Base UI's `Menu.GroupLabel` throws without that
 * context, and a menu popup is only mounted when its trigger is clicked — so
 * the back office rendered perfectly until somebody clicked the "JN" initials,
 * and then every page went to the error boundary.
 *
 * Nothing in the existing done-gate could see it: the build never opens a
 * menu, the smoke test requests pages without clicking, and vitest here is
 * node-only. The source, however, says it plainly. This test reads the source.
 * If it fails, that menu WILL crash when opened — fix it, do not skip it.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  findMenuViolations,
  findMenuViolationsInSource,
  formatMenuViolations,
  parseMenuTags,
} from '@/lib/dev/menu-structure';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('Base UI menu structure — the repository', () => {
  it('renders every DropdownMenuLabel inside a group', () => {
    const violations = findMenuViolations(REPO_ROOT);
    expect(violations.length === 0 ? '' : '\n' + formatMenuViolations(violations) + '\n').toBe('');
  });
});

describe('findMenuViolationsInSource', () => {
  it('flags a label rendered directly in the popup — the shipped bug', () => {
    const source = `
      <DropdownMenuContent>
        <DropdownMenuLabel>Africanus</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>Sign out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>`;
    const violations = findMenuViolationsInSource(source, 'nav-user.tsx');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ part: 'DropdownMenuLabel', line: 3 });
  });

  it('accepts a label inside a group', () => {
    const source = `
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Africanus</DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>`;
    expect(findMenuViolationsInSource(source, 'ok.tsx')).toEqual([]);
  });

  it('accepts a radio group as the wrapper', () => {
    const source = `
      <DropdownMenuRadioGroup value={v}>
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
      </DropdownMenuRadioGroup>`;
    expect(findMenuViolationsInSource(source, 'ok.tsx')).toEqual([]);
  });

  it('does not treat a CLOSED group as still open', () => {
    const source = `
      <DropdownMenuGroup>
        <DropdownMenuItem>A</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuLabel>Stray</DropdownMenuLabel>`;
    expect(findMenuViolationsInSource(source, 'bad.tsx')).toHaveLength(1);
  });

  it('does not treat a SELF-CLOSED group as an open wrapper', () => {
    const source = `
      <DropdownMenuGroup />
      <DropdownMenuLabel>Stray</DropdownMenuLabel>`;
    expect(findMenuViolationsInSource(source, 'bad.tsx')).toHaveLength(1);
  });
});

describe('parseMenuTags', () => {
  /*
   * The reason the scanner cannot just look for the next '>': props routinely
   * contain one. A naive parser reads `onClick={() => x}` as the end of the
   * tag, decides the group is self-closing, and then reports a false failure
   * on a perfectly correct menu.
   */
  it('finds the end of a tag whose props contain an arrow function', () => {
    const tags = parseMenuTags(`<DropdownMenuGroup onSelect={() => pick(1)}>x</DropdownMenuGroup>`);
    expect(tags.map((t) => [t.name, t.closing, t.selfClosing])).toEqual([
      ['DropdownMenuGroup', false, false],
      ['DropdownMenuGroup', true, false],
    ]);
  });

  it('ignores a > inside a string prop', () => {
    const tags = parseMenuTags(`<DropdownMenuGroup className="a > b" />`);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ selfClosing: true });
  });

  it('ignores menu parts that need no group', () => {
    expect(parseMenuTags(`<DropdownMenuItem>A</DropdownMenuItem>`)).toEqual([]);
  });
});
