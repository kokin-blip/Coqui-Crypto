import type { CoquiClient } from '@coqui/contracts';
import { useRef } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

const INVALIDATES = ['alpaca.paper.status'] as const;

export function AlpacaPaperConnection({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const status = useChannel(client, 'alpaca.paper.status', {});
  const connect = useCommand(client, 'alpaca.paper.connect', INVALIDATES);
  const refresh = useCommand(client, 'alpaca.paper.refresh', INVALIDATES);
  const disconnect = useCommand(client, 'alpaca.paper.disconnect', INVALIDATES);
  const keyId = useRef<HTMLInputElement>(null);
  const secretKey = useRef<HTMLInputElement>(null);

  const submit = (): void => {
    const id = keyId.current?.value.trim() ?? '';
    const secret = secretKey.current?.value.trim() ?? '';
    if (!id || !secret) return;
    // Values reside in the renderer only for entry and this one IPC request.
    if (keyId.current !== null) keyId.current.value = '';
    if (secretKey.current !== null) secretKey.current.value = '';
    void connect.run({ commandId: crypto.randomUUID(), keyId: id, secretKey: secret });
  };

  const connected = status.kind === 'ready' && status.value.state === 'connected';
  return (
    <section className="settings-section coinbase-settings" aria-labelledby="alpaca-paper-heading">
      <header className="coinbase-settings-heading">
        <div><p className="section-label">External paper account</p><h3 id="alpaca-paper-heading">Alpaca Paper</h3></div>
        <span className={`connection-badge connection-${connected ? 'connected' : 'attention_required'}`}>
          {connected ? 'Connected · paper only' : 'Not connected'}
        </span>
      </header>
      <p className="settings-help">Alpaca records these paper orders and simulated fills on its own system. They are not real exchange trades. Coqui never sends orders to an Alpaca live account.</p>
      <details className="settings-details"><summary>Get paper API keys</summary>
        <ol className="settings-guide-list"><li>Open a dedicated Alpaca paper account.</li><li>Generate that paper account’s API key ID and secret key in Alpaca’s dashboard.</li><li>Enter both below. Do not use live-account keys.</li></ol>
        <a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noreferrer">Open Alpaca paper dashboard</a>
      </details>
      <div className="coinbase-key-control">
        <label>Paper API key ID<input ref={keyId} type="text" autoComplete="off" spellCheck={false} maxLength={256} disabled={connect.state.kind === 'pending'} /></label>
        <label>Paper secret key<input ref={secretKey} type="password" autoComplete="off" spellCheck={false} maxLength={512} disabled={connect.state.kind === 'pending'} /></label>
        <p className="settings-help">Keys pass through this form briefly for verification, then reside in the OS keychain. They are not saved in Coqui’s database or returned to this screen.</p>
        <div className="coinbase-action-row">
          <button type="button" className="button-primary" disabled={connect.state.kind === 'pending'} onClick={submit}>
            {connect.state.kind === 'pending' ? 'Verifying paper account…' : connected ? 'Replace paper keys' : 'Connect paper account'}
          </button>
          {connected && <button type="button" className="button-secondary" disabled={refresh.state.kind === 'pending'} onClick={() => void refresh.run({ commandId: crypto.randomUUID() })}>Refresh account</button>}
          {connected && <button type="button" className="button-quiet button-disconnect" disabled={disconnect.state.kind === 'pending'} onClick={() => void disconnect.run({ commandId: crypto.randomUUID() })}>Disconnect</button>}
        </div>
      </div>
      {status.kind === 'ready' && status.value.accountSuffix !== null && <p className="settings-help">Paper account ••••{status.value.accountSuffix}{status.value.equityUsd === null ? '' : ` · equity $${status.value.equityUsd}`}</p>}
      {status.kind === 'ready' && status.value.reasonCode !== null && <SurfaceState kind="blocked" title="Paper connection needs attention" detail={status.value.reasonCode.replaceAll('_', ' ')} compact />}
      {connect.state.kind === 'failed' && <SurfaceState kind="error" title="Alpaca paper connection failed" detail={connect.state.codes.join(', ')} compact />}
      {refresh.state.kind === 'failed' && <SurfaceState kind="error" title="Alpaca paper refresh failed" detail={refresh.state.codes.join(', ')} compact />}
      {disconnect.state.kind === 'failed' && <SurfaceState kind="error" title="Alpaca paper disconnect failed" detail={disconnect.state.codes.join(', ')} compact />}
    </section>
  );
}
