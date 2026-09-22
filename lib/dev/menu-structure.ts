/*
 * Static detection of Base UI menu parts used outside the context they require.
 *
 * WHY THIS EXISTS
 *
 * 2026-09-22, reported by the client: "when the admin clicks the 'JN' profile
 * initials, the application crashes instead of opening the profile."
 *
 * `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, and `Menu.GroupLabel`
 * calls `useMenuGroupRootContext()`, which THROWS when there is no
 * `<Menu.Group>` above it:
 *
 *   "Base UI: MenuGroupContext is missing. Menu group parts must be used
 *    within <Menu.Group> or <Menu.RadioGroup>."
 *
 * `components/nav-user.tsx` rendered the label directly inside the popup. The
 * popup is only mounted when the trigger is CLICKED, so nothing was wrong
 * until a person clicked the avatar — at which point the throw propagated to
 * the error boundary and took the whole back office down.
 *
 * Every existing gate missed it, and for the same reason each time:
 *   • `npm run build` never opens a menu.
 *   • `npm run test:smoke` requests pages; it does not click anything.
 *   • vitest here is node-only, so no component is ever rendered.
 *
 * It is, however, plainly visible in the source — a label with no group
 * around it — which is what this module reads. Same approach as
 * `rsc-boundary.ts`: a text scanner, no compiler, milliseconds inside
 * `npm run verify`.
 *
 * WHAT IT DOES NOT COVER — stated so nobody trusts it for more than it does:
 * a label reached through a wrapper component defined in another file, a group
 * rendered conditionally by a helper, and every other Base UI context
 * requirement (submenus, radio items). A jsdom + Testing Library click test
 * would be the real guard; this is the guard that fits the current setup.
 */

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { collectSourceFiles } from './rsc-boundary';

export type MenuViolation = {
  /** Repo-relative path of the offending file. */
  file: string;
  /** 1-indexed line, so the message is clickable in a terminal. */
  line: number;
  /** The part that was used outside its required context. */
  part: string;
  message: string;
};

/**
 * Parts that throw without an enclosing group, mapped to the wrappers that
 * satisfy them.
 *
 * Only `DropdownMenuLabel` is listed today because it is the only group part
 * this codebase uses. Adding `DropdownMenuRadioItem` here would need
 * `DropdownMenuRadioGroup` as its wrapper.
 */
const REQUIRES_GROUP: Record<string, readonly string[]> = {
  DropdownMenuLabel: ['DropdownMenuGroup', 'DropdownMenuRadioGroup'],
};

const GROUP_TAGS = new Set(['DropdownMenuGroup', 'DropdownMenuRadioGroup']);

export type Tag = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  index: number;
};

/**
 * Find the `>` that ends a JSX tag opened at `start`.
 *
 * A naive `indexOf('>')` is wrong: props hold arrow functions
 * (`onClick={() => …}`), comparisons and generics, all of which contain `>`
 * inside braces or strings. So brace depth and quoting are tracked, and only a
 * `>` at depth 0 outside a string ends the tag. Returns -1 when the tag never
 * closes (a truncated or malformed file).
 */
function findTagEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i;
  }
  return -1;
}

/** Every menu tag in a source file, in document order. */
export function parseMenuTags(source: string): Tag[] {
  const interesting = new Set([...GROUP_TAGS, ...Object.keys(REQUIRES_GROUP)]);
  const tags: Tag[] = [];
  const pattern = /<(\/?)([A-Z][A-Za-z0-9]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[2];
    if (!name || !interesting.has(name)) continue;
    const closing = match[1] === '/';
    const end = findTagEnd(source, match.index);
    tags.push({
      name,
      closing,
      selfClosing: !closing && end > 0 && source[end - 1] === '/',
      index: match.index,
    });
  }
  return tags;
}

/**
 * Parts rendered outside the group they require, within one source file.
 *
 * Tags are walked in document order with a stack of open groups. A part is a
 * violation when that stack holds none of its accepted wrappers.
 */
export function findMenuViolationsInSource(source: string, file: string): MenuViolation[] {
  const violations: MenuViolation[] = [];
  const open: string[] = [];

  for (const tag of parseMenuTags(source)) {
    if (GROUP_TAGS.has(tag.name)) {
      if (tag.closing) {
        const at = open.lastIndexOf(tag.name);
        if (at !== -1) open.splice(at, 1);
      } else if (!tag.selfClosing) {
        open.push(tag.name);
      }
      continue;
    }

    const wrappers = REQUIRES_GROUP[tag.name];
    if (!wrappers || tag.closing) continue;
    if (wrappers.some((w) => open.includes(w))) continue;

    violations.push({
      file,
      line: source.slice(0, tag.index).split('\n').length,
      part: tag.name,
      message:
        `<${tag.name}> is outside <${wrappers[0]}>. Base UI throws ` +
        `"MenuGroupContext is missing" when the menu is opened, which crashes ` +
        `the page the moment somebody clicks the trigger.`,
    });
  }

  return violations;
}

/** Scan app/, components/ and lib/ for menu parts used outside their group. */
export function findMenuViolations(rootInput: string): MenuViolation[] {
  const root = resolve(rootInput);
  const violations: MenuViolation[] = [];
  for (const file of collectSourceFiles(root)) {
    if (!file.endsWith('.tsx')) continue;
    const source = readFileSync(file, 'utf8');
    violations.push(...findMenuViolationsInSource(source, relative(root, file)));
  }
  return violations;
}

/** Human-readable report for a failing test. */
export function formatMenuViolations(violations: MenuViolation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  ${v.message}`).join('\n');
}
