/*
 * Static detection of React Server Component boundary violations.
 *
 * WHY THIS EXISTS
 *
 * Three production incidents have now come from the same blind spot, and none
 * of them could be caught by the existing done-gate:
 *
 *   1. 2026-07-11  @hookform/resolvers v3 rethrew zod v4 errors, so every
 *                  form's Continue button silently did nothing.
 *   2. 2026-09-06  /owner called formatClockDate(), a plain function exported
 *                  from a 'use client' module. Server-side it is a client
 *                  REFERENCE, not the function, so the dashboard threw on
 *                  every request.
 *   3. 2026-09-06  /owner/payments/approvals passed editHref={(r) => …} to a
 *                  Client Component. Functions are not serializable across the
 *                  boundary, so the page threw on every request.
 *
 * `npm run build` does not execute dynamic pages, and the vitest suite is
 * node-only with no component rendering, so 2 and 3 both reached the owner.
 * They are, however, perfectly visible in the SOURCE — which is what this
 * module reads. It is deliberately a text scanner rather than a type-aware
 * pass: it needs no compiler, runs in milliseconds inside `npm run verify`,
 * and cannot itself break the build.
 *
 * THE TWO RULES
 *
 * A 'use client' module's exports reach the server as client references. Only
 * COMPONENTS may cross that boundary, and only by being rendered. Therefore:
 *
 *   Rule 1  A module without 'use client' may not import a non-component
 *           binding (a helper, a hook, a constant) from a module with it.
 *   Rule 2  A module without 'use client' may not pass a function literal as
 *           a prop to a component imported from a module with it.
 *
 * Rule 1 covers incident 2 and the RIDER_VIEW_COOKIE bug found beside it.
 * Rule 2 covers incident 3.
 *
 * WHAT IT DOES NOT COVER — stated so nobody trusts it for more than it does:
 * a function passed by reference (`onPick={handlePick}`) rather than as a
 * literal, a violation reached through a re-export chain, and every runtime
 * failure that is not a boundary problem (bad data, a null deref, a query
 * error). Those need the route smoke test, not this.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/** Directories that hold application source we care about. */
const SOURCE_DIRS = ['app', 'components', 'lib'] as const;

const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/** Never scanned: generated, vendored, or not shipped to a runtime. */
const IGNORED_SEGMENTS = new Set(['node_modules', '.next', 'dist', 'coverage']);

export type BoundaryViolation = {
  /** Repo-relative path of the offending file. */
  file: string;
  /** 1-indexed line, so the message is clickable in a terminal. */
  line: number;
  rule: 'non-component-import' | 'function-prop';
  message: string;
};

/* ------------------------------------------------------------------ *
 * Module classification
 * ------------------------------------------------------------------ */

/**
 * True when the file opens with a 'use client' directive.
 *
 * The directive must precede any statement, but comments and blank lines may
 * come first, so we skip those rather than only reading line 1.
 */
export function isClientModule(source: string): boolean {
  let rest = source;
  // Strip a leading block comment (the house style opens files with one).
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end === -1) return false;
      rest = rest.slice(end + 2);
      continue;
    }
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n');
      if (end === -1) return false;
      rest = rest.slice(end + 1);
      continue;
    }
    break;
  }
  return /^['"]use client['"]/.test(rest);
}

/**
 * True for a name React may render across the boundary — PascalCase with no
 * underscores.
 *
 * The underscore test is what catches `RIDER_VIEW_COOKIE`: it starts with a
 * capital but is a constant, and reading it on the server yields a throwing
 * stub rather than the string. A plain uppercase-first check would have called
 * it a component and missed the bug entirely.
 */
export function isComponentName(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name) && name !== name.toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Source walking
 * ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_SEGMENTS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

/** Every .ts/.tsx file under app/, components/ and lib/. */
export function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) walk(join(root, dir), files);
  return files.sort();
}

/**
 * Resolve an import specifier to a file on disk, or null for a package.
 *
 * Only `@/…` aliases and relative paths can reach project source; a bare
 * specifier is a dependency and cannot be a 'use client' module of ours.
 */
function resolveSpecifier(specifier: string, fromFile: string, root: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(root, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }
  const candidates = [
    ...SOURCE_EXTENSIONS.map((e) => base + e),
    ...SOURCE_EXTENSIONS.map((e) => join(base, 'index' + e)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Import parsing
 * ------------------------------------------------------------------ */

type ParsedImport = {
  specifier: string;
  /** Value bindings introduced locally. Type-only imports are dropped. */
  names: string[];
  line: number;
};

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

/**
 * Value bindings a file imports, per import statement.
 *
 * Type-only imports are excluded: they are erased at compile time and so can
 * never be called or read at runtime, which makes them safe to bring across
 * the boundary. Missing that distinction would flag every `import type` of a
 * client component's prop shape.
 */
export function parseImports(source: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? '';
    if (!specifier || /^\s*type\s/.test(clause)) continue; // `import type { X } from …`

    const line = source.slice(0, match.index).split('\n').length;
    const names: string[] = [];

    const braced = clause.match(/\{([\s\S]*)\}/);
    if (braced) {
      for (const raw of (braced[1] ?? '').split(',')) {
        const piece = raw.trim();
        if (!piece || /^type\s/.test(piece)) continue; // inline `type Foo`
        // `foo as bar` binds `bar` locally but references `foo` in the module.
        const imported = piece.split(/\s+as\s+/)[0] ?? piece;
        names.push(imported.trim());
      }
    }

    // Default and namespace imports: `import X from`, `import X, { … } from`.
    const leading = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (leading && !leading.startsWith('*')) names.push(leading);

    if (names.length > 0) results.push({ specifier, names, line });
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Rule 2 — function literals passed to client components
 * ------------------------------------------------------------------ */

/**
 * Extract the text of every JSX opening tag for `component` in `source`.
 *
 * Scanning forward and balancing braces (rather than regexing to the first
 * `>`) is what makes this reliable: prop values routinely contain `>` inside
 * arrow functions and comparisons, and a naive match would truncate the tag
 * exactly where the interesting props live.
 */
function openingTags(source: string, component: string): { text: string; index: number }[] {
  const tags: { text: string; index: number }[] = [];
  const re = new RegExp(`<${component}(?=[\\s/>])`, 'g');
  for (const match of source.matchAll(re)) {
    let depth = 0;
    let quote: string | null = null;
    let i = match.index + match[0].length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push({ text: source.slice(match.index, i), index: match.index });
  }
  return tags;
}

/** `prop={(a) => …}`, `prop={async (a) => …}`, `prop={function …}`. */
const FUNCTION_PROP_RE =
  /([a-zA-Z_][a-zA-Z0-9_]*)=\{\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[a-zA-Z_$][a-zA-Z0-9_$]*\s*=>)/g;

/**
 * Function-literal props passed to a client component inside `source`.
 * `clientComponents` are the locally-bound names known to come from a
 * 'use client' module.
 */
export function findFunctionProps(
  source: string,
  clientComponents: Iterable<string>,
): { prop: string; component: string; line: number }[] {
  const found: { prop: string; component: string; line: number }[] = [];
  for (const component of clientComponents) {
    for (const tag of openingTags(source, component)) {
      for (const match of tag.text.matchAll(FUNCTION_PROP_RE)) {
        const prop = match[1];
        if (!prop) continue;
        found.push({
          prop,
          component,
          line: source.slice(0, tag.index + match.index).split('\n').length,
        });
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * The scan
 * ------------------------------------------------------------------ */

/**
 * Scan the repository and return every boundary violation found.
 *
 * An empty array is the passing state; the test asserts exactly that.
 */
export function findBoundaryViolations(rootInput: string): BoundaryViolation[] {
  // Callers pass a URL-derived path, which carries a trailing slash; without
  // normalising, every reported path loses its first character.
  const root = rootInput.replace(/[/\\]+$/, '');
  const files = collectSourceFiles(root);

  const sources = new Map<string, string>();
  const clientModules = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    sources.set(file, source);
    if (isClientModule(source)) clientModules.add(file);
  }

  const violations: BoundaryViolation[] = [];
  const rel = (file: string) => file.slice(root.length + 1);

  for (const file of files) {
    if (clientModules.has(file)) continue; // client → client is always fine
    const source = sources.get(file)!;
    const clientComponents = new Set<string>();

    for (const imported of parseImports(source)) {
      const target = resolveSpecifier(imported.specifier, file, root);
      if (!target || !clientModules.has(target)) continue;

      for (const name of imported.names) {
        if (isComponentName(name)) {
          clientComponents.add(name);
          continue;
        }
        violations.push({
          file: rel(file),
          line: imported.line,
          rule: 'non-component-import',
          message:
            `imports "${name}" from '${imported.specifier}', which is a 'use client' module. ` +
            `On the server that export is a client reference, not the real value — calling or ` +
            `reading it throws and takes the page down. Move "${name}" into a plain module ` +
            `(e.g. under lib/) that both sides import.`,
        });
      }
    }

    if (clientComponents.size === 0) continue;
    for (const hit of findFunctionProps(source, clientComponents)) {
      violations.push({
        file: rel(file),
        line: hit.line,
        rule: 'function-prop',
        message:
          `passes a function as prop "${hit.prop}" to <${hit.component}>, a Client Component. ` +
          `Functions are not serializable across the boundary ("Functions cannot be passed ` +
          `directly to Client Components"), so the page throws on every request. Pass a ` +
          `serializable value instead (a string, an id) and build the function on the client, ` +
          `or mark it 'use server' if it is meant to be an action.`,
      });
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Human-readable report used by the test's failure message. */
export function formatViolations(violations: BoundaryViolation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  [${v.rule}] ${v.message}`).join('\n\n');
}
