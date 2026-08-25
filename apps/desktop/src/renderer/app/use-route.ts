import { useEffect, useState } from 'react';

import { DEFAULT_ROUTE, parseRouteHash, routeHash, type AppRoute } from './routes.js';

function currentRoute(): AppRoute {
  if (typeof window === 'undefined') return DEFAULT_ROUTE;
  return parseRouteHash(window.location.hash);
}

export function useRoute(): readonly [AppRoute, (route: AppRoute) => void] {
  const [route, setRoute] = useState<AppRoute>(currentRoute);

  useEffect(() => {
    const handleHashChange = (): void => setRoute(currentRoute());
    window.addEventListener('hashchange', handleHashChange);

    if (window.location.hash !== routeHash(route)) {
      window.history.replaceState(null, '', routeHash(route));
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [route]);

  const navigate = (nextRoute: AppRoute): void => {
    if (nextRoute === currentRoute()) return;
    window.location.hash = routeHash(nextRoute);
  };

  return [route, navigate] as const;
}
