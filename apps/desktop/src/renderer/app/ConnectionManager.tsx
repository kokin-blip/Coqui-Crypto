import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { Database, Plus, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useState } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

type Connection = ChannelResponse<'connections.list'>['connections'][number];
const INVALIDATIONS = ['connections.list', 'portfolio.current', 'portfolio.history', 'app.status-rail'] as const;

function ConnectionRow({ client, connection }: { readonly client: CoquiClient; readonly connection: Connection }): React.JSX.Element {
  const sync = useCommand(client, 'connections.sync', INVALIDATIONS);
  const disconnect = useCommand(client, 'connections.disconnect', INVALIDATIONS);
  return (
    <article className="coinbase-connected-actions" aria-label={`${connection.label} connection`}>
      <div className="connection-card-heading">
        <div className="coinbase-sync-copy"><Database aria-hidden="true" size={18} /><span><strong>{connection.label}</strong><small>{connection.provider === 'coinbase' ? 'Coinbase' : 'Robinhood Crypto'} · Last sync {connection.lastSuccessfulSyncAtMs === null ? 'never' : new Date(connection.lastSuccessfulSyncAtMs).toLocaleString()}</small></span></div>
        <span className={`connection-badge connection-${connection.status === 'active' ? 'connected' : connection.status}`}>{connection.status.replaceAll('_', ' ')}</span>
      </div>
      {connection.failureReason !== null && <SurfaceState kind="blocked" title="Connection needs attention" detail={connection.failureReason.replaceAll('_', ' ')} compact />}
      <details className="settings-details"><summary>Connection details</summary><dl className="settings-readout coinbase-permissions">
        <div><dt>Health</dt><dd>{connection.health}</dd></div>
        <div><dt>Accounts</dt><dd>{connection.accountSuffixes.length > 0 ? connection.accountSuffixes.map((suffix) => `••••${suffix}`).join(', ') : 'Pending first sync'}</dd></div>
        <div><dt>Valuation</dt><dd>{connection.valuationComplete ? 'Complete' : 'Incomplete'}</dd></div>
        <div><dt>Permissions</dt><dd>{connection.permissions?.accountRead ? 'Read only' : 'Unverified'}</dd></div>
        <div><dt>Live execution</dt><dd>Disabled</dd></div>
      </dl></details>
      <div className="coinbase-action-row">
        <button type="button" className="button-primary" disabled={sync.state.kind === 'pending' || connection.status === 'disconnected'} onClick={() => void sync.run({ commandId: crypto.randomUUID(), connectionId: connection.id })}>
          <RefreshCw aria-hidden="true" size={15} />{sync.state.kind === 'pending' ? 'Syncing…' : 'Sync now'}
        </button>
        <button type="button" className="button-quiet button-disconnect" disabled={disconnect.state.kind === 'pending' || connection.status === 'disconnected'} onClick={() => void disconnect.run({ commandId: crypto.randomUUID(), connectionId: connection.id })}>
          <Unplug aria-hidden="true" size={15} />Disconnect
        </button>
      </div>
      {sync.state.kind === 'failed' && <SurfaceState kind="error" title="Sync failed" detail={sync.state.codes.join(', ')} compact />}
      {sync.state.kind === 'succeeded' && <SurfaceState kind="success" title="Portfolio updated" detail="Connected balances and their valuation were stored as immutable current-portfolio evidence." compact />}
    </article>
  );
}

export function ConnectionManager({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const connections = useChannel(client, 'connections.list', {});
  const connect = useCommand(client, 'connections.connect-file', INVALIDATIONS);
  const [provider, setProvider] = useState<'coinbase' | 'robinhood_crypto'>('coinbase');
  return (
    <section className="settings-section coinbase-settings" aria-labelledby="connection-manager-heading">
      <header className="coinbase-settings-heading">
        <div><p className="section-label">Connected accounts</p><h3 id="connection-manager-heading">Exchange connections</h3></div>
        <span className="connection-badge connection-connected">Read only</span>
      </header>
      <div className="coinbase-safety-strip"><ShieldCheck aria-hidden="true" size={18} /><span><strong>Credentials stay in the OS keychain</strong><small>Credential files are selected and read by the desktop host. Keys never enter the renderer, database, logs, or Advisor.</small></span></div>
      <div className="coinbase-key-actions">
        <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="coinbase">Coinbase</option><option value="robinhood_crypto">Robinhood Crypto</option></select></label>
        <button type="button" className="button-primary" disabled={connect.state.kind === 'pending'} onClick={() => void connect.run({ commandId: crypto.randomUUID(), provider })}>
          <Plus aria-hidden="true" size={15} />{connect.state.kind === 'pending' ? 'Verifying…' : 'Add connection'}
        </button>
      </div>
      {provider === 'robinhood_crypto' && <p className="settings-help">Select a JSON file containing <code>apiKey</code> and <code>privateKeyBase64</code> from Robinhood Crypto API settings. Coqui verifies account access and never enables live orders.</p>}
      {connect.state.kind === 'failed' && <SurfaceState kind="error" title="Connection was not added" detail={connect.state.codes.join(', ')} compact />}
      {connect.state.kind === 'succeeded' && <SurfaceState kind="success" title="Connection added" detail="The account was verified, synced, and added to the current portfolio." compact />}
      {connections.kind === 'loading' && <SurfaceState kind="loading" title="Loading connections" compact />}
      {connections.kind !== 'loading' && connections.kind !== 'ready' && <SurfaceState kind="error" title="Could not load connections" detail={connections.issues.map((issue) => issue.code).join(', ')} compact />}
      {connections.kind === 'ready' && connections.value.connections.length === 0 && <div className="panel-empty-body"><p>No exchange connections yet.</p></div>}
      {connections.kind === 'ready' && connections.value.connections.map((connection) => <ConnectionRow key={connection.id} client={client} connection={connection} />)}
    </section>
  );
}
