import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTE,
  ROUTES,
  isAppRoute,
  parseRouteHash,
  routeDefinition,
  routeHash,
  routeSection,
} from '../apps/desktop/src/renderer/app/routes.js';

describe('renderer route registry', () => {
  it('round-trips every closed route through a stable hash', () => {
    for (const definition of ROUTES) {
      expect(isAppRoute(definition.route)).toBe(true);
      expect(parseRouteHash(routeHash(definition.route))).toBe(definition.route);
      expect(routeDefinition(definition.route)).toEqual(definition);
    }
  });

  it('rejects unknown, malformed and empty deep links', () => {
    for (const hash of ['', '#', '#/', '#/live', '#/paper/performance/extra']) {
      expect(parseRouteHash(hash)).toBe(DEFAULT_ROUTE);
    }
  });

  it('accepts a trailing slash without broadening the route set', () => {
    expect(parseRouteHash('#/paper/performance/')).toBe('paper/performance');
    expect(isAppRoute('paper/performance/')).toBe(false);
  });

  it('keeps portfolio and paper subroutes in their persistent sections', () => {
    expect(routeSection('portfolio/tax')).toBe('portfolio/holdings');
    expect(routeSection('paper/orders')).toBe('paper/overview');
    expect(routeSection('research')).toBe('research');
  });
});
