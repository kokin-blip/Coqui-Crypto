import { useId, useState } from 'react';
import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { CapitalMetricValue } from './CapitalPerformance.js';
import { MetricInfo } from './MetricInfo.js';
import { formatLocalTimestamp } from './time-format.js';
type Detail=ChannelResponse<'research.capital-replay.detail'>;
const usd=(value:string|null)=>value===null?'Unavailable':formatUsd(value)?.text??value;
function Metric({cell,name,unit='usd'}:{readonly cell:Detail['cells'][number];readonly name:string;readonly unit?:'usd'|'percent'|'ratio'}){
 const value=cell.metrics[name];return value?<CapitalMetricValue value={value} label={name.replaceAll(/([A-Z])/gu,' $1')} unit={unit}/>:<>Unavailable</>;
}
export function CapitalReplayResults({client}:{readonly client:CoquiClient}):React.JSX.Element{
 const catalog=useChannel(client,'research.capital-replay.runs',{limit:100}),id=useId();
 const [runId,setRunId]=useState(''),[cellId,setCellId]=useState<string|null>(null),[page,setPage]=useState(0);
 const run=catalog.kind==='ready'?(catalog.value.runs.find(r=>r.id===runId)??catalog.value.runs[0]):undefined;
 const result=useChannel(client,'research.capital-replay.detail',{runId:run?.id??'0'.repeat(64),cellId,page,limit:50},run!==undefined);
 return <section className="panel capital-replay" aria-labelledby={`${id}-heading`}>
  <h2 id={`${id}-heading`}>Capital-aware replays</h2>
  <p className="metric-note">Offline development evidence · simulated fills and receipts · pre-personal-tax results. Recorded completion does not qualify a strategy or grant trading authority.</p>
  {catalog.kind!=='ready'?<ChannelNotice state={catalog} label="Offline replays"/>:catalog.value.runs.length===0?<p>No offline replay is recorded in this profile. Run the replay in a separate empty research profile, then open that profile to inspect its results. Existing trading and reserve settings are unchanged.</p>:<>
   <label htmlFor={`${id}-run`}>Recorded run<select id={`${id}-run`} value={run?.id??''} onChange={e=>{setRunId(e.target.value);setCellId(null);setPage(0);}}>
    {catalog.value.runs.map(r=><option key={r.id} value={r.id}>{r.id.slice(0,12)} · {r.exposure.replaceAll('_',' ')} · {r.status} · {r.archived?'archived origin':formatLocalTimestamp(r.recordedAtMs)}</option>)}
   </select></label>
   {result.kind!=='ready'?<ChannelNotice state={result} label="Replay result"/>:<ReplayDetail data={result.value} page={page} onPage={setPage} onCell={value=>{setCellId(value);setPage(0);}}/>}
  </>}
 </section>;
}
export function ReplayDetail({data,page,onPage,onCell}:{readonly data:Detail;readonly page:number;readonly onPage:(page:number)=>void;readonly onCell:(id:string)=>void}):React.JSX.Element{
 const id=useId(),selected=data.selected;
 return <>
  <p><strong>{data.run.archived?'Archived origin · ':''}{data.run.status.replaceAll('_',' ')}</strong> · {data.run.cellCount} declared cells · recorded {formatLocalTimestamp(data.run.recordedAtMs)}. Account environment: offline USD simulation.</p>
  {data.run.reason&&<p role="status">{data.run.reason.replaceAll('_',' ')}. The attempt remains recorded; inspect the offline inputs before an explicit retry.</p>}
  <p className="metric-note">Period {formatLocalTimestamp(data.assumptions.fromMs)} to {formatLocalTimestamp(data.assumptions.toMs)} · {data.assumptions.availabilityBasis.replaceAll('_',' ')} · declared publication delay {data.assumptions.publicationDelayMs} ms.</p>
  <p className="metric-note">Each balance has its own book. The nine capital rows share one market path and are not independent evidence of an edge. Blocked orders are distinct from deliberate cash decisions.</p>
  <div className="capital-replay-table" role="region" tabIndex={0} aria-label="Recorded replay cells; scroll for all columns">
   <table><caption>All recorded cells · no per-balance winner selection</caption><thead><tr><th>Evidence</th><th>Opening USD</th><th>Arm</th><th>State</th><th>Total equity</th><th>Active equity</th><th>Reserve</th><th>Economic P&amp;L</th><th>Total TWR</th><th>Fees</th><th>Blocked intentions</th></tr></thead>
    <tbody>{data.cells.map(c=><tr key={c.id}><td><button type="button" aria-label={`Inspect ${c.cell.arm} at ${c.cell.capitalUsd} USD, ${c.cell.variantId}`} onClick={()=>onCell(c.cell.id)}>Inspect</button></td><td>{usd(c.cell.capitalUsd)}</td><td>{c.cell.arm}</td><td>{c.state}</td><td>{usd(c.summary.endingEquityUsd)}</td><td>{usd(c.summary.activeUsd)}</td><td>{usd(c.summary.reservedUsd)}</td><td><Metric cell={c} name="economicPnlUsd"/></td><td><Metric cell={c} name="timeWeightedReturnPct" unit="percent"/></td><td><Metric cell={c} name="feesUsd"/></td><td>{c.summary.blockedOrders}/{c.summary.requestedOrders}</td></tr>)}</tbody>
   </table>
  </div>
  {!data.cells.length&&<p>No complete result has been published. Missing or interrupted chunks are not a zero return.</p>}
  {selected&&<div className="capital-replay-selection" aria-live="polite">
   <h3>Selected cell · {selected.cell.arm} · {usd(selected.cell.capitalUsd)}</h3>
   <p>{selected.cell.variantId} · {selected.state} · {selected.reasonCodes.length?selected.reasonCodes.join(', ').replaceAll('_',' '):'All declared mechanics completed; no research qualification.'}</p>
   <dl className="metric-grid">
    <div><dt>Active-sleeve TWR<MetricInfo label="Active-sleeve TWR">Reserve movements are capital flows out of the active sleeve. They are internal to total managed equity. Invalid or missing return segments remain unavailable.</MetricInfo></dt><dd><Metric cell={selected} name="sleeveTimeWeightedReturnPct" unit="percent"/></dd></div>
    <div><dt>Annualized total TWR</dt><dd><Metric cell={selected} name="annualizedReturnPct" unit="percent"/></dd></div>
    <div><dt>Dated money-weighted return</dt><dd><Metric cell={selected} name="moneyWeightedReturnPct" unit="percent"/></dd></div>
    <div><dt>Maximum daily drawdown</dt><dd><Metric cell={selected} name="maxDrawdownPct" unit="percent"/></dd></div>
    <div><dt>Realized investment P&amp;L</dt><dd><Metric cell={selected} name="realizedPnlUsd"/></dd></div>
    <div><dt>Unrealized investment P&amp;L</dt><dd><Metric cell={selected} name="unrealizedPnlUsd"/></dd></div>
    <div><dt>External contributions</dt><dd><Metric cell={selected} name="contributionsUsd"/></dd></div>
    <div><dt>Net external outflows</dt><dd><Metric cell={selected} name="netOutflowsUsd"/></dd></div>
    <div><dt>Simulated net user receipts</dt><dd><Metric cell={selected} name="confirmedUserReceiptsUsd"/></dd></div>
    <div><dt>Tax hold · hypothetical</dt><dd>{usd(selected.summary.taxHoldUsd)}</dd></div>
    <div><dt>User-net dollar outcome<MetricInfo label="User-net dollar outcome">Total managed equity plus modeled net user receipts, less separately paid external expenses once. A pending payment is not another receipt. This is not CAGR or personal wealth.</MetricInfo></dt><dd>{usd(selected.summary.userNetOutcomeUsd)}</dd></div>
    <div><dt>External expenses</dt><dd>{usd(selected.summary.externalExpenseUsd)}</dd></div>
    <div><dt>One-way turnover</dt><dd>{usd(selected.summary.turnoverUsd)}</dd></div>
    <div><dt>Floor breaches after allocation</dt><dd>{selected.summary.floorBreaches}</dd></div>
   </dl>
   <details><summary>Path evidence and residuals</summary>
    <p>{data.traceCount} marks · {data.fillCount} modeled fills · {data.eventCount} journal events. Page {page+1} · up to 50 entries per series.</p>
    <ol>{data.traces.map(t=><li key={`${t.atMs}:${t.phase}`}>{formatLocalTimestamp(t.atMs)} · {t.phase} · cash {usd(t.cashUsd)} · spendable {usd(t.spendableUsd)} · reserve {usd(t.reservedUsd)} · pending receivable {usd(t.pendingUsd)}<br/>Desired quantities <code>{JSON.stringify(t.desired)}</code> · held <code>{JSON.stringify(t.positions)}</code><br/>{t.reasonCodes.join(', ').replaceAll('_',' ')}</li>)}</ol>
    <p>Fill IDs <code>{data.fills.map(f=>f.id).join(', ')||'none on this page'}</code></p>
    <ul>{data.events.map(e=><li key={e.id}>{e.kind.replaceAll('_',' ')} · {e.detail} · <code>{e.id}</code></li>)}</ul>
    <div className="capital-replay-actions"><button type="button" disabled={page===0} onClick={()=>onPage(page-1)}>Previous evidence page</button><button type="button" disabled={!data.hasMore} onClick={()=>onPage(page+1)}>Next evidence page</button></div>
   </details>
  </div>}
  <details><summary>Assumptions and immutable identities</summary>
   <p>Method capital-aware-replay-v1 · metrics capital-flow-performance-v1 · investment accounting capital-replay-fifo-investment-v1. Costs below are assumptions for these simulated books.</p>
   {data.assumptions.variants.map(v=><div key={v.id}><h4>{v.id}</h4><p>Venue {v.cost.venue} · {v.cost.role} · fee rate {v.cost.feeRate} ({v.cost.feeCurrency}; {v.cost.feeBasis}) · fixed USD {v.cost.fixedUsd} · multiplier {v.cost.multiplier} · spread/slippage/impact bps {v.cost.spreadBps}/{v.cost.slippageBps}/{v.cost.impactBps}.</p><p>Reserve share {v.reserve.shareBps/100}% of eligible profit · {v.reserve.trigger.kind} threshold {v.reserve.trigger.value} · cadence {v.reserve.cadence==='monthly'?'every 30 days':v.reserve.cadence} · retained preference {usd(v.reserve.retainedCapitalUsd)} · {v.flows.length} declared flows.</p><p>Daily active/reserve yield {v.activeDailyYield}/{v.reserveDailyYield}. Missing account terms are not inferred. Tax-hold inputs do not estimate liability.</p></div>)}
   <dl><dt>Spec</dt><dd><code>{data.run.specHash}</code></dd><dt>Market / decisions</dt><dd><code>{data.run.marketTapeHash}<br/>{data.run.decisionTapeHash}</code></dd><dt>Code / dependencies / lockfile</dt><dd><code>{data.run.codeRevision}<br/>{data.run.sourceManifestHash}<br/>{data.run.lockfileHash}</code></dd><dt>Origin profile / workspace / path</dt><dd><code>{data.assumptions.originProfileId} / {data.assumptions.workspaceId} / {data.assumptions.pathId}</code></dd></dl>
   <ul>{data.limitations.map(text=><li key={text}>{text}</li>)}</ul>
  </details>
  <p className="metric-note" id={`${id}-scope`}>A reserved dollar remains part of managed equity. A sale is not a payout. No live orders, withdrawals, scheduling or study registration are available here.</p>
 </>;
}
