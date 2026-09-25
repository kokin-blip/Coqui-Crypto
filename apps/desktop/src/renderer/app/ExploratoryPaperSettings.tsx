import { useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

const INVALIDATIONS = ['paper.exploratory.status', 'paper.exploratory.portfolio',
  'paper.exploratory.performance', 'paper.execution.proposals', 'app.status-rail'] as const;

export function ExploratoryPaperSettings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const status = useChannel(client, 'paper.exploratory.status', {});
  const start = useCommand(client, 'paper.exploratory.start', INVALIDATIONS);
  const pause = useCommand(client, 'paper.exploratory.pause', INVALIDATIONS);
  const resume = useCommand(client, 'paper.exploratory.resume', INVALIDATIONS);
  const stop = useCommand(client, 'paper.exploratory.stop', INVALIDATIONS);
  const [confirmed, setConfirmed] = useState(false);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const current = status.kind === 'ready' ? status.value : null;

  return <section className="settings-section exploratory-paper-settings" aria-labelledby="exploratory-paper-heading">
    <div className="settings-section-heading">
      <span className="status-chip status-warning">Exploratory · unvalidated</span>
      <h3 id="exploratory-paper-heading">Run the current strategy in paper</h3>
      <p className="muted">Copies the latest connected Coinbase and Robinhood holdings into one isolated simulation. Supported assets use Coinbase completed bars and reference venue rules.</p>
    </div>
    {status.kind === 'loading' && <SurfaceState kind="loading" title="Reading exploratory campaign" compact />}
    {status.kind !== 'loading' && status.kind !== 'ready' && <SurfaceState kind="error" title="Campaign status unavailable" detail={status.issues.map((issue) => issue.code).join(', ')} compact />}
    {status.kind === 'ready' && current === null && <>
      <label className="confirmation-check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        I understand this starts unattended paper simulation from my current connected holdings and does not create validated evidence.
      </label>
      <button type="button" className="button-primary" disabled={!confirmed || start.state.kind === 'pending'}
        onClick={() => void start.run({ commandId: crypto.randomUUID(), explicitConfirmation: true })}>
        {start.state.kind === 'pending' ? 'Checking portfolio and market history…' : 'Start exploratory paper mode'}
      </button>
    </>}
    {current !== null && <div className="exploratory-campaign-state">
      <dl className="settings-readout">
        <div><dt>Status</dt><dd>{current.status}</dd></div>
        <div><dt>Simulation venue</dt><dd>Coinbase reference</dd></div>
        <div><dt>Managed assets</dt><dd>{current.campaign.baseWeights.length}</dd></div>
        <div><dt>Started</dt><dd>{new Date(current.campaign.startedAtMs).toLocaleString()}</dd></div>
      </dl>
      {current.status === 'active' && <button type="button" className="button-secondary"
        disabled={pause.state.kind === 'pending'} onClick={() => void pause.run({ commandId: crypto.randomUUID(),
          campaignId: current.campaign.campaignId })}>Pause new decisions</button>}
      {current.status === 'paused' && <button type="button" className="button-primary"
        disabled={resume.state.kind === 'pending'} onClick={() => void resume.run({ commandId: crypto.randomUUID(),
          campaignId: current.campaign.campaignId })}>Resume exploratory paper</button>}
      {current.status !== 'stopped' && <>
        <label className="confirmation-check"><input type="checkbox" checked={stopConfirmed}
          onChange={(event) => setStopConfirmed(event.target.checked)} /> Stop permanently after all submitted paper orders resolve.</label>
        <button type="button" className="button-danger" disabled={!stopConfirmed || stop.state.kind === 'pending'}
          onClick={() => void stop.run({ commandId: crypto.randomUUID(), campaignId: current.campaign.campaignId,
            explicitConfirmation: true })}>Stop campaign</button>
      </>}
    </div>}
    <ul className="exploratory-safety-list">
      <li>Real accounts remain read-only; live order submission is compile-time disabled.</li>
      <li>Research validation and profitability admission are observed, not enforced.</li>
      <li>Kill switch, product rules, sizing limits, host fencing, and next-open settlement remain enforced.</li>
      <li>Results cannot validate, promote, or activate a strategy.</li>
    </ul>
    {[start, pause, resume, stop].some((command) => command.state.kind === 'failed' || command.state.kind === 'blocked') &&
      <p className="action-error" role="alert">{[start, pause, resume, stop].flatMap((command) =>
        'codes' in command.state ? command.state.codes : []).join(', ')}</p>}
    <details className="settings-details"><summary>What gets copied</summary><p>Exact connected quantities, known cash, valuation evidence, and source-account attribution. Imported tax lots are excluded. Assets without eligible Coinbase daily history remain visible but unmanaged.</p></details>
  </section>;
}
