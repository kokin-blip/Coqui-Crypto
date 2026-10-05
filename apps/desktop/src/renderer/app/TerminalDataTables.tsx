import { useWalletNames, walletLabel } from './WalletNames.js';
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

export function TerminalAssets({ client, onProductChange, connectionId = null }: { readonly client: CoquiClient; readonly onProductChange: (productId: string) => void; readonly connectionId?: string | null }): React.JSX.Element {
  const state = useChannel(client, 'portfolio.current', {});
  const [account, setAccount] = useState('all');
  const names = useWalletNames(client);
  const exposures = state.kind === 'ready' ? state.value?.exposures ?? [] : [];
  const rows = exposures.flatMap(asset => connectionId === null ? [asset] : asset.contributions.filter(c=>c.connectionId===connectionId).map(c=>({...asset,exposureKey:asset.exposureKey,quantity:c.quantity,valueUsd:c.valueUsd,contributions:[c],rowId:`${asset.exposureKey}:${c.accountRefId}`}))).filter((item) => account === 'all' || item.contributions.some((c) => c.provider === account || names.wallets.kind === 'ready' && names.wallets.value.wallets.some(w=>w.id===account&&w.connectionId===c.connectionId&&w.accountRefIds.includes(c.accountRefId))));
  return <><div className="terminal-table-toolbar"><label>Includes account<select value={account} onChange={(event) => setAccount(event.target.value)}><option value="all">All accounts</option><option value="coinbase">Coinbase</option><option value="robinhood_crypto">Robinhood Crypto</option>{names.wallets.kind === 'ready' && names.wallets.value.wallets.filter(w=>!w.removed).map(w=><option key={w.id} value={w.id}>{walletLabel(w)}</option>)}</select></label><span>{connectionId===null?'Combined connected balances':'Selected wallet balances'} · read-only</span><a href="#/portfolio/holdings">Cost basis & details →</a></div>
    <ChannelNotice state={state} label="Assets" />
    {state.kind === 'ready' && <>{state.value !== null && !state.value.complete && <p className="terminal-state-note">Valuation incomplete · unpriced assets remain visible</p>}
      <Table label="Connected assets" headers={['Asset', 'Quantity', 'Value (USD)', 'Accounts', 'Valuation']} empty={rows.length === 0}>
        {rows.map((asset) => <tr key={'rowId' in asset ? String(asset.rowId) : asset.exposureKey}><th scope="row"><button type="button" className="terminal-asset" disabled={asset.exposureKey === 'USD'} onClick={() => onProductChange(`${asset.exposureKey}-USD`)}><CoinIcon symbol={asset.exposureKey} /><strong>{asset.exposureKey}</strong></button></th><td>{asset.quantity}</td><td>{money(asset.valueUsd)}</td><td>{[...new Set(asset.contributions.map((c) => names.accountLabel(c.connectionId,c.accountRefId,c.provider)))].join(', ')}</td><td>{asset.valueUsd === null ? 'Unpriced' : 'Priced'}</td></tr>)}
      </Table></>}
  </>;
}

export function TerminalProposals({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const state = useChannel(client, 'paper.execution.proposals', { limit: 100 });
  const [filter, setFilter] = useState('all');
  const rows = state.kind === 'ready' ? state.value.proposals.filter((p) => filter === 'all' || p.status === filter) : [];
  return <><div className="terminal-table-toolbar"><label>Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['all', 'pending_review', 'executing', 'blocked', 'succeeded', 'unknown', 'failed', 'rejected', 'approved'].map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label><span>All active-profile proposals · system-generated · paper only</span><a href="#/paper/overview">Paper controls →</a></div>
    <ChannelNotice state={state} label="Proposals" />{state.kind === 'ready' && <Table label="Paper proposals" headers={['Created', 'Rebalance actions', 'Status', 'Revision / evidence', 'Review']} empty={rows.length === 0}>
      {rows.map((p) => <tr key={p.id}><td>{formatLocalTimestamp(p.createdAt)}</td><td>{p.actions.length === 0 ? 'No actions' : p.actions.map((a) => `${a.side.toUpperCase()} ${a.productId} · ${money(a.amountUsd)}`).join(' / ')}</td><td className={p.status === 'blocked' || p.status === 'unknown' ? 'terminal-warning' : ''}>{p.status.replaceAll('_', ' ')}{p.reasonCode !== null && <small>{p.reasonCode.replaceAll('_', ' ')}</small>}{p.status === 'unknown' && <small>Reconcile before retrying</small>}</td><td title={p.proposalHash}>r{p.revision} · {p.proposalHash.slice(0, 12)}…</td><td>{p.status === 'pending_review' ? <PaperProposalReview client={client} proposal={p} /> : <a href="#/paper/orders">Details →</a>}</td></tr>)}
    </Table>}</>;
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
