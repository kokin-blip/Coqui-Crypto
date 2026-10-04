import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
export function DailyResearchShadowSettings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const status = useChannel(client, 'research.overlay-shadow.status', {});
  const command = useCommand(client, 'research.overlay-shadow.set', ['research.overlay-shadow.status']);
  return <section className="screen-stack" aria-labelledby="research-shadow-heading">
    <div className="setting-line"><span><strong id="research-shadow-heading">Daily research shadow</strong><small>Separate daily and 14-day simulations. No orders or qualification changes. Models update only through explicit artifact imports.</small></span></div>
    {status.kind === 'ready' ? <>
      <label className="confirmation-check" style={{ color: 'var(--coqui-text)' }}><input type="checkbox" checked={status.value.enabled} disabled={command.state.kind === 'pending'}
        onChange={() => void command.run({ commandId: crypto.randomUUID(), enabled: !status.value.enabled })} /> Enable research shadow</label>
      <p role="status">{!status.value.enabled ? 'Disabled. Recorded evidence is retained.' : status.value.bindingHash === null
        ? 'Configuration required. Import a research configuration before observations can begin.' : status.value.reason === 'data_unavailable'
          ? 'Completed data is missing or stale. No new simulations are being created.' : `Observing · ${status.value.pending} pending simulations · unqualified`}</p>
      {status.value.arms.length > 0 && <div className="table-scroll"><table><caption>Research shadow books</caption><thead><tr><th scope="col">Cadence</th><th scope="col">Equity USD</th><th scope="col">Net P&amp;L USD</th><th scope="col">Costs USD</th><th scope="col">State</th></tr></thead>
        <tbody>{status.value.arms.map((arm) => <tr key={arm.cadence}><th scope="row">{arm.cadence === 1 ? 'Daily' : '14 days'}</th><td>{arm.equityUsd}</td><td>{arm.netPnlUsd}</td><td>{arm.costUsd}</td><td>{arm.stopped ? 'Safety stopped' : arm.artifactHash ? 'Frozen artifact' : 'Baseline only'}</td></tr>)}</tbody></table></div>}
    </> : <p role="status">{status.kind === 'loading' ? 'Loading research shadow status…' : 'Research shadow status unavailable. Reload settings to try again.'}</p>}
    {(command.state.kind === 'failed' || command.state.kind === 'blocked') && <p role="alert">The setting could not be saved. Try again.</p>}
  </section>;
}
