import type { CoquiClient } from '@coqui/contracts';

import { useEffect } from 'react';

import { RouteScreen } from './RouteScreen.js';
import { PreferenceBoundary } from './PreferenceBoundary.js';
import { EvidenceInspector } from './EvidenceInspector.js';
import { Sidebar } from './Sidebar.js';
import { SimpleNavigation } from './SimpleNavigation.js';
import { StatusRail } from './StatusRail.js';
import { useRoute } from './use-route.js';
import { useWorkspace, WorkspaceProvider } from './WorkspaceContext.js';

function WorkspaceApp({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const [route] = useRoute();
  const { mode, preferences } = useWorkspace();

  useEffect(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-route-heading]')?.focus({ preventScroll: true });
    });
  }, [route]);

  return (
    <div className={`app-shell workspace-${mode}`}>
      <PreferenceBoundary client={client} />
      {mode === 'advanced' ? <Sidebar route={route} /> : <SimpleNavigation route={route} />}
      <div className="app-workspace">
        <StatusRail client={client} />
        <div className="workspace-content-grid">
          <main id="main-content" className="route-content" key={route}>
            <RouteScreen client={client} route={route} />
          </main>
          {mode === 'advanced' && (preferences?.inspectorOpen ?? true) && <EvidenceInspector client={client} />}
        </div>
      </div>
    </div>
  );
}

export function App({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  return <WorkspaceProvider client={client}><WorkspaceApp client={client} /></WorkspaceProvider>;
}
