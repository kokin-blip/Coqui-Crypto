import type { CoquiClient } from '@coqui/contracts';
import { useState } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

const INVALIDATES = ['parallel.paper.status'] as const;

export function ParallelPaperSettings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const status = useChannel(client, 'parallel.paper.status', {});
  const start = useCommand(client, 'parallel.paper.start', INVALIDATES);
  const pause = useCommand(client, 'parallel.paper.pause', INVALIDATES);
  const resume = useCommand(client, 'parallel.paper.resume', INVALIDATES);
  const stop = useCommand(client, 'parallel.paper.stop', INVALIDATES);
  const [confirmed, setConfirmed] = useState(false);
  const [smokeVerified, setSmokeVerified] = useState(false);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const current = status.kind === 'ready' ? status.value : null;
  const issue = [start, pause, resume, stop].find((item) => item.state.kind === 'failed' || item.state.kind === 'blocked');

  return <section className="settings-section exploratory-paper-settings" aria-labelledby="parallel-paper-heading">
    <div className="settings-section-heading">
      <span className="status-chip status-warning">Research · paper only</span>
      <h3 id="parallel-paper-heading">Parallel TrendVol experiment</h3>
      <p className="muted">One frozen v4.2 decision stream, two separate paper accounts: a Coinbase-sized Coqui simulation and your dedicated Alpaca paper wallet.</p>
    </div>
    <ul className="exploratory-safety-list">
      <li>Coinbase remains read-only; Coqui copies only its current portfolio value as opening cash.</li>
      <li>Alpaca paper orders are submitted to Alpaca’s external simulator, not a live exchange.</li>
      <li>Use a fresh, empty Alpaca paper account. Coqui will not reset or liquidate it.</li>
      <li>Results remain exploratory and cannot promote the strategy to real trading.</li>
    </ul>
    {status.kind === 'loading' && <SurfaceState kind="loading" title="Reading parallel experiment" compact />}
    {status.kind !== 'loading' && status.kind !== 'ready' && <SurfaceState kind="error" title="Experiment status unavailable" detail={status.issues.map((item) => item.code).join(', ')} compact />}
    {(current?.state === 'none' || current?.state === 'stopped') && <>
      <label className="confirmation-check"><input type="checkbox" checked={smokeVerified} onChange={(event) => setSmokeVerified(event.target.checked)} />I independently verified a small Alpaca paper order in its API and dashboard, then returned this dedicated paper account to an empty state.</label>
      <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I understand this will automatically submit orders to my connected Alpaca paper account after completed daily decisions.</label>
      <button type="button" className="button-primary" disabled={!confirmed || !smokeVerified || start.state.kind === 'pending'} onClick={() => void start.run({ commandId: crypto.randomUUID(), smokeVerified: true })}>
        {start.state.kind === 'pending' ? 'Checking both paper wallets…' : 'Start parallel paper experiment'}
      </button>
    </>}
    {current !== null && current.state !== 'none' && <div className="exploratory-campaign-state">
      <dl className="settings-readout">
        <div><dt>Status</dt><dd>{current.state}</dd></div>
        <div><dt>Coqui opening value</dt><dd>{current.coquiOpeningUsd === null ? 'Unavailable' : `$${current.coquiOpeningUsd}`}</dd></div>
        <div><dt>Alpaca opening value</dt><dd>{current.alpacaOpeningUsd === null ? 'Unavailable' : `$${current.alpacaOpeningUsd}`}</dd></div>
        <div><dt>Decisions</dt><dd>{current.decisionCount}</dd></div>
      </dl>
      {current.lastReason !== null && <SurfaceState kind="blocked" title="Experiment paused" detail={current.lastReason.replaceAll('_', ' ')} compact />}
      {current.state === 'active' && <button type="button" className="button-secondary" disabled={pause.state.kind === 'pending'} onClick={() => void pause.run({ commandId: crypto.randomUUID() })}>Pause new paper orders</button>}
      {current.state === 'paused' && <button type="button" className="button-primary" disabled={resume.state.kind === 'pending'} onClick={() => void resume.run({ commandId: crypto.randomUUID() })}>Resume</button>}
      {current.state !== 'stopped' && <>
        <label className="confirmation-check"><input type="checkbox" checked={stopConfirmed} onChange={(event) => setStopConfirmed(event.target.checked)} />Cancel outstanding experiment orders and stop; keep existing paper holdings.</label>
        <button type="button" className="button-danger" disabled={!stopConfirmed || stop.state.kind === 'pending'} onClick={() => void stop.run({ commandId: crypto.randomUUID() })}>Stop experiment</button>
      </>}
    </div>}
    {issue !== undefined && <p className="action-error" role="alert">{'codes' in issue.state ? issue.state.codes.join(', ').replaceAll('_', ' ') : 'Action failed'}</p>}
  </section>;
}
