import {
  Activity,
  BarChart3,
  BookOpenCheck,
  CandlestickChart,
  FlaskConical,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

import { routeHash, routeSection, type AppRoute } from './routes.js';

interface PrimaryDestination {
  readonly route: AppRoute;
  readonly label: string;
  readonly icon: LucideIcon;
}

const destinations: readonly PrimaryDestination[] = [
  { route: 'overview', label: 'Overview', icon: LayoutDashboard },
  { route: 'markets', label: 'Markets', icon: CandlestickChart },
  { route: 'portfolio/holdings', label: 'Portfolio', icon: WalletCards },
  { route: 'paper/overview', label: 'Paper', icon: BarChart3 },
  { route: 'strategies', label: 'Strategies', icon: BookOpenCheck },
  { route: 'research', label: 'Research', icon: FlaskConical },
  { route: 'activity', label: 'Activity', icon: Activity },
  { route: 'risk', label: 'Risk', icon: ShieldCheck },
  { route: 'settings', label: 'Settings', icon: Settings },
] as const;

function NavLink({
  route, label, currentRoute, icon: Icon,
}: {
  readonly route: AppRoute;
  readonly label: string;
  readonly currentRoute: AppRoute;
  readonly icon?: LucideIcon;
}): React.JSX.Element {
  const active = route === currentRoute;
  return (
    <a
      className="sidebar-link"
      href={routeHash(route)}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      {Icon !== undefined && <Icon aria-hidden="true" size={20} strokeWidth={1.75} />}
      <span className="sidebar-label">{label}</span>
    </a>
  );
}

export function Sidebar({ route }: { readonly route: AppRoute }): React.JSX.Element {
  const currentSection = routeSection(route);

  return (
    <aside className="sidebar">
      <div className="brand-lockup" aria-label="Coqui Crypto">
        <img className="brand-mark" src={new URL('../coqui-mark.png', import.meta.url).href} alt="" />
        <span><strong>coqui</strong></span>
      </div>

      <nav aria-label="Primary">
        <ul className="sidebar-list">
          {destinations.map(({ route: destination, label, icon: Icon }) => {
            const sectionActive = destination === currentSection;
            return (
              <li key={destination}>
                <NavLink
                  route={destination}
                  label={label}
                  currentRoute={sectionActive ? destination : route}
                  icon={Icon}
                />
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="sidebar-safety">
        <ShieldCheck aria-hidden="true" size={15} /> Paper research only
      </p>
    </aside>
  );
}
