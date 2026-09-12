import type { CoquiClient } from '@coqui/contracts';
import { lazy, Suspense } from 'react';

import { Alerts } from './Alerts.js';
import { Activity } from './Activity.js';
import { Allocation } from './Allocation.js';
import { Events } from './Events.js';
import { OperationsFloor } from './OperationsFloor.js';
import { PaperTrading } from './PaperTrading.js';
import { Portfolio } from './Portfolio.js';
import { Reconciliation } from './Reconciliation.js';
import { routeDefinition, routeHash, type AppRoute } from './routes.js';
import { Scoreboard } from './Scoreboard.js';
import { Settings } from './Settings.js';
import { Tax } from './Tax.js';
import { useWorkspace } from './WorkspaceContext.js';

const Markets = lazy(async () => ({ default: (await import('./Markets.js')).Markets }));
const Overview = lazy(async () => ({ default: (await import('./Overview.js')).Overview }));
const Research = lazy(async () => ({ default: (await import('./Research.js')).Research }));
const Risk = lazy(async () => ({ default: (await import('./Risk.js')).Risk }));

const LOCAL_TABS: Readonly<Partial<Record<AppRoute, readonly AppRoute[]>>> = {
  'portfolio/holdings': ['portfolio/holdings', 'portfolio/allocation', 'portfolio/tax', 'portfolio/reconciliation'],
  'portfolio/allocation': ['portfolio/holdings', 'portfolio/allocation', 'portfolio/tax', 'portfolio/reconciliation'],
  'portfolio/tax': ['portfolio/holdings', 'portfolio/allocation', 'portfolio/tax', 'portfolio/reconciliation'],
  'portfolio/reconciliation': ['portfolio/holdings', 'portfolio/allocation', 'portfolio/tax', 'portfolio/reconciliation'],
  'paper/overview': ['paper/overview', 'paper/orders', 'paper/performance'],
  'paper/orders': ['paper/overview', 'paper/orders', 'paper/performance'],
  'paper/performance': ['paper/overview', 'paper/orders', 'paper/performance'],
  'markets': ['markets', 'events'],
  'events': ['markets', 'events'],
  'strategies': ['strategies', 'research'],
  'research': ['strategies', 'research'],
  'activity': ['activity', 'risk'],
  'risk': ['activity', 'risk'],
};

function RouteTabs({ route }: { readonly route: AppRoute }): React.JSX.Element | null {
  const tabs = LOCAL_TABS[route];
  if (tabs === undefined) return null;
  return (
    <nav className="route-local-tabs" aria-label={`${routeDefinition(route).group} views`}>
      {tabs.map((tab) => <a key={tab} href={routeHash(tab)} aria-current={tab === route ? 'page' : undefined}>{routeDefinition(tab).label}</a>)}
    </nav>
  );
}

function ScreenBody({
  client, route,
}: {
  readonly client: CoquiClient;
  readonly route: AppRoute;
}): React.JSX.Element {
  switch (route) {
    case 'overview': return <Overview client={client} />;
    case 'portfolio/holdings': return <Portfolio client={client} />;
    case 'portfolio/allocation': return <Allocation client={client} />;
    case 'portfolio/tax': return <Tax client={client} />;
    case 'portfolio/reconciliation': return <Reconciliation client={client} />;
    case 'markets': return <Markets client={client} />;
    case 'events': return <Events client={client} />;
    case 'paper/overview':
    case 'paper/orders':
    case 'paper/performance': return <PaperTrading client={client} route={route} />;
    case 'strategies': return <Scoreboard client={client} />;
    case 'research': return <Research client={client} />;
    case 'activity': return <div className="screen-stack"><OperationsFloor client={client} /><Activity client={client} /><Alerts client={client} /></div>;
    case 'risk': return <Risk client={client} />;
    case 'settings': return <Settings client={client} />;
  }
}

export function RouteScreen({
  client, route,
}: {
  readonly client: CoquiClient;
  readonly route: AppRoute;
}): React.JSX.Element {
  const definition = routeDefinition(route);
  const { mode } = useWorkspace();
  const integrated = mode === 'advanced' && route === 'overview';
  return (
    <section className="route-screen" data-route={route}>
      <header className={`screen-heading${integrated ? ' screen-heading-integrated' : ''}`}>
        <div className={integrated ? 'sr-only' : undefined}><p className="eyebrow">Coqui workstation</p><h1 data-route-heading tabIndex={-1}>{definition.title}</h1></div>
        {!integrated && <span className="screen-mode">PAPER ONLY</span>}
      </header>
      {mode === 'advanced' && <RouteTabs route={route} />}
      <Suspense fallback={<div className="panel"><span className="muted">Loading workspace…</span></div>}>
        <ScreenBody client={client} route={route} />
      </Suspense>
    </section>
  );
}
