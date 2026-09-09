import { routeHash, routeSection, type AppRoute } from './routes.js';

const destinations: readonly { readonly route: AppRoute; readonly label: string }[] = [
  { route: 'overview', label: 'Overview' },
  { route: 'portfolio/holdings', label: 'Portfolio' },
  { route: 'markets', label: 'Markets' },
  { route: 'events', label: 'Events' },
  { route: 'paper/overview', label: 'Paper' },
  { route: 'strategies', label: 'Strategies' },
  { route: 'research', label: 'Research' },
  { route: 'activity', label: 'Activity' },
  { route: 'risk', label: 'Risk' },
  { route: 'settings', label: 'Settings' },
];

export function SimpleNavigation({ route }: { readonly route: AppRoute }): React.JSX.Element {
  const section = routeSection(route);
  return (
    <header className="simple-navigation">
      <a className="simple-brand" href={routeHash('overview')} aria-label="Coqui overview">
        <img src={new URL('../coqui-mark.png', import.meta.url).href} alt="" />
        <strong>Coqui</strong>
      </a>
      <nav aria-label="Primary">
        {destinations.map((destination) => (
          <a
            key={destination.route}
            href={routeHash(destination.route)}
            aria-current={destination.route === section ? 'page' : undefined}
          >
            {destination.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
