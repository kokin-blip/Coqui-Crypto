import { Search, Settings2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import { routeHash } from './routes.js';
import { useWorkspace } from './WorkspaceContext.js';

const IonicCommandPopover = lazy(() => import('./IonicCommandPopover.js'));

export function CommandMenu(): React.JSX.Element {
  const [event, setEvent] = useState<MouseEvent | undefined>();
  const workspace = useWorkspace();
  return (
    <>
      <button className="command-menu-trigger" type="button" aria-label="Open command menu" onClick={(click) => setEvent(click.nativeEvent)}>
        <Search size={14} aria-hidden="true" /> <span>Search commands…</span>
      </button>
      {event !== undefined && <Suspense fallback={null}><IonicCommandPopover anchor={event} onClose={() => setEvent(undefined)}>
        <div className="command-menu-content">
          <p><strong>Coqui terminal</strong><span>One workspace for market and algorithm evidence.</span></p>
          <a href={routeHash('overview')} onClick={() => setEvent(undefined)}>Open terminal</a>
          <button className="command-menu-action" type="button" onClick={workspace.toggleInspector}>{workspace.inspectorVisible ? 'Hide' : 'Show'} evidence inspector</button>
          <a href={routeHash('settings')} onClick={() => setEvent(undefined)}><Settings2 size={15} aria-hidden="true" /> Display settings</a>
        </div>
      </IonicCommandPopover></Suspense>}
    </>
  );
}
