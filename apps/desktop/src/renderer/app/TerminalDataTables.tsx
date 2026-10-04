import { useState, type ReactNode } from 'react';
import type { CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { PaperProposalReview } from './PaperProposalReview.js';
import { formatLocalTimestamp } from './time-format.js';
import { CoinIcon } from './CoinIcon.js';

const money = (v: string | null): string => v === null ? 'Unavailable' : formatUsd(v)?.text ?? v;

function Table({ headers, children, empty, label }: { readonly headers: readonly string[]; readonly children: ReactNode;
  readonly empty: boolean; readonly label: string }): React.JSX.Element {
  return <div className="terminal-table-scroll"><table className="terminal-data-table"><caption className="sr-only">{label}</caption><thead><tr>{headers.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>
    {empty ? <tr><td colSpan={headers.length} className="terminal-empty">No {label.toLowerCase()} recorded.</td></tr> : children}
  </tbody></table></div>;
}

export function TerminalAssets({ client, onProductChange }: { readonly client: CoquiClient; readonly onProductChange: (productId: string) => void }): React.JSX.Element {
  const state = useChannel(client, 'portfolio.current', {});
  const [account, setAccount] = useState('all');
  const exposures = state.kind === 'ready' ? state.value?.exposures ?? [] : [];
  const rows = exposures.filter((item) => account === 'all' || item.contributions.some((c) => c.provider === account));
  return <><div className="terminal-table-toolbar"><label>Includes account<select value={account} onChange={(event) => setAccount(event.target.value)}><option value="all">All accounts</option><option value="coinbase">Coinbase</option><option value="robinhood_crypto">Robinhood Crypto</option></select></label><span>Combined connected balances · read-only</span><a href="#/portfolio/holdings">Cost basis & details →</a></div>
    <ChannelNotice state={state} label="Assets" />
    {state.kind === 'ready' && <>{state.value !== null && !state.value.complete && <p className="terminal-state-note">Valuation incomplete · unpriced assets remain visible</p>}
      <Table label="Connected assets" headers={['Asset', 'Quantity', 'Value (USD)', 'Accounts', 'Valuation']} empty={rows.length === 0}>
        {rows.map((asset) => <tr key={asset.exposureKey}><th scope="row"><button type="button" className="terminal-asset" disabled={asset.exposureKey === 'USD'} onClick={() => onProductChange(`${asset.exposureKey}-USD`)}><CoinIcon symbol={asset.exposureKey} /><strong>{asset.exposureKey}</strong></button></th><td>{asset.quantity}</td><td>{money(asset.valueUsd)}</td><td>{[...new Set(asset.contributions.map((c) => c.provider === 'coinbase' ? 'Coinbase' : 'Robinhood Crypto'))].join(', ')}</td><td>{asset.valueUsd === null ? 'Unpriced' : 'Priced'}</td></tr>)}
      </Table></>}
  </>;
}

export function TerminalPositions({ client, onProductChange }: { readonly client: CoquiClient; readonly onProductChange: (productId: string) => void }): React.JSX.Element {
  const paper = useChannel(client, 'paper.portfolio', {});
  const exploratory = useChannel(client, 'paper.exploratory.portfolio', {});
  const [source, setSource] = useState<'current' | 'paper' | 'exploratory'>('current');
  const selectedSource = source === 'current' ? exploratory.kind === 'ready' && exploratory.value?.primary === true ? 'exploratory' : 'paper' : source;
  const state = source === 'current' && exploratory.kind !== 'ready' ? exploratory : selectedSource === 'paper' ? paper : exploratory;
  const rows = selectedSource === 'paper' ? paper.kind === 'ready' ? paper.value.positions.map((p) => ({ id: p.instrument.productId, asset: p.instrument.productId.split('-')[0]!, quantity: p.quantity, value: p.valueUsd })) : []
    : exploratory.kind === 'ready' && exploratory.value !== null ? exploratory.value.balances.map((p) => ({ id: `${p.exposureKey}-USD`, asset: p.exposureKey, quantity: p.quantity, value: p.valueUsd })) : [];
  return <><div className="terminal-table-toolbar"><label>Simulation<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="current">Current paper campaign</option><option value="paper">Paper ledger</option><option value="exploratory">Exploratory campaign</option></select></label><span>Simulated positions · separate from connected assets</span></div>
    <ChannelNotice state={state} label="Paper positions" />{state.kind === 'ready' && <Table label="Paper positions" headers={['Market', 'Quantity', 'Value (USD)', 'Valuation', 'Mode']} empty={rows.length === 0}>
      {rows.map((p) => <tr key={p.id}><th><button type="button" className="terminal-asset" disabled={p.asset === 'USD'} onClick={() => onProductChange(p.id)}><CoinIcon symbol={p.asset} />{p.id}</button></th><td>{p.quantity}</td><td>{money(p.value)}</td><td>{p.value === null ? 'Incomplete' : 'Priced'}</td><td>{selectedSource === 'paper' ? 'Paper' : 'Exploratory / unvalidated'}</td></tr>)}
    </Table>}</>;
}

export function TerminalProposals({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const state = useChannel(client, 'paper.execution.proposals', { limit: 100 });
  const [filter, setFilter] = useState('all');
  const rows = state.kind === 'ready' ? state.value.proposals.filter((p) => filter === 'all' || p.status === filter) : [];
  return <><div className="terminal-table-toolbar"><label>Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['all', 'pending_review', 'executing', 'blocked', 'succeeded', 'unknown', 'failed', 'rejected', 'approved'].map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label><span>System-generated rebalances · paper only</span><a href="#/paper/overview">Paper controls →</a></div>
    <ChannelNotice state={state} label="Proposals" />{state.kind === 'ready' && <Table label="Paper proposals" headers={['Created', 'Rebalance actions', 'Status', 'Revision / evidence', 'Review']} empty={rows.length === 0}>
      {rows.map((p) => <tr key={p.id}><td>{formatLocalTimestamp(p.createdAt)}</td><td>{p.actions.length === 0 ? 'No actions' : p.actions.map((a) => `${a.side.toUpperCase()} ${a.productId} · ${money(a.amountUsd)}`).join(' / ')}</td><td className={p.status === 'blocked' || p.status === 'unknown' ? 'terminal-warning' : ''}>{p.status.replaceAll('_', ' ')}{p.reasonCode !== null && <small>{p.reasonCode.replaceAll('_', ' ')}</small>}{p.status === 'unknown' && <small>Reconcile before retrying</small>}</td><td title={p.proposalHash}>r{p.revision} · {p.proposalHash.slice(0, 12)}…</td><td>{p.status === 'pending_review' ? <PaperProposalReview client={client} proposal={p} /> : <a href="#/paper/orders">Details →</a>}</td></tr>)}
    </Table>}</>;
}

export function TerminalDecisions({ client, productId }: { readonly client: CoquiClient; readonly productId: string }): React.JSX.Element {
  const [all, setAll] = useState(false);
  const state = useChannel(client, 'decision.timeline', { assetScope: all ? null : productId.split('-')[0]!, asOfMs: null, limit: 100 });
  const [id, setId] = useState<string | null>(null);
  return <><div className="terminal-table-toolbar"><label><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} /> All assets</label><span>{all ? 'Profile decisions' : `${productId} decisions`} · persisted evidence</span><a href="#/activity">Operations →</a></div>
    <ChannelNotice state={state} label="Decisions" />{state.kind === 'ready' && <Table label="Decisions" headers={['Time', 'Event', 'Status', 'Assets', 'Reason / evidence']} empty={state.value.items.length === 0}>
      {state.value.items.map((d) => <tr key={d.id}><td>{formatLocalTimestamp(d.occurredAtMs)}</td><td><button type="button" onClick={() => setId(id === d.decisionId ? null : d.decisionId)}>{d.kind.replaceAll('_', ' ')}</button></td><td>{d.status}</td><td>{d.globalScope ? 'Global' : d.assetScopes.join(', ')}</td><td>{d.reasonCode?.replaceAll('_', ' ') ?? '—'} <small title={d.decisionId}>{d.decisionId.slice(0, 12)}…</small></td></tr>)}
    </Table>}{id !== null && <DecisionRecord key={id} client={client} id={id} />}</>;
}

function DecisionRecord({ client, id }: { readonly client: CoquiClient; readonly id: string }): React.JSX.Element {
  const state = useChannel(client, 'decision.detail', { decisionId: id });
  return <div className="terminal-record-detail"><ChannelNotice state={state} label="Decision detail" />{state.kind === 'ready' && <>
    <strong>{state.value.decision.strategy.id} · {state.value.decision.strategy.version}</strong><p>Targets: {state.value.decision.targets.map((t) => `${t.assetId} ${(t.weight * 100).toFixed(2)}%`).join(' · ') || 'None recorded'} · Cash {state.value.decision.cashWeight === null ? 'Unavailable' : `${(state.value.decision.cashWeight * 100).toFixed(2)}%`}</p><small>Market {state.value.decision.market.freshness} · History {state.value.decision.historyStatus} · {state.value.decisionHash}</small>
  </>}</div>;
}

export function TerminalResearch({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const runs = useChannel(client, 'research.runs', {});
  const scores = useChannel(client, 'research.scoreboard', {});
  return <><div className="terminal-table-toolbar"><span>Registered studies · after-cost evidence</span><a href="#/research">Full research & lineage →</a></div><ChannelNotice state={runs} label="Research runs" />
    {runs.kind === 'ready' && <Table label="Research runs" headers={['Run', 'Completed', 'Adoption', 'Dataset', 'Evidence']} empty={runs.value.length === 0}>
      {runs.value.map((r) => <tr key={r.runHash}><th>{r.id}</th><td>{formatLocalTimestamp(r.completedAtMs)}</td><td>{r.adopted ? 'Adopted' : 'Not adopted'}</td><td title={r.datasetHash}>{r.datasetHash.slice(0, 12)}…</td><td title={r.runHash}>{r.runHash.slice(0, 12)}…</td></tr>)}
    </Table>}<ChannelNotice state={scores} label="Strategy comparison" />{scores.kind === 'ready' && <Table label="Strategy comparison" headers={['Track', 'After-cost return', 'Max drawdown', 'Sortino', 'Trials']} empty={scores.value.tracks.length === 0}>
      {scores.value.tracks.map((track) => <tr key={track.trackId}><th>{track.trackId}</th><td>{track.afterCostReturnPct === null ? 'Unavailable' : `${track.afterCostReturnPct.toFixed(2)}%`}</td><td>{track.maxDrawdownPct === null ? 'Unavailable' : `${track.maxDrawdownPct.toFixed(2)}%`}</td><td>{track.sortino?.toFixed(2) ?? 'Unavailable'}</td><td>{track.trialCount ?? 'Unavailable'}</td></tr>)}
    </Table>}</>;
}
