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
  readonly children?: readonly { readonly route: AppRoute; readonly label: string }[];
}

const destinations: readonly PrimaryDestination[] = [
  { route: 'overview', label: 'Overview', icon: LayoutDashboard },
  {
    route: 'portfolio/holdings', label: 'Portfolio', icon: WalletCards,
    children: [
      { route: 'portfolio/holdings', label: 'Holdings' },
      { route: 'portfolio/allocation', label: 'Allocation' },
      { route: 'portfolio/tax', label: 'Tax' },
      { route: 'portfolio/reconciliation', label: 'Reconciliation' },
    ],
  },
  { route: 'markets', label: 'Markets', icon: CandlestickChart },
  {
    route: 'paper/overview', label: 'Paper Trading', icon: BarChart3,
    children: [
      { route: 'paper/overview', label: 'Overview' },
      { route: 'paper/orders', label: 'Orders' },
      { route: 'paper/performance', label: 'Performance' },
    ],
  },
  { route: 'strategies', label: 'Strategies', icon: BookOpenCheck },
  { route: 'research', label: 'Research', icon: FlaskConical },
  { route: 'activity', label: 'Activity', icon: Activity },
  { route: 'risk', label: 'Risk', icon: ShieldCheck },
  { route: 'settings', label: 'Settings', icon: Settings },
] as const;

function NavLink({
  route, label, currentRoute, child = false, icon: Icon,
}: {
  readonly route: AppRoute;
  readonly label: string;
  readonly currentRoute: AppRoute;
  readonly child?: boolean;
  readonly icon?: LucideIcon;
}): React.JSX.Element {
  const active = route === currentRoute;
  return (
    <a
      className={child ? 'sidebar-sub-link' : 'sidebar-link'}
      href={routeHash(route)}
      aria-current={active ? 'page' : undefined}
      title={child ? undefined : label}
    >
      {Icon !== undefined && <Icon aria-hidden="true" size={18} strokeWidth={1.8} />}
      <span className={child ? undefined : 'sidebar-label'}>{label}</span>
    </a>
  );
}

export function Sidebar({ route }: { readonly route: AppRoute }): React.JSX.Element {
  const currentSection = routeSection(route);

  return (
    <aside className="sidebar">
      <div className="brand-lockup" aria-label="Coqui Crypto">
        <img className="brand-mark" src={new URL('../coqui-mark.png', import.meta.url).href} alt="" />
        <span><strong>Coqui</strong><small>research workstation</small></span>
      </div>

      <nav aria-label="Primary">
        <ul className="sidebar-list">
          {destinations.map(({ route: destination, label, icon: Icon, children }) => {
            const sectionActive = destination === currentSection;
            return (
              <li key={destination}>
                <NavLink
                  route={destination}
                  label={label}
                  currentRoute={sectionActive ? destination : route}
                  icon={Icon}
                />
                {children !== undefined && sectionActive && (
                  <ul className="sidebar-sub-list">
                    {children.map((item) => (
                      <li key={item.route}>
                        <NavLink {...item} currentRoute={route} child />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="sidebar-safety">
        <ShieldCheck aria-hidden="true" size={16} /> Live execution unavailable
      </p>
    </aside>
  );
}
