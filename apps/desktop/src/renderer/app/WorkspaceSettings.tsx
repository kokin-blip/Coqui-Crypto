import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useCommand } from '../query/use-command.js';
import { WorkspaceModeControl } from './WorkspaceModeControl.js';
import { customPanelPatch, presetPatch } from './overview-presets.js';

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
  const action = presentAction(command.state, { idle: '', pending: 'Saving workspace preference…' });
  const save = (patch: Parameters<typeof command.run>[0]['patch']): void => {
    void command.run({ commandId: crypto.randomUUID(), patch });
  };

  return (
    <div className="workspace-settings">
      <div className="setting-line"><span><strong>Workspace mode</strong><small>Switch composition without changing data or route.</small></span><WorkspaceModeControl /></div>
      <div className="settings-control-grid">
        <label>Advanced Overview preset
          <select value={preferences.advancedOverviewPreset} disabled={action.disabled} onChange={(event) => {
            const value = event.target.value as Workspace['advancedOverviewPreset'];
            if (value !== 'custom') save(presetPatch(value));
          }}>
            <option value="research_grid">Research Grid</option><option value="chart_focus">Chart Focus</option>
            <option value="evidence_review">Evidence Review</option><option value="custom" disabled>Custom</option>
          </select>
        </label>
        <label>Overview chart
          <select value={preferences.overviewChart} disabled={action.disabled} onChange={(event) => save({ overviewChart: event.target.value as Workspace['overviewChart'] })}>
            <option value="equity">Equity + benchmark</option><option value="allocation">Allocation ring</option>
          </select>
        </label>
        <label>Overview series
          <select value={preferences.overviewSeriesStyle} disabled={action.disabled} onChange={(event) => save({ overviewSeriesStyle: event.target.value as Workspace['overviewSeriesStyle'] })}>
            <option value="area">Area</option><option value="line">Line</option><option value="baseline">Baseline</option>
          </select>
        </label>
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
      <fieldset className="settings-toggle-grid"><legend>Advanced Overview panels</legend>{Object.entries({ strategyDetail: 'Strategy detail', strategyComparison: 'Strategy comparison', recentActivity: 'Recent activity', proposalPreview: 'Proposal preview', healthStrip: 'Health strip', negativeFindings: 'Negative findings' } as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={preferences.advancedOverviewPanels[key as keyof Workspace['advancedOverviewPanels']]} disabled={action.disabled} onChange={() => save(customPanelPatch(preferences.advancedOverviewPanels, key as keyof Workspace['advancedOverviewPanels']))} /> {label}</label>)}</fieldset>
      <div className="settings-toggle-grid"><label><input type="checkbox" checked={preferences.overviewBenchmarkVisible} disabled={action.disabled} onChange={() => save({ overviewBenchmarkVisible: !preferences.overviewBenchmarkVisible })} /> Show Overview benchmark</label><label><input type="checkbox" checked={preferences.marketVolumeVisible} disabled={action.disabled} onChange={() => save({ marketVolumeVisible: !preferences.marketVolumeVisible })} /> Show market volume</label></div>
      <button type="button" className="button-secondary" disabled={action.disabled} onClick={() => save(presetPatch('research_grid'))}>Restore Research Grid</button>
      <span className="sr-only" aria-live="polite">{action.liveMessage}</span>
    </div>
  );
}
