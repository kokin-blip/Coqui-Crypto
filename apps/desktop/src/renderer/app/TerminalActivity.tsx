import { useWalletNames } from './WalletNames.js';
import { useState } from 'react';
import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel, type ChannelState } from '../query/use-channel.js';
import { ChannelNotice, TerminalMetric } from './TerminalPrimitives.js';
import { CoinIcon } from './CoinIcon.js';
import { formatLocalTimestamp, exactUtcTimestamp } from './time-format.js';

export type ActivitySummary = ChannelResponse<'trading.activity.summary'>;
export type ActivityAnnotation = ActivitySummary['annotations'][number];
export type ActivityPosition = ActivitySummary['positions'][number];
const money = (value: string | null): string => value === null ? 'Unavailable' : formatUsd(value)?.text ?? value;
const signed = (value: string | null): string => value === null ? 'Unavailable' : `${Number(value) > 0 ? '+' : ''}${money(value)}`;
const tone = (value: string | null): string => value === null ? 'terminal-secondary' : Number(value) < 0 ? 'terminal-negative' : Number(value) > 0 ? 'terminal-positive' : '';
const at = (value: number | null): string => value === null ? 'Unavailable' : formatLocalTimestamp(value);

export function useTerminalActivity(client:CoquiClient,productId:string) {
  const names=useWalletNames(client);
  const scopes=useChannel(client,'trading.activity.scopes',{});
  const [selection,setSelection]=useState<string|null>(null);
  const [connectionId,setConnectionId]=useState<string|null>(null);
  const [shared,setShared]=useState(true);
  const scopeId=scopes.kind==='ready'?(scopes.value.scopes.find(s=>s.id===selection)?.id??scopes.value.scopes.find(s=>s.current)?.id??'ledger'):'ledger';
  const summary=useChannel(client,'trading.activity.summary',{scopeId,connectionId,productId},scopes.kind==='ready');
  return {scopes,summary,names,scopeId,connectionId,shared,setSelection,setConnectionId,setShared};
}
export type TerminalActivityState = ReturnType<typeof useTerminalActivity>;
export function ActivityControls({activity}:{readonly activity:TerminalActivityState}):React.JSX.Element {
  return <div className="terminal-table-toolbar terminal-activity-controls">
    <label>Paper source<select aria-label="Paper activity source" value={activity.scopeId} onChange={e=>activity.setSelection(e.target.value)} disabled={activity.scopes.kind!=='ready'}>{activity.scopes.kind==='ready'?activity.scopes.value.scopes.map(s=><option value={s.id} key={s.id}>{s.label}</option>):<option value="ledger">Loading sources…</option>}</select></label>
    <label>Wallet<select aria-label="Wallet activity filter" value={activity.connectionId??''} onChange={e=>activity.setConnectionId(e.target.value||null)}><option value="">All wallets / combined simulation</option>{activity.scopes.kind==='ready'&&activity.scopes.value.wallets.map(w=><option key={w.id} value={w.id}>{activity.names.wallets.kind==='ready'&&activity.names.wallets.value.wallets.some(n=>n.connectionId===w.id)?activity.names.accountLabel(w.id):w.label}</option>)}</select></label>
    <label><input type="checkbox" checked={activity.shared} onChange={e=>activity.setShared(e.target.checked)}/> Shared evaluations</label>
  </div>;
}
export function CurrentlyWatching({state}:{readonly state:ChannelState<ActivitySummary>}):React.JSX.Element {
  const w=state.kind==='ready'?state.value.watching:null;
  return <><ChannelNotice state={state} label="Currently watching"/>{state.kind==='ready'&&(w===null?<p className="terminal-empty">No recorded evaluation for this source and security.</p>:<dl>
    <TerminalMetric label="Strategy">{w.strategy}</TerminalMetric><TerminalMetric label="Evaluated">{at(w.atMs)}</TerminalMetric>
    <TerminalMetric label="Recorded intent">{w.intent}{w.shared?' · Shared context':''}</TerminalMetric>
    <TerminalMetric label="Reason">{w.reason?.replaceAll('_',' ')??'Unavailable'}</TerminalMetric>
    <TerminalMetric label="Target allocation">{w.targetWeightPct===null?'Unavailable':`${w.targetWeightPct}%`}</TerminalMetric>
    <TerminalMetric label="Recorded risk">{w.risk}</TerminalMetric>{w.signals.map(s=><TerminalMetric label={s.label} key={s.label}>{s.value}</TerminalMetric>)}
  </dl>)}<p className="terminal-footnote">No fixed profit-percentage exit target. The strategy acts on recorded allocation and rebalance conditions.</p></>;
}
export function SharedEvaluations({client,productId,enabled}:{readonly client:CoquiClient;readonly productId:string;readonly enabled:boolean}):React.JSX.Element|null {
  const state=useChannel(client,'trading.activity.shared',{productId,limit:32},enabled);
  if(!enabled)return null;
  return <details className="terminal-shared-evaluations"><summary>Shared evaluations · context only</summary><ChannelNotice state={state} label="Shared evaluations"/>{state.kind==='ready'&&<>
    {state.value.items.length===0&&<p>No shared evaluation recorded for {productId}.</p>}
    {state.value.items.map(i=><p key={i.profileId}><strong>Shared · {i.profileName}</strong> · {at(i.watching.atMs)} · {i.watching.strategy} · {i.watching.intent}{i.watching.targetWeightPct===null?'':` · Target ${i.watching.targetWeightPct}%`}</p>)}
    {state.value.unavailableProfiles.length>0&&<p>{state.value.unavailableProfiles.length} profile context unavailable.</p>}
    <p>Each profile retains its own balances and execution. These evaluations do not establish this wallet’s intent.</p>
  </>}</details>;
}
export function ActivityPositions({client,activity,productId,onProductChange}:{readonly client:CoquiClient;readonly activity:TerminalActivityState;readonly productId:string;readonly onProductChange:(id:string)=>void}):React.JSX.Element {
  const state=activity.summary;const [detailOpen,setDetailOpen]=useState(true);
  return <><ChannelNotice state={state} label="Paper activity"/>{state.kind==='ready'&&<>
    <p className="terminal-state-note">{state.value.scope.label} · {state.value.scope.combined?'Combined simulation; no individual wallet fill attribution':'Separate paper account'} · {activity.connectionId===null?'All attributed activity': 'Selected wallet activity only'}{!state.value.historyComplete?' · History incomplete':''}</p>
    <div className="terminal-table-scroll"><table className="terminal-data-table terminal-position-table"><caption className="sr-only">Paper positions with entry, valuation and realized/unrealized profit</caption><thead><tr>{['Security','Scope','Quantity','Entry recorded','Avg entry','Mark','Unrealized USD / %','Realized USD','Valuation','Status'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>
      {state.value.positions.length===0&&<tr><td colSpan={10} className="terminal-empty">No paper positions or recorded fills attributed to this selection.</td></tr>}
      {state.value.positions.map(p=><tr key={p.productId} aria-selected={p.productId===productId}><th scope="row"><button type="button" className="terminal-asset" onClick={()=>{onProductChange(p.productId);setDetailOpen(true);}}><CoinIcon symbol={p.productId.split('-')[0]!}/>{p.productId}</button></th><td>{state.value.scope.source.replaceAll('_',' ')}</td><td>{p.quantity}</td><td>{at(p.entryAtMs)}</td><td>{money(p.averageEntryUsd)}</td><td title={`${p.markSource??'No mark source'} · ${at(p.markAtMs)}`}>{money(p.markUsd)}</td><td className={tone(p.unrealizedPnlUsd)}>{signed(p.unrealizedPnlUsd)}{p.unrealizedPnlPct===null?'':` / ${Number(p.unrealizedPnlPct).toFixed(2)}%`}{!p.basisComplete&&<small>Known-basis subtotal {signed(p.knownUnrealizedPnlUsd)}</small>}</td><td className={tone(p.realizedPnlUsd)}>{signed(p.realizedPnlUsd)}{!p.realizedComplete&&<small>Known subtotal {signed(p.knownRealizedPnlUsd)}</small>}</td><td>{p.valuation}{!p.basisComplete&&<small>Entry basis incomplete</small>}</td><td>{p.status}</td></tr>)}
    </tbody></table></div>
    <button type="button" className="terminal-detail-toggle" aria-expanded={detailOpen} onClick={()=>setDetailOpen(v=>!v)}>{detailOpen?'Hide':'Show'} {productId} execution trail</button>
    {detailOpen&&<ExecutionTrail key={`${activity.scopeId}:${activity.connectionId}:${productId}`} client={client} activity={activity} productId={productId}/>}
  </>}</>;
}
export function ExecutionTrail({client,activity,productId}:{readonly client:CoquiClient;readonly activity:TerminalActivityState;readonly productId:string}):React.JSX.Element {
  const [cursor,setCursor]=useState<string|null>(null);
  const state=useChannel(client,'trading.activity.trail',{scopeId:activity.scopeId,connectionId:activity.connectionId,productId,cursor,limit:30});
    return <div className="terminal-record-detail terminal-execution-trail"><strong>{productId} · Order and execution trail</strong><p>Proposed actions, paper approvals, order states, and recorded fills are separate evidence.</p><ChannelNotice state={state} label="Execution trail"/>
    {state.kind==='ready'&&<><div className="terminal-table-scroll"><table className="terminal-data-table"><caption className="sr-only">{productId} execution evidence</caption><thead><tr>{['Recorded time','Stage / status','Side','Quantity','Price','Venue fee','Realized P&L','Evidence / costs'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>
      {state.value.items.length===0&&<tr><td colSpan={8}>No execution details recorded for this selection.</td></tr>}
      {state.value.items.map(e=>{const profit=e.realizedPnlUsd;return <tr key={e.id}><td><time dateTime={exactUtcTimestamp(e.atMs)} title={exactUtcTimestamp(e.atMs)}>{at(e.atMs)}</time>{e.timestampSource==='recorded_event_fill_time_unavailable'&&<small>Event time · exact fill time unavailable</small>}</td><td>{e.kind==='review'?'Paper review':e.kind} · {e.status.replaceAll('_',' ')}</td><td>{e.side??'Unknown'}</td><td>{e.quantity??'Unavailable'}{e.kind==='proposal'&&e.amountUsd!==null&&<small>Intent {money(e.amountUsd)}</small>}</td><td>{money(e.priceUsd)}{e.kind==='proposal'&&e.priceUsd!==null&&<small>Reference price</small>}</td><td>{money(e.feeUsd)}{e.feeUsd!==null&&<small>{activity.summary.kind==='ready'&&activity.summary.value.scope.source==='alpaca_paper'?'Reported':'Modeled'}</small>}</td><td className={tone(profit)}>{e.kind==='fill'&&e.side==='sell'?signed(profit):'—'}</td><td><details><summary>{e.reason?.replaceAll('_',' ')??'Recorded evidence'}</summary><small>Profile {e.profileId} · Source {e.source.replaceAll('_',' ')}<br/>Campaign {e.campaignId??'None'} · Account {e.accountId??'Unattributed'}<br/>Instrument {e.instrumentKey??'Unavailable'}<br/>Order {e.orderId??'Unavailable'}<br/>Proposal {e.proposalId??'Unavailable'}<br/>Decision {e.decisionId??'Unavailable'}<br/>Spread {money(e.spreadUsd)} · Slippage {money(e.slippageUsd)} · Impact {money(e.impactUsd)}<br/>Modeled friction is included in execution price.</small></details></td></tr>;})}
    </tbody></table></div><div className="terminal-trail-pagination"><button type="button" disabled={cursor===null} onClick={()=>setCursor(null)}>Latest activity</button><button type="button" disabled={state.value.nextCursor===null} onClick={()=>setCursor(state.value.nextCursor)}>Older activity</button>{!state.value.historyComplete&&<span>History incomplete; profit totals unavailable</span>}</div></>}
  </div>;
}

export function ActivityDecisions({activity,productId}:{readonly activity:TerminalActivityState;readonly productId:string}):React.JSX.Element {
  const state=activity.summary;const detail=state.kind==='ready'?state.value.decision:null;
  return <><div className="terminal-table-toolbar"><span>{productId} decisions · selected paper source / wallet</span><a href="#/activity">Full profile timeline →</a></div><CurrentlyWatching state={state}/>{detail!==null&&<div className="terminal-table-scroll"><table className="terminal-data-table"><caption className="sr-only">Recorded decision evidence</caption><thead><tr><th>Time</th><th>Event</th><th>Recorded details</th></tr></thead><tbody>{detail.events.map(e=><tr key={e.event.sequence}><td>{at(e.event.atMs)}</td><td>{e.event.kind.replaceAll('_',' ')}</td><td><details><summary>Evidence</summary><pre>{JSON.stringify(e.event.detail,null,2)}</pre></details></td></tr>)}</tbody></table></div>}</>;
}
