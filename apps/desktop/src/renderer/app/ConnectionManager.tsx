import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { Database, Plus, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

type Connection = ChannelResponse<'connections.list'>['connections'][number];
const INVALIDATIONS = ['connections.list', 'portfolio.current', 'portfolio.history', 'app.status-rail'] as const;
const ROBINHOOD_SETUP_INVALIDATIONS = ['connections.robinhood.keypair.status'] as const;

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
  const pendingRobinhood = useChannel(client, 'connections.robinhood.keypair.status', {});
  const connect = useCommand(client, 'connections.connect-file', INVALIDATIONS);
  const beginRobinhood = useCommand(client, 'connections.robinhood.keypair.begin', ROBINHOOD_SETUP_INVALIDATIONS);
  const completeRobinhood = useCommand(client, 'connections.robinhood.keypair.complete', [...INVALIDATIONS, ...ROBINHOOD_SETUP_INVALIDATIONS]);
  const cancelRobinhood = useCommand(client, 'connections.robinhood.keypair.cancel', ROBINHOOD_SETUP_INVALIDATIONS);
  const [provider, setProvider] = useState<'coinbase' | 'robinhood_crypto'>('coinbase');
  const [robinhoodSetup, setRobinhoodSetup] = useState<ChannelResponse<'connections.robinhood.keypair.begin'> | null>(null);
  useEffect(() => {
    if (beginRobinhood.state.kind === 'succeeded' && beginRobinhood.value !== null) setRobinhoodSetup(beginRobinhood.value);
  }, [beginRobinhood.state.kind, beginRobinhood.value]);
  useEffect(() => {
    if (pendingRobinhood.kind !== 'ready') return;
    if (pendingRobinhood.value.state === 'pending' && pendingRobinhood.value.setup !== null) {
      setRobinhoodSetup(pendingRobinhood.value.setup);
      setProvider('robinhood_crypto');
    } else if (pendingRobinhood.value.state === 'none') setRobinhoodSetup(null);
  }, [pendingRobinhood]);
  return (
    <section className="settings-section coinbase-settings" aria-labelledby="connection-manager-heading">
      <header className="coinbase-settings-heading">
        <div><p className="section-label">Connected accounts</p><h3 id="connection-manager-heading">Exchange connections</h3></div>
        <span className="connection-badge connection-connected">Read only</span>
      </header>
      <div className="coinbase-safety-strip"><ShieldCheck aria-hidden="true" size={18} /><span><strong>Credentials stay in the OS keychain</strong><small>Credential files are selected and read by the desktop host. Keys never enter the renderer, database, logs, or Advisor.</small></span></div>
      <div className="coinbase-key-actions">
        <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="coinbase">Coinbase</option><option value="robinhood_crypto">Robinhood Crypto</option></select></label>
        {provider === 'coinbase' && <button type="button" className="button-primary" disabled={connect.state.kind === 'pending'} onClick={() => void connect.run({ commandId: crypto.randomUUID(), provider })}>
          <Plus aria-hidden="true" size={15} />{connect.state.kind === 'pending' ? 'Verifying…' : 'Choose Coinbase key file'}
        </button>}
        {provider === 'robinhood_crypto' && robinhoodSetup === null && <button type="button" className="button-primary" disabled={beginRobinhood.state.kind === 'pending' || pendingRobinhood.kind === 'loading'} onClick={() => void beginRobinhood.run({ commandId: crypto.randomUUID() })}><Plus aria-hidden="true" size={15} />{pendingRobinhood.kind === 'loading' ? 'Checking for saved setup…' : pendingRobinhood.kind === 'ready' && pendingRobinhood.value.state === 'unavailable' ? 'Start over with a new key pair' : 'Generate Robinhood key pair'}</button>}
      </div>
      {provider === 'coinbase' && <details className="settings-details"><summary>Coinbase setup guide</summary><ol className="settings-guide-list"><li>Create a Secret or Server key in Coinbase Developer Platform.</li><li>Enable View only. Disable Trade and Transfer.</li><li>Download the JSON key file and choose it above.</li></ol><a href="https://portal.cdp.coinbase.com/access/api" target="_blank" rel="noreferrer">Open official Coinbase key settings</a></details>}
      {provider === 'robinhood_crypto' && <div className="settings-guided-connection"><p className="settings-help">Coqui can generate the Ed25519 key pair. The private key stays in the OS keychain; only the public key appears here for registration with Robinhood.</p>{pendingRobinhood.kind === 'ready' && pendingRobinhood.value.state === 'unavailable' && <SurfaceState kind="error" title="Pending setup cannot be resumed" detail="The matching private key is unavailable. Start over before registering another public key." compact />}{robinhoodSetup !== null && <div className="onboarding-public-key"><span><strong>{pendingRobinhood.kind === 'ready' && pendingRobinhood.value.state === 'pending' ? 'Setup restored · register this public key' : 'Register this public key'}</strong><small>Copy the API key Robinhood returns, then import it explicitly.</small></span><code>{robinhoodSetup.publicKeyBase64}</code><div className="coinbase-action-row"><button className="button-primary" type="button" disabled={completeRobinhood.state.kind === 'pending'} onClick={() => void completeRobinhood.run({ commandId: crypto.randomUUID(), setupId: robinhoodSetup.setupId })}>{completeRobinhood.state.kind === 'pending' ? 'Verifying and syncing…' : 'Import copied API key'}</button><button className="button-quiet" type="button" onClick={() => { void cancelRobinhood.run({ commandId: crypto.randomUUID(), setupId: robinhoodSetup.setupId }); setRobinhoodSetup(null); }}>Cancel</button></div></div>}<details className="settings-details"><summary>Advanced JSON import</summary><p>Select a JSON file containing <code>apiKey</code> and <code>privateKeyBase64</code>.</p><button type="button" className="button-secondary" onClick={() => void connect.run({ commandId: crypto.randomUUID(), provider: 'robinhood_crypto' })}>Choose existing key file</button></details></div>}
      {connect.state.kind === 'failed' && <SurfaceState kind="error" title="Connection was not added" detail={connect.state.codes.join(', ')} compact />}
      {connect.state.kind === 'succeeded' && <SurfaceState kind="success" title="Connection added" detail="The account was verified, synced, and added to the current portfolio." compact />}
      {completeRobinhood.state.kind === 'failed' && <SurfaceState kind="error" title="Robinhood connection was not added" detail={completeRobinhood.state.codes.join(', ')} compact />}
      {completeRobinhood.state.kind === 'succeeded' && <SurfaceState kind="success" title="Robinhood connected" detail="The copied API key was verified and the account synchronized." compact />}
      {connections.kind === 'loading' && <SurfaceState kind="loading" title="Loading connections" compact />}
      {connections.kind !== 'loading' && connections.kind !== 'ready' && <SurfaceState kind="error" title="Could not load connections" detail={connections.issues.map((issue) => issue.code).join(', ')} compact />}
      {connections.kind === 'ready' && connections.value.connections.length === 0 && <div className="panel-empty-body"><p>No exchange connections yet.</p></div>}
      {connections.kind === 'ready' && connections.value.connections.map((connection) => <ConnectionRow key={connection.id} client={client} connection={connection} />)}
    </section>
  );
}
