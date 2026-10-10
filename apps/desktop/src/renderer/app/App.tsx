import { installInputTracing } from '../query/performance-trace.js';
import { useChannel } from '../query/use-channel.js';
import type { CoquiClient } from '@coqui/contracts';

import { useEffect } from 'react';

import { RouteScreen } from './RouteScreen.js';
import { PreferenceBoundary } from './PreferenceBoundary.js';
import { EvidenceInspector } from './EvidenceInspector.js';
import { Sidebar } from './Sidebar.js';
import { StatusRail } from './StatusRail.js';
import { Onboarding } from './Onboarding.js';
import { useRoute } from './use-route.js';
import { useWorkspace, WorkspaceProvider } from './WorkspaceContext.js';

function WorkspaceApp({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const profiles = useChannel(client,'accounts.profiles',{});
  useEffect(()=>installInputTracing(),[]);
  const [route] = useRoute();
  const workspace = useWorkspace();
  const { inspectorVisible, shellState } = workspace;

  useEffect(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-route-heading]')?.focus({ preventScroll: true });
    });
  }, [route]);

  useEffect(() => {
    if (shellState !== 'wide') workspace.closeInspector();
  }, [route]);

  return (
    <div className={`app-shell terminal-shell shell-${shellState}`}>
      <PreferenceBoundary client={client} />
      <Onboarding key={profiles.kind==='ready'?profiles.value.activeProfile.id:'profile-unavailable'} client={client} />
      <div className="terminal-shell-header"><Sidebar route={route} /><StatusRail client={client} /></div>
      <div className="app-workspace">
        <div className={`workspace-content-grid ${shellState === 'wide' && inspectorVisible ? 'inspector-docked' : ''}`}>
          <main id="main-content" tabIndex={-1} className="route-content" key={route}>
            <RouteScreen client={client} route={route} />
          </main>
          {route !== 'overview' && inspectorVisible && (
            <EvidenceInspector client={client} presentation={shellState === 'wide' ? 'docked' : 'drawer'} />
          )}
        </div>
      </div>
    </div>
  );
}

export function App({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  return <WorkspaceProvider client={client}><WorkspaceApp client={client} /></WorkspaceProvider>;
}
