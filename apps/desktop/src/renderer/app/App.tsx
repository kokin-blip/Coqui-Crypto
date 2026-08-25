import type { CoquiClient } from '@coqui/contracts';

import { useEffect } from 'react';

import { RouteScreen } from './RouteScreen.js';
import { PreferenceBoundary } from './PreferenceBoundary.js';
import { Sidebar } from './Sidebar.js';
import { StatusRail } from './StatusRail.js';
import { useRoute } from './use-route.js';

export function App({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const [route] = useRoute();

  useEffect(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-route-heading]')?.focus({ preventScroll: true });
    });
  }, [route]);

  return (
    <div className="app-shell">
      <PreferenceBoundary client={client} />
      <Sidebar route={route} />
      <div className="app-workspace">
        <StatusRail client={client} />
        <main id="main-content" className="route-content" key={route}>
          <RouteScreen client={client} route={route} />
        </main>
      </div>
    </div>
  );
}
