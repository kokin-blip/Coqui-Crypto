import { Command, Settings2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import { routeHash } from './routes.js';
import { WorkspaceModeControl } from './WorkspaceModeControl.js';
import { useWorkspace } from './WorkspaceContext.js';
import { presetPatch } from './overview-presets.js';

const IonicCommandPopover = lazy(() => import('./IonicCommandPopover.js'));

export function CommandMenu(): React.JSX.Element {
  const [event, setEvent] = useState<MouseEvent | undefined>();
  const workspace = useWorkspace();
  return (
    <>
      <button className="command-menu-trigger" type="button" aria-label="Open command menu" onClick={(click) => setEvent(click.nativeEvent)}>
        <Command size={14} aria-hidden="true" /> Commands
      </button>
      {event !== undefined && <Suspense fallback={null}><IonicCommandPopover anchor={event} onClose={() => setEvent(undefined)}>
        <div className="command-menu-content">
          <p><strong>Workspace mode</strong><span>Layout changes only. Data and route stay in place.</span></p>
          <WorkspaceModeControl />
          {workspace.mode === 'advanced' && <div className="command-menu-presets"><span>Overview layout</span><button type="button" onClick={() => void workspace.update(presetPatch('research_grid'))}>Research Grid</button><button type="button" onClick={() => void workspace.update(presetPatch('chart_focus'))}>Chart Focus</button><button type="button" onClick={() => void workspace.update(presetPatch('evidence_review'))}>Evidence Review</button></div>}
          {workspace.mode === 'advanced' && <button className="command-menu-action" type="button" onClick={() => void workspace.update({ inspectorOpen: !(workspace.preferences?.inspectorOpen ?? true) })}>{workspace.preferences?.inspectorOpen ?? true ? 'Hide' : 'Show'} evidence inspector</button>}
          <a href={routeHash('settings')} onClick={() => setEvent(undefined)}><Settings2 size={15} aria-hidden="true" /> Display settings</a>
        </div>
      </IonicCommandPopover></Suspense>}
    </>
  );
}
