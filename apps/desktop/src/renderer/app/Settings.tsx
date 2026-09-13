import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { useRef, useState, type KeyboardEvent } from 'react';

import { ConnectionManager } from './ConnectionManager.js';
import { DisplaySettings } from './DisplaySettings.js';
import { ExecutionPolicySettings } from './ExecutionPolicySettings.js';
import { ExploratoryPaperSettings } from './ExploratoryPaperSettings.js';
import { PaperCampaignSettings } from './PaperCampaignSettings.js';
import { SurfaceState } from './SurfaceState.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { WorkspaceSettings } from './WorkspaceSettings.js';

type SettingsView = ChannelResponse<'accounts.settings'>;
type SettingsCategory = 'connections' | 'appearance' | 'workspace' | 'paper' | 'advisor' | 'diagnostics';

const CATEGORIES: readonly { readonly id: SettingsCategory; readonly label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'appearance', label: 'Appearance and accessibility' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'paper', label: 'Paper and safety' },
  { id: 'advisor', label: 'Advisor and retention' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

function AdvisorSettingsSummary({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const providers = useChannel(client, 'advisor.providers', {});
  return <section className="settings-section" aria-labelledby="advisor-settings-heading">
    <div><p className="section-label">Explanation boundary</p><h3 id="advisor-settings-heading">Advisor and retention</h3></div>
    <p className="muted">Provider credentials and encrypted conversation retention are managed inside Advisor, where the selected evidence context remains visible.</p>
    {providers.kind === 'ready'
      ? <dl className="settings-readout">{providers.value.providers.map((provider) => <div key={provider.provider}><dt>{provider.provider}</dt><dd>{provider.credentialState.replaceAll('_', ' ')}</dd></div>)}</dl>
      : <SurfaceState kind={providers.kind === 'loading' ? 'loading' : 'error'} title={providers.kind === 'loading' ? 'Loading Advisor status' : 'Advisor status unavailable'} compact />}
    <p className="settings-help">Session conversations are not retained. Encrypted conversations stay profile-scoped and can be exported or deleted from Advisor.</p>
  </section>;
}

function DiagnosticsSettings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const incidents = useChannel(client, 'app.incidents', { limit: 20 });
  const importEvents = useCommand(client, 'market-events.ingest-file', ['market-events.timeline']);
  return <section className="settings-section" aria-labelledby="diagnostics-settings-heading">
    <div><p className="section-label">Recorded runtime evidence</p><h3 id="diagnostics-settings-heading">Diagnostics</h3></div>
    {incidents.kind === 'loading' && <SurfaceState kind="loading" title="Loading diagnostics" compact />}
    {incidents.kind !== 'loading' && incidents.kind !== 'ready' && <SurfaceState kind="error" title="Diagnostics unavailable" detail="Recorded incidents could not be read." compact />}
    {incidents.kind === 'ready' && incidents.value.incidents.length === 0 && <SurfaceState kind="empty" title="No runtime incidents recorded" detail="Warnings and recovery evidence will appear here when the host records them." compact />}
    {incidents.kind === 'ready' && incidents.value.incidents.length > 0 && <ul className="settings-incident-list">{incidents.value.incidents.map((incident) => <li key={incident.id}><span><strong>{incident.kind.replaceAll('_', ' ')}</strong><small>{incident.source} · {new Date(incident.occurredAt).toLocaleString()}</small></span><span className={`connection-badge connection-${incident.severity === 'warning' ? 'attention_required' : 'unavailable'}`}>{incident.resolvedAt === null ? incident.severity : 'resolved'}</span></li>)}</ul>}
    <details className="settings-details"><summary>What is collected</summary><p>Sanitized runtime failures, recovery outcomes, and safety stops. Credentials, raw authorization headers, and decrypted Advisor conversations are excluded.</p></details>
    <details className="settings-details"><summary>Local event fixtures</summary><p>Import validated local JSON for temporal replay and research triggers. Event data cannot influence strategy targets or execution.</p><button type="button" className="button-secondary" disabled={importEvents.state.kind === 'pending'} onClick={() => void importEvents.run({ commandId: crypto.randomUUID(), sourceId: 'local.diagnostics', confirmed: true })}>{importEvents.state.kind === 'pending' ? 'Validating…' : 'Import event fixture'}</button>{importEvents.state.kind === 'failed' && <SurfaceState kind="error" title="Fixture not imported" detail={importEvents.state.codes.join(', ')} compact />}</details>
  </section>;
}

/** Profile-scoped settings grouped by the task the user is trying to complete. */
export function Settings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const settings = useChannel(client, 'accounts.settings', {});
  const [category, setCategory] = useState<SettingsCategory>('connections');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (settings.kind === 'loading') return <SurfaceState kind="loading" title="Loading settings" />;
  if (settings.kind !== 'ready') return <SurfaceState kind="error" title="Could not load settings" detail={settings.issues.map((issue) => issue.code).join(', ')} />;
  const view: SettingsView = settings.value;
  const selectCategory = (next: SettingsCategory): void => setCategory(next);
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % CATEGORIES.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + CATEGORIES.length) % CATEGORIES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = CATEGORIES.length - 1;
    else return;
    event.preventDefault();
    selectCategory(CATEGORIES[next]!.id);
    tabRefs.current[next]?.focus();
  };

  return <section aria-labelledby="settings-heading" className="screen-stack settings-screen">
    <header className="route-heading"><div><p className="eyebrow">Profile configuration</p><h2 id="settings-heading">Settings</h2></div></header>
    <label className="settings-category-select">Category<select value={category} onChange={(event) => selectCategory(event.target.value as SettingsCategory)}>{CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="settings-layout">
      <nav className="settings-category-tabs" role="tablist" aria-label="Settings categories" aria-orientation="vertical">
        {CATEGORIES.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`settings-tab-${item.id}`} aria-selected={category === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={category === item.id ? 0 : -1} onClick={() => selectCategory(item.id)} onKeyDown={(event) => moveTabFocus(event, index)}>{item.label}</button>)}
      </nav>
      <div className="settings-category-panel" role="tabpanel" id={`settings-panel-${category}`} aria-labelledby={`settings-tab-${category}`} tabIndex={0}>
        {category === 'connections' && <ConnectionManager key={view.profileId} client={client} />}
        {category === 'appearance' && <section className="settings-section" aria-labelledby="appearance-settings-heading"><div><p className="section-label">Profile presentation</p><h3 id="appearance-settings-heading">Appearance and accessibility</h3></div><DisplaySettings client={client} preferences={view.preferences} /><p className="opacity-70">{view.source === 'default' ? 'Using verified workstation defaults for this profile.' : 'Saved for this profile.'}</p></section>}
        {category === 'workspace' && <section className="settings-section" aria-labelledby="workspace-settings-heading"><div><p className="section-label">Workspace</p><h3 id="workspace-settings-heading">Mode and chart defaults</h3></div><WorkspaceSettings client={client} preferences={view.preferences} /></section>}
        {category === 'paper' && <div className="settings-panel-stack"><ExploratoryPaperSettings client={client} /><ExecutionPolicySettings client={client} /><PaperCampaignSettings client={client} /></div>}
        {category === 'advisor' && <AdvisorSettingsSummary client={client} />}
        {category === 'diagnostics' && <DiagnosticsSettings client={client} />}
      </div>
    </div>
  </section>;
}
