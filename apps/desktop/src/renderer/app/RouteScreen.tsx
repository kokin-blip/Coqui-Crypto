import type { CoquiClient } from '@coqui/contracts';

import { Alerts } from './Alerts.js';
import { Activity } from './Activity.js';
import { Allocation } from './Allocation.js';
import { Markets } from './Markets.js';
import { Overview } from './Overview.js';
import { PaperTrading } from './PaperTrading.js';
import { Portfolio } from './Portfolio.js';
import { Reconciliation } from './Reconciliation.js';
import { Research } from './Research.js';
import { Risk } from './Risk.js';
import { routeDefinition, type AppRoute } from './routes.js';
import { Scoreboard } from './Scoreboard.js';
import { Settings } from './Settings.js';
import { Tax } from './Tax.js';

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
    case 'paper/overview':
    case 'paper/orders':
    case 'paper/performance': return <PaperTrading client={client} route={route} />;
    case 'strategies': return <Scoreboard client={client} />;
    case 'research': return <Research client={client} />;
    case 'activity': return <div className="screen-stack"><Activity client={client} /><Alerts client={client} /></div>;
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
  return (
    <section className="route-screen" data-route={route}>
      <header className="screen-heading">
        <div><p className="eyebrow">Coqui workstation</p><h1 data-route-heading tabIndex={-1}>{definition.title}</h1></div>
        <span className="screen-mode">PAPER ONLY</span>
      </header>
      <ScreenBody client={client} route={route} />
    </section>
  );
}
