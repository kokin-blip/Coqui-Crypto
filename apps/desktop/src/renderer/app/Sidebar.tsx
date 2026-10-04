import { routeHash, routeSection, type AppRoute } from './routes.js';

const destinations = [
  ['overview', 'Terminal'], ['portfolio/holdings', 'Portfolio'], ['markets', 'Markets'],
  ['strategies', 'Strategy'], ['paper/overview', 'Paper'], ['research', 'Research'], ['risk', 'Risk'],
  ['activity', 'Operations'], ['settings', 'Settings'],
] as const;

export function Sidebar({ route }: { readonly route: AppRoute }): React.JSX.Element {
  const active = route === 'research' || route === 'risk' ? route : routeSection(route);
  return <nav className="terminal-navigation" aria-label="Primary navigation">
    <a className="terminal-brand" href={routeHash('overview')} aria-label="Coqui Crypto terminal">
      <img src={new URL('../coqui-mark.png', import.meta.url).href} alt="" /><span>COQUI<span className="terminal-secondary"> CRYPTO</span></span>
    </a>
    {destinations.map(([id, label]) => <a key={id} href={routeHash(id)} aria-current={active === id ? 'page' : undefined}>{label}</a>)}
  </nav>;
}
