import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';
import { Database, FileKey2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';
import { actionFailureCopy, COINBASE_REASON_COPY, coinbaseIssueCopy } from './coinbase-presentation.js';

type Connection = ChannelResponse<'accounts.coinbase.status'>;
type SyncResult = ChannelResponse<'accounts.coinbase.sync'>;

const INVALIDATIONS = ['accounts.coinbase.status', 'app.status-rail', 'portfolio.reconciliation'] as const;
const MAX_KEY_FILE_BYTES = 65_536;

function connectionTitle(connection: Connection): string {
  if (connection.state === 'connected') return 'Connected · view only';
  if (connection.state === 'attention_required') return 'Connection needs attention';
  if (connection.state === 'unavailable') return 'Credential store unavailable';
  return 'Not connected';
}

function SyncEvidence({ result }: { readonly result: SyncResult }): React.JSX.Element {
  return (
    <div className="coinbase-sync-result" role="status">
      <div>
        <span className="status-chip status-succeeded">{result.created ? 'Evidence stored' : 'Already recorded'}</span>
        <strong>{result.evidenceCount.toLocaleString()} immutable evidence record{result.evidenceCount === 1 ? '' : 's'}</strong>
      </div>
      <dl className="coinbase-sync-grid">
        <div><dt>Accounts</dt><dd>{result.accountCount}</dd></div>
        <div><dt>Fills</dt><dd>{result.fillCount}</dd></div>
        <div><dt>Transactions</dt><dd>{result.transactionCount}</dd></div>
        <div><dt>Discrepancies</dt><dd>{result.discrepancyCount}</dd></div>
        <div><dt>Fee tier</dt><dd>{result.feeTierCaptured ? 'Captured' : 'Not returned'}</dd></div>
      </dl>
      <p>Dataset <code>{result.datasetHash}</code></p>
      <p>Portfolio history, tax lots, and execution state were not changed.</p>
    </div>
  );
}

function KeyFileControl({
  busy,
  label,
  onSelect,
  onConnect,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly onSelect: () => void;
  readonly onConnect: (contents: string) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const active = useRef(true);
  const readingRef = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [fileIssue, setFileIssue] = useState<string | null>(null);

  const selectFile = (file: File | undefined): void => {
    setSelected(null);
    setFileIssue(null);
    if (file === undefined) return;
    if (file.size === 0 || file.size > MAX_KEY_FILE_BYTES) {
      setFileIssue('The key file must be between 1 byte and 64 KiB.');
      if (input.current !== null) input.current.value = '';
      return;
    }
    setSelected(file);
    onSelect();
  };

  const connect = async (): Promise<void> => {
    if (selected === null || busy || readingRef.current) return;
    readingRef.current = true;
    setReading(true);
    const file = selected;
    setSelected(null);
    if (input.current !== null) input.current.value = '';
    try {
      const contents = await file.text();
      if (active.current) onConnect(contents);
    } catch {
      if (active.current) setFileIssue('The selected key file could not be read.');
    } finally {
      readingRef.current = false;
      if (active.current) setReading(false);
    }
  };

  return (
    <div className="coinbase-key-control">
      <div className="coinbase-key-copy">
        <FileKey2 aria-hidden="true" size={18} />
        <span><strong>Coinbase CDP API key JSON</strong><small>Choose the downloaded key file. Its contents are never displayed or persisted by the renderer.</small></span>
      </div>
      <div className="coinbase-key-actions">
        <label className="button-secondary file-button">
          Choose key file
          <input ref={input} className="sr-only" type="file" accept=".json,application/json" disabled={busy || reading} onChange={(event) => selectFile(event.target.files?.[0])} />
        </label>
        <span className="coinbase-filename">{selected?.name ?? 'No file selected'}</span>
        <button type="button" className="button-primary" disabled={busy || reading || selected === null} aria-busy={busy || reading} onClick={() => void connect()}>{reading ? 'Reading key file…' : label}</button>
      </div>
      {fileIssue !== null && <p className="field-error" role="alert">{fileIssue}</p>}
    </div>
  );
}

export function CoinbaseConnectionSettings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const connection = useChannel(client, 'accounts.coinbase.status', {});
  const connect = useCommand(client, 'accounts.coinbase.connect-json', INVALIDATIONS);
  const disconnect = useCommand(client, 'accounts.coinbase.disconnect', INVALIDATIONS);
  const sync = useCommand(client, 'accounts.coinbase.sync', INVALIDATIONS);
  const disconnectDialog = useRef<HTMLDialogElement>(null);
  const disconnectTrigger = useRef<HTMLButtonElement>(null);
  const connectPresentation = presentAction(connect.state, { idle: 'Verify and connect', pending: 'Verifying view-only key…' }, 'consequential');
  const disconnectPresentation = presentAction(disconnect.state, { idle: 'Disconnect Coinbase', pending: 'Removing credential…' }, 'consequential');
  const syncPresentation = presentAction(sync.state, { idle: 'Sync immutable evidence', pending: 'Syncing Coinbase evidence…' }, 'consequential');
  const connectFailure = actionFailureCopy(connect.state);
  const disconnectFailure = actionFailureCopy(disconnect.state);
  const syncFailure = actionFailureCopy(sync.state);

  const runConnect = (contents: string): void => {
    disconnect.reset();
    sync.reset();
    void connect.run({ commandId: crypto.randomUUID(), contents });
  };
  const runDisconnect = (): void => {
    disconnectDialog.current?.close();
    connect.reset();
    sync.reset();
    void disconnect.run({ commandId: crypto.randomUUID() });
  };

  return (
    <section className="settings-section coinbase-settings" aria-labelledby="coinbase-settings-heading">
      <header className="coinbase-settings-heading">
        <div><p className="section-label">Data source</p><h3 id="coinbase-settings-heading">Coinbase account evidence</h3></div>
        {connection.kind === 'ready' && <span className={`connection-badge connection-${connection.value.state}`}>{connectionTitle(connection.value)}</span>}
      </header>

      {connection.kind === 'loading' && <SurfaceState kind="loading" title="Checking Coinbase connection" detail="Reading this profile's credential state from the OS secret store." compact />}
      {connection.kind !== 'loading' && connection.kind !== 'ready' && <SurfaceState kind="error" title="Could not read Coinbase connection state" detail={connection.issues.map((issue) => coinbaseIssueCopy(issue.code)).join(' ')} compact />}

      {connection.kind === 'ready' && <>
        <div className="coinbase-safety-strip">
          <ShieldCheck aria-hidden="true" size={18} />
          <span><strong>Read-only by construction</strong><small>Coqui rejects keys that can trade or transfer. Sync stores evidence and never submits orders.</small></span>
        </div>

        <dl className="settings-readout coinbase-permissions">
          <div><dt>Permission</dt><dd>{connection.value.permissionMode === 'view_only' ? 'View only' : 'Unknown'}</dd></div>
          <div><dt>Portfolio identity</dt><dd>{connection.value.portfolioIdentityVerified ? 'Verified' : 'Not verified'}</dd></div>
          <div><dt>Execution authority</dt><dd>None</dd></div>
          <div><dt>Transfer authority</dt><dd>None</dd></div>
        </dl>

        {connection.value.reasonCode !== null && <SurfaceState
          kind={connection.value.state === 'unavailable' ? 'error' : 'blocked'}
          title={connectionTitle(connection.value)}
          detail={COINBASE_REASON_COPY[connection.value.reasonCode]}
          compact
        />}

        {connection.value.state !== 'unavailable' && connection.value.state !== 'connected' && <KeyFileControl busy={connectPresentation.busy || connect.state.kind === 'unknown'} label={connectPresentation.label} onSelect={() => connect.reset()} onConnect={runConnect} />}

        {connection.value.state === 'connected' && <div className="coinbase-connected-actions">
          <div className="coinbase-sync-copy"><Database aria-hidden="true" size={18} /><span><strong>Append-only account evidence</strong><small>Accounts, fills, transactions, fee tier, and reconciliation facts are validated before storage.</small></span></div>
          <div className="coinbase-action-row">
            <button type="button" className="button-primary" disabled={syncPresentation.disabled || disconnectPresentation.busy} aria-busy={syncPresentation.busy} onClick={() => void sync.run({ commandId: crypto.randomUUID() })}><RefreshCw aria-hidden="true" size={15} />{syncPresentation.label}</button>
            <button ref={disconnectTrigger} type="button" className="button-quiet button-disconnect" disabled={disconnectPresentation.disabled || syncPresentation.busy} onClick={() => disconnectDialog.current?.showModal()}><Unplug aria-hidden="true" size={15} />Disconnect</button>
          </div>
        </div>}
      </>}

      {connect.state.kind === 'succeeded' && <SurfaceState kind="success" title="Coinbase connected" detail="The view-only key and portfolio identity were verified." compact />}
      {connectFailure !== null && <SurfaceState kind={connect.state.kind === 'blocked' ? 'blocked' : 'error'} title={connect.state.kind === 'unknown' ? 'Connection outcome unknown' : 'Coinbase was not connected'} detail={connectFailure} compact />}
      {disconnect.state.kind === 'succeeded' && <SurfaceState kind="success" title="Coinbase disconnected" detail="The profile credential and its identity fingerprints were removed." compact />}
      {disconnectFailure !== null && <SurfaceState kind={disconnect.state.kind === 'blocked' ? 'blocked' : 'error'} title={disconnect.state.kind === 'unknown' ? 'Disconnect outcome unknown' : 'Coinbase was not disconnected'} detail={disconnectFailure} compact />}
      {sync.state.kind === 'succeeded' && sync.value !== null && <SyncEvidence result={sync.value} />}
      {syncFailure !== null && <SurfaceState kind={sync.state.kind === 'blocked' ? 'blocked' : 'error'} title={sync.state.kind === 'unknown' ? 'Sync outcome unknown' : 'Coinbase evidence was not synced'} detail={syncFailure} compact />}

      <span className="sr-only" aria-live="polite">{connectPresentation.liveMessage} {disconnectPresentation.liveMessage} {syncPresentation.liveMessage}</span>

      <dialog ref={disconnectDialog} onClose={() => disconnectTrigger.current?.focus()} className="review-dialog coinbase-disconnect-dialog" aria-labelledby="coinbase-disconnect-heading">
        <form method="dialog" className="review-dialog-content">
          <div className="dialog-heading"><div><p className="eyebrow">Credential removal</p><h2 id="coinbase-disconnect-heading">Disconnect Coinbase?</h2></div><button className="button-quiet" value="cancel">Cancel</button></div>
          <p>This removes the credential and identity fingerprints for the active profile. Existing immutable evidence remains available.</p>
          <div className="dialog-actions"><button type="button" className="button-danger" onClick={runDisconnect}>Remove credential</button></div>
        </form>
      </dialog>
    </section>
  );
}
