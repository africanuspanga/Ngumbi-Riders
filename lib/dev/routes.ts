/*
 * Route discovery for the smoke test.
 *
 * The route list is READ FROM THE FILESYSTEM rather than written down, because
 * a hand-maintained list is the thing that rots: a page added next month would
 * simply never be smoke-tested, and the suite would keep reporting success
 * while the new page 500s. Every app/**\/page.tsx is a route, so every page is
 * covered the day it is created.
 *
 * Pure and dependency-free apart from node:fs, so the parsing rules are unit
 * tested without a server, a session or a database.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type RouteRole = 'owner' | 'accountant' | 'rider' | 'public';

export type DiscoveredRoute = {
  /** URL pattern with dynamic segments intact, e.g. /owner/riders/[id]. */
  pattern: string;
  /** Which signed-in role the route belongs to. */
  role: RouteRole;
  /** Dynamic segment names in order, e.g. ['id']. */
  params: string[];
};

const IGNORED = new Set(['node_modules', '.next']);

/**
 * Turn an app-directory path into a URL pattern.
 *
 * Route groups `(public)` and `(auth)` organise files without appearing in the
 * URL, so they are stripped; private `_folders` never become routes at all,
 * which is why the first probe route in this investigation 404'd.
 */
export function toRoutePattern(relativeDir: string): string | null {
  const segments = relativeDir.split('/').filter(Boolean);
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith('_')) return null; // private folder — not routable
    if (segment.startsWith('(') && segment.endsWith(')')) continue; // route group
    if (segment.startsWith('@')) return null; // parallel route slot
    kept.push(segment);
  }
  return '/' + kept.join('/');
}

/** Dynamic segment names in a pattern, e.g. /a/[id]/b/[slug] → ['id','slug']. */
export function routeParams(pattern: string): string[] {
  return [...pattern.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((m) => m[1] ?? '');
}

/** Which role's area a route sits in. Everything else is public. */
export function routeRole(pattern: string): RouteRole {
  if (pattern === '/owner' || pattern.startsWith('/owner/')) return 'owner';
  if (pattern === '/accountant' || pattern.startsWith('/accountant/')) return 'accountant';
  if (pattern === '/rider' || pattern.startsWith('/rider/')) return 'rider';
  return 'public';
}

function walkForPages(dir: string, base: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkForPages(full, base ? `${base}/${entry}` : entry, out);
    } else if (entry === 'page.tsx' || entry === 'page.ts') {
      out.push(base);
    }
  }
}

/** Every routable page under `appDir`, sorted, with role and params resolved. */
export function discoverPageRoutes(appDir: string): DiscoveredRoute[] {
  const dirs: string[] = [];
  walkForPages(appDir, '', dirs);

  const routes: DiscoveredRoute[] = [];
  for (const dir of dirs) {
    const pattern = toRoutePattern(dir);
    if (pattern === null) continue;
    routes.push({ pattern, role: routeRole(pattern), params: routeParams(pattern) });
  }
  return routes.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/*
 * Which table supplies the id for a dynamic route.
 *
 * Keyed on the segment immediately BEFORE the parameter, which is how these
 * URLs are actually built: /owner/riders/[id] takes a rider, and
 * /owner/payments/rider/[id] also takes a rider even though it lives under
 * payments. Reading the last static segment gets both right without a
 * per-route table.
 */
export const ID_SOURCE_BY_SEGMENT: Record<string, string> = {
  riders: 'riders',
  rider: 'riders',
  contracts: 'contracts',
  motorcycles: 'motorcycles',
  applications: 'rider_applications',
  approvals: 'cash_payment_requests',
  requisitions: 'purchase_requisitions',
  payments: 'payments',
};

/** The static segment directly before the first dynamic one, if any. */
export function idSourceSegment(pattern: string): string | null {
  const segments = pattern.split('/').filter(Boolean);
  const index = segments.findIndex((s) => s.startsWith('['));
  if (index <= 0) return null;
  return segments[index - 1] ?? null;
}

/**
 * Substitute real ids into a pattern.
 *
 * Returns null when an id is not available — an empty table is a legitimate
 * state (no requisitions raised yet), and skipping is honest where inventing a
 * uuid would only ever produce a meaningless 404.
 */
export function fillRoute(pattern: string, ids: Record<string, string | undefined>): string | null {
  const segment = idSourceSegment(pattern);
  if (segment === null) return pattern;
  const table = ID_SOURCE_BY_SEGMENT[segment];
  if (!table) return null;
  const id = ids[table];
  if (!id) return null;
  return pattern.replace(/\[(?:\.\.\.)?[^\]]+\]/g, id);
}
