export type AppRoute =
  | 'overview'
  | 'portfolio/holdings'
  | 'portfolio/allocation'
  | 'portfolio/tax'
  | 'portfolio/reconciliation'
  | 'markets'
  | 'events'
  | 'paper/overview'
  | 'paper/orders'
  | 'paper/performance'
  | 'strategies'
  | 'research'
  | 'activity'
  | 'risk'
  | 'settings';

export interface RouteDefinition {
  readonly route: AppRoute;
  readonly label: string;
  readonly title: string;
  readonly group: 'workspace' | 'portfolio' | 'paper' | 'system';
}

export const DEFAULT_ROUTE: AppRoute = 'overview';

export const ROUTES: readonly RouteDefinition[] = [
  { route: 'overview', label: 'Overview', title: 'Overview', group: 'workspace' },
  { route: 'portfolio/holdings', label: 'Holdings', title: 'Portfolio holdings', group: 'portfolio' },
  { route: 'portfolio/allocation', label: 'Allocation', title: 'Portfolio allocation', group: 'portfolio' },
  { route: 'portfolio/tax', label: 'Tax', title: 'Tax evidence', group: 'portfolio' },
  { route: 'portfolio/reconciliation', label: 'Reconciliation', title: 'Portfolio reconciliation', group: 'portfolio' },
  { route: 'markets', label: 'Markets', title: 'Markets', group: 'workspace' },
  { route: 'events', label: 'Events', title: 'Market events', group: 'workspace' },
  { route: 'paper/overview', label: 'Overview', title: 'Paper Trading', group: 'paper' },
  { route: 'paper/orders', label: 'Orders', title: 'Paper orders', group: 'paper' },
  { route: 'paper/performance', label: 'Performance', title: 'Paper performance', group: 'paper' },
  { route: 'strategies', label: 'Strategies', title: 'Strategies', group: 'workspace' },
  { route: 'research', label: 'Research', title: 'Research', group: 'workspace' },
  { route: 'activity', label: 'Activity', title: 'Activity', group: 'workspace' },
  { route: 'risk', label: 'Risk', title: 'Risk', group: 'workspace' },
  { route: 'settings', label: 'Settings', title: 'Settings', group: 'system' },
] as const;

const routeSet = new Set<AppRoute>(ROUTES.map(({ route }) => route));

export function isAppRoute(value: string): value is AppRoute {
  return routeSet.has(value as AppRoute);
}

export function parseRouteHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#\/?/, '').replace(/\/$/, '');
  return isAppRoute(candidate) ? candidate : DEFAULT_ROUTE;
}

export function routeHash(route: AppRoute): string {
  return `#/${route}`;
}

export function routeDefinition(route: AppRoute): RouteDefinition {
  const definition = ROUTES.find((candidate) => candidate.route === route);
  if (definition === undefined) throw new Error(`Missing route definition: ${route}`);
  return definition;
}

export function routeSection(route: AppRoute): AppRoute {
  if (route.startsWith('portfolio/')) return 'portfolio/holdings';
  if (route.startsWith('paper/')) return 'paper/overview';
  return route;
}
