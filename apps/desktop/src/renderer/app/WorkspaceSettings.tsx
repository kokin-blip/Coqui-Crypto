import { DailyResearchShadowSettings } from './DailyResearchShadowSettings.js';
import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useCommand } from '../query/use-command.js';
import { useChannel } from '../query/use-channel.js';
import { useState } from 'react';

type Workspace = ChannelResponse<'accounts.workspace'>['preferences'];
const INVALIDATIONS = ['accounts.workspace', 'accounts.settings'] as const;

export function WorkspaceSettings({
  client,
  preferences,
}: {
  readonly client: CoquiClient;
  readonly preferences: Workspace;
}): React.JSX.Element {
  const command = useCommand(client, 'accounts.workspace.set', INVALIDATIONS);
  const person = useChannel(client, 'app.person', {});
  const setPerson = useCommand(client, 'app.person.set', ['app.person', 'app.onboarding.status']);
  const restart = useCommand(client, 'app.onboarding.restart', ['app.onboarding.status']);
  const [name, setName] = useState('');
  const action = presentAction(command.state, { idle: '', pending: 'Saving workspace preference…' });
  const save = (patch: Parameters<typeof command.run>[0]['patch']): void => {
    void command.run({ commandId: crypto.randomUUID(), patch });
  };

  return (
    <div className="workspace-settings">
      <div className="setting-line"><span><strong>Unified terminal</strong><small>One interface for markets, assets, paper execution and evidence.</small></span></div>
      <div className="settings-control-grid">
        <label>Portfolio view
          <select value={preferences.portfolioChart} disabled={action.disabled} onChange={(event) => save({ portfolioChart: event.target.value as Workspace['portfolioChart'] })}>
            <option value="holdings">Holdings</option><option value="allocation">Allocation ring</option>
          </select>
        </label>
        <label>Markets chart
          <select value={preferences.marketsChart} disabled={action.disabled} onChange={(event) => save({ marketsChart: event.target.value as Workspace['marketsChart'] })}>
            <option value="candles">Candles</option><option value="line">Line</option>
          </select>
        </label>
        <label>Performance focus
          <select value={preferences.performanceChart} disabled={action.disabled} onChange={(event) => save({ performanceChart: event.target.value as Workspace['performanceChart'] })}>
            <option value="equity">Equity</option><option value="drawdown">Drawdown</option>
            <option value="calendar">Calendar</option><option value="distribution">Distribution</option>
          </select>
        </label>
      </div>
      <div className="settings-toggle-grid"><label><input type="checkbox" checked={preferences.marketVolumeVisible} disabled={action.disabled} onChange={() => save({ marketVolumeVisible: !preferences.marketVolumeVisible })} /> Show market volume</label></div>
      <section className="workspace-setup-controls" aria-labelledby="personal-setup-heading">
        <div><strong id="personal-setup-heading">Personal setup</strong><small>Your local display name is separate from portfolio profiles and is never sent to an AI provider.</small></div>
        <label>What Coqui calls you<input value={name} maxLength={40} placeholder={person.kind === 'ready' ? person.value.displayName ?? 'Name' : 'Name'} onChange={(event) => setName(event.target.value)} /></label>
        <div className="coinbase-action-row"><button type="button" className="button-secondary" disabled={name.trim().length === 0 || setPerson.state.kind === 'pending'} onClick={() => { void setPerson.run({ commandId: crypto.randomUUID(), displayName: name }); setName(''); }}>Save name</button><button type="button" className="button-quiet" disabled={restart.state.kind === 'pending'} onClick={() => void restart.run({ commandId: crypto.randomUUID() })}>Restart guided setup</button></div>
      </section>
      <DailyResearchShadowSettings client={client} />
      <span className="sr-only" aria-live="polite">{action.liveMessage}</span>
    </div>
  );
}
