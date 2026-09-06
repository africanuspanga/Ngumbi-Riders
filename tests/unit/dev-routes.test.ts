/*
 * Rules behind the smoke test's route discovery.
 *
 * The smoke suite itself is opt-in and needs a server, so these — the parts
 * that decide WHAT gets requested — are unit tested here and always run. A
 * silent bug in discovery would make the smoke run report success while
 * checking nothing, which is the failure mode worth guarding.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  discoverPageRoutes,
  fillRoute,
  idSourceSegment,
  routeParams,
  routeRole,
  toRoutePattern,
} from '@/lib/dev/routes';

const APP_DIR = join(fileURLToPath(new URL('../../', import.meta.url)), 'app');

describe('toRoutePattern', () => {
  it('strips route groups, which organise files without appearing in the URL', () => {
    expect(toRoutePattern('(public)/apply')).toBe('/apply');
    expect(toRoutePattern('(auth)/login/owner')).toBe('/login/owner');
  });

  it('excludes private folders, which Next never routes', () => {
    // The lesson from the first probe of this investigation, which 404'd.
    expect(toRoutePattern('api/_internal')).toBeNull();
  });

  it('keeps ordinary and dynamic segments', () => {
    expect(toRoutePattern('owner/riders/[id]/edit')).toBe('/owner/riders/[id]/edit');
  });

  it('maps the app root to /', () => {
    expect(toRoutePattern('')).toBe('/');
  });
});

describe('routeRole', () => {
  it('assigns each area to its role', () => {
    expect(routeRole('/owner')).toBe('owner');
    expect(routeRole('/owner/riders/[id]')).toBe('owner');
    expect(routeRole('/accountant/payments')).toBe('accountant');
    expect(routeRole('/rider/statement')).toBe('rider');
  });

  it('treats everything else as public', () => {
    expect(routeRole('/apply')).toBe('public');
    expect(routeRole('/login')).toBe('public');
  });

  it('does not let a prefix match steal an unrelated route', () => {
    expect(routeRole('/ownership')).toBe('public');
  });
});

describe('routeParams', () => {
  it('lists dynamic segments in order', () => {
    expect(routeParams('/owner/riders/[id]/edit')).toEqual(['id']);
    expect(routeParams('/a/[x]/b/[y]')).toEqual(['x', 'y']);
    expect(routeParams('/owner/riders')).toEqual([]);
  });
});

describe('idSourceSegment', () => {
  it('reads the static segment before the parameter', () => {
    expect(idSourceSegment('/owner/riders/[id]')).toBe('riders');
    expect(idSourceSegment('/owner/contracts/[id]/edit')).toBe('contracts');
  });

  it('handles a route whose entity is not its top-level area', () => {
    // /owner/payments/rider/[id] is a RIDER id despite living under payments.
    expect(idSourceSegment('/owner/payments/rider/[id]')).toBe('rider');
    expect(idSourceSegment('/owner/payments/approvals/[id]')).toBe('approvals');
  });

  it('returns null for a static route', () => {
    expect(idSourceSegment('/owner/riders')).toBeNull();
  });
});

describe('fillRoute', () => {
  const ids = { riders: 'rider-uuid', contracts: 'contract-uuid' };

  it('leaves a static route alone', () => {
    expect(fillRoute('/owner/riders', ids)).toBe('/owner/riders');
  });

  it('substitutes the id for the right entity', () => {
    expect(fillRoute('/owner/riders/[id]', ids)).toBe('/owner/riders/rider-uuid');
    expect(fillRoute('/owner/payments/rider/[id]', ids)).toBe('/owner/payments/rider/rider-uuid');
    expect(fillRoute('/owner/contracts/[id]/edit', ids)).toBe('/owner/contracts/contract-uuid/edit');
  });

  it('skips rather than inventing an id when the table is empty', () => {
    // Requesting a made-up uuid would only ever prove that 404 works.
    expect(fillRoute('/owner/requisitions/[id]', ids)).toBeNull();
  });
});

describe('discoverPageRoutes over this repository', () => {
  const routes = discoverPageRoutes(APP_DIR);

  it('finds the real pages', () => {
    const patterns = routes.map((r) => r.pattern);
    expect(patterns).toContain('/owner');
    expect(patterns).toContain('/owner/payments/approvals');
    expect(patterns).toContain('/accountant/requisitions/new');
    expect(patterns).toContain('/rider/statement');
    expect(patterns.length).toBeGreaterThan(50);
  });

  it('reports no route group or private folder in a URL', () => {
    for (const r of routes) {
      expect(r.pattern).not.toMatch(/\(|\)/);
      expect(r.pattern.split('/').some((s) => s.startsWith('_'))).toBe(false);
    }
  });

  it('covers all three signed-in areas', () => {
    const roles = new Set(routes.map((r) => r.role));
    expect(roles.has('owner')).toBe(true);
    expect(roles.has('accountant')).toBe(true);
    expect(roles.has('rider')).toBe(true);
  });

  it('knows an id source for every dynamic route it found', () => {
    // A new [id] route with no mapping would be silently skipped by the smoke
    // run, so an unmapped one must surface here instead.
    const unmapped = routes
      .filter((r) => r.params.length > 0)
      .filter((r) => fillRoute(r.pattern, { riders: 'x', contracts: 'x', motorcycles: 'x', rider_applications: 'x', cash_payment_requests: 'x', purchase_requisitions: 'x', payments: 'x' }) === null)
      .map((r) => r.pattern);
    expect(unmapped).toEqual([]);
  });
});
