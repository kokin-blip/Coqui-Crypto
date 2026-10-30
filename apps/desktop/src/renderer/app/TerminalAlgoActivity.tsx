import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ChannelRequest, ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel, type ChannelState } from '../query/use-channel.js';
import { ActivityPnlChart } from './ActivityPnlChart.js';
import { BrokerAccountPerformance } from './BrokerAccountPerformance.js';
import { ChannelNotice, TerminalMetric } from './TerminalPrimitives.js';
import { CoquiBadge, CoquiButton } from './CoquiComponents.js';
import type { TerminalActivityState } from './TerminalActivity.js';
import { exactUtcTimestamp, formatLocalTime, formatLocalTimestamp } from './time-format.js';

type Overview=ChannelResponse<'trading.activity.overview'>;
type Filter=ChannelRequest<'trading.activity.overview'>;
type Order=Overview['orders']['items'][number];
export type PnlMode='closed'|'total';
const money=(value:string|null):string=>value===null?'Unavailable':formatUsd(value)?.text??value;
const signed=(value:string|null):string=>value===null?'Unavailable':`${Number(value)>0?'+':''}${money(value)}`;
const tone=(value:string|null):string=>value===null?'terminal-secondary':Number(value)>0?'terminal-positive':Number(value)<0?'terminal-negative':'';
const dateLabel=(atMs:number)=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(atMs);
const periodLabel=(period:Filter['period'])=>period==='today'?'Today':period==='all'?'All history':period.toUpperCase();
const scopeLabel=(activity:TerminalActivityState,filter:Filter)=>`${activity.accountLabel(activity.connectionId)} · ${filter.productId??'All assets'} · ${periodLabel(filter.period)}`;

function OrderDetail({client,filter,order}:{readonly client:CoquiClient;readonly filter:Filter;readonly order:Order}):React.JSX.Element {
  const [cursor,setCursor]=useState<string|null>(null);
  const queries=useQueryClient();const signature=JSON.stringify(order);const previous=useRef(signature);
  useEffect(()=>{if(previous.current===signature)return;previous.current=signature;void queries.invalidateQueries({queryKey:['trading.activity.order-detail',{...filter,orderKey:order.key,cursor}]});},[signature,queries,filter,order.key,cursor]);
  const state=useChannel(client,'trading.activity.order-detail',{...filter,orderKey:order.key,cursor});
  return <div className="terminal-algo-order-detail"><ChannelNotice state={state} label="Order details"/>{state.kind==='ready'&&<>
    <dl><TerminalMetric label="In-window quantity">{state.value.order.quantity??'Unavailable'}</TerminalMetric>
      <TerminalMetric label="Average execution">{money(state.value.order.averagePriceUsd)}</TerminalMetric>
      <TerminalMetric label="Venue fees">{money(state.value.order.feeUsd)}{state.value.order.feeUsd===null?' · not recorded':''}</TerminalMetric>
      <TerminalMetric label="Recorded status">{state.value.order.status.replaceAll('_',' ')}</TerminalMetric>
      <TerminalMetric label="Lifetime execution">{state.value.lifetime.quantity??'Unavailable'} · {state.value.lifetime.fillCount} fills</TerminalMetric>
      <TerminalMetric label="Lifetime average">{money(state.value.lifetime.averagePriceUsd)}</TerminalMetric>
      <TerminalMetric label="Account">{order.accountId===null?'Combined simulation':`Paper account ••••${order.accountId.slice(-6)}`}</TerminalMetric>
      <TerminalMetric label="Recorded reason">{state.value.order.reason??'No linked reason recorded'}</TerminalMetric>
    </dl>
    <table className="terminal-algo-fills"><caption>Recorded fills · lifetime order</caption><thead><tr><th>Time</th><th>Qty / price</th><th>Net P/L</th></tr></thead><tbody>{state.value.fills.map(fill=><tr key={fill.id}>
      <td title={exactUtcTimestamp(fill.atMs)}>{formatLocalTime(fill.atMs)}{fill.timestampSource!=='recorded_fill'&&<small>Event time</small>}</td>
      <td>{fill.quantity??'Unavailable'}<small>{money(fill.priceUsd)}</small></td>
      <td className={tone(fill.realizedPnlUsd)}>{fill.side==='sell'?signed(fill.realizedPnlUsd):'—'}<small>Fee {money(fill.feeUsd)}</small></td>
    </tr>)}</tbody></table>
    <details><summary>Execution identifiers</summary>{state.value.fills.map(fill=><p key={fill.id}><small>Fill {fill.id}<br/>Order {fill.orderId??'Unavailable'}<br/>Decision {fill.decisionId??'Unavailable'}<br/>Instrument {fill.instrumentKey??fill.productId}</small></p>)}</details>
    <div className="terminal-algo-pagination">{cursor!==null&&<CoquiButton onClick={()=>setCursor(null)}>Latest fills</CoquiButton>}{state.value.nextCursor!==null&&<CoquiButton onClick={()=>setCursor(state.value.nextCursor)}>Older fills</CoquiButton>}</div>
    {!state.value.historyComplete&&<p className="terminal-state-note">History incomplete; lifetime totals may be partial.</p>}
  </>}</div>;
}

function AlgoOrders({client,filter,overview,onProductChange}:{readonly client:CoquiClient;readonly filter:Filter;readonly overview:Overview;readonly onProductChange:(id:string)=>void}):React.JSX.Element {
  const [cursor,setCursor]=useState<string|null>(null);
  const [expanded,setExpanded]=useState<ReadonlySet<string>>(()=>new Set());
  const older=useChannel(client,'trading.activity.orders',{...filter,cursor,limit:20},cursor!==null);
  const page=cursor===null?overview.orders:older.kind==='ready'?older.value:null;
  return <div className="terminal-algo-trades"><div className="terminal-algo-section-heading"><strong>Recent algorithm trades</strong><span>{periodLabel(filter.period)}</span></div>
    {cursor!==null&&<ChannelNotice state={older} label="Older trades"/>}
    {page!==null&&<>{page.items.length===0?<p className="terminal-empty">No recorded algorithm executions in this selection.</p>:<div role="list" aria-label="Recent algorithm trades">{page.items.map(order=>{
      const open=expanded.has(order.key);
      return <div role="listitem" key={order.key} className="terminal-algo-order" data-figma-node="3:72">
        <div className="terminal-algo-order-row">
          <button type="button" className="terminal-algo-asset" onClick={()=>onProductChange(order.productId)} aria-label={`Select ${order.productId} in chart`}><span>{order.productId}</span><small>{order.side===null?'Side unknown':order.side.toUpperCase()}{order.fillCount>1?` · ${order.fillCount} fills`:''}</small></button>
          <time dateTime={exactUtcTimestamp(order.atMs)} title={`${formatLocalTimestamp(order.atMs)}${order.timestampEstimated?' · event time; fill time unavailable':''}`}>{formatLocalTime(order.atMs)}<small>{order.timestampEstimated?'Event · ':''}{dateLabel(order.atMs)}</small></time>
          <span className={`terminal-algo-outcome ${order.side==='sell'?tone(order.realizedPnlUsd):''}`}>{order.side==='sell'?signed(order.realizedPnlUsd):order.status.replaceAll('_',' ')}</span>
          <CoquiButton aria-expanded={open} aria-label={`${open?'Hide':'Show'} ${order.productId} order details`} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(order.key))next.delete(order.key);else next.add(order.key);return next;})}>{open?<ChevronDown size={12}/>:<ChevronRight size={12}/>}</CoquiButton>
        </div>
        {open&&<OrderDetail key={order.key} client={client} filter={filter} order={order}/>}
      </div>;
    })}</div>}
    <div className="terminal-algo-pagination"><CoquiButton disabled={cursor===null} onClick={()=>setCursor(null)}>Latest trades</CoquiButton><CoquiButton disabled={page.nextCursor===null} onClick={()=>setCursor(page.nextCursor)}>Older trades</CoquiButton></div>
    </>}
  </div>;
}

export function AlgoActivity({client,activity,state,filter,onProductChange,mode,onMode}:{readonly client:CoquiClient;readonly activity:TerminalActivityState;
  readonly state:ChannelState<Overview>;readonly filter:Filter;readonly onProductChange:(id:string)=>void;readonly mode:PnlMode;readonly onMode:(mode:PnlMode)=>void}):React.JSX.Element {
  if(state.kind!=='ready')return <ChannelNotice state={state} label="Algorithm activity"/>;
  const value=state.value;const chart=mode==='closed'?value.closedChart:value.totalChart;
  return <div className="terminal-algo-activity">
    <div className="terminal-algo-context"><CoquiBadge>Paper</CoquiBadge><span title={`${value.scope.label} · ${scopeLabel(activity,filter)}`}>{value.scope.label} · {scopeLabel(activity,filter)}</span></div>
    <dl className="terminal-algo-metrics">
      <TerminalMetric label={`Realized net · ${periodLabel(filter.period)}`} info="Profit or loss on recorded sell executions in the selected source, assets and period, after recorded fees. Missing entry cost, fees or fill history makes the total unavailable. A known subtotal covers only executions with enough evidence." tone={tone(value.realizedPnlUsd)}>{signed(value.realizedPnlUsd)}</TerminalMetric>
      <TerminalMetric label="Open P/L · now" info="Unrealized profit or loss on the remaining recorded positions, using their cost basis, recorded fees and latest recorded prices. It is not cash received. Missing evidence makes the total unavailable; stale prices are labeled." tone={tone(value.unrealizedPnlUsd)}>{signed(value.unrealizedPnlUsd)}</TerminalMetric>
      <TerminalMetric label="Winning / losing exits" info="Recorded sell orders with known positive or negative net P/L in this selection. Multiple fills from one order count as one exit. Breakeven exits and exits with unknown P/L are excluded from these two counts.">{value.wins} / {value.losses}</TerminalMetric>
      <TerminalMetric label="Executed orders" info="Distinct orders with at least one recorded fill in the selected source, assets and period. This counts orders, not individual fills or proposed orders. Partial means the available history is incomplete.">{value.executedOrders}{!value.historyComplete?' · partial':''}</TerminalMetric>
    </dl>
    {value.scope.source==='alpaca_paper'&&filter.productId===null&&<BrokerAccountPerformance key={`${value.profileId}:${value.scope.id}:${value.connectionId}`}
      client={client} profileId={value.profileId} scopeId={value.scope.id} connectionId={value.connectionId}/>}
    {(value.realizedPnlUsd===null||value.unrealizedPnlUsd===null||value.unknownExits>0||value.breakeven>0||value.valuation!=='fresh')&&<p className="terminal-algo-caveat">
      {value.realizedPnlUsd===null&&<>Known realized subtotal {signed(value.knownRealizedPnlUsd)}. </>}
      {value.unrealizedPnlUsd===null&&<>Open valuation {value.valuation}{value.knownUnrealizedPnlUsd===null?'':` · known subtotal ${signed(value.knownUnrealizedPnlUsd)}`}. </>}
      {value.valuation==='stale'&&'Open P/L uses a stale recorded mark. '}
      {value.breakeven>0&&`${value.breakeven} breakeven exits. `}{value.unknownExits>0&&`${value.unknownExits} exits have unknown P/L. `}
      {!value.historyComplete&&'History incomplete. '}
    </p>}
    <div className="terminal-algo-chart-heading"><strong>{mode==='closed'?'Cumulative realized P/L':'Total P/L change'}</strong><div role="group" aria-label="P/L chart mode">{(['closed','total'] as const).map(item=><CoquiButton key={item} aria-pressed={mode===item} onClick={()=>onMode(item)}>{item==='closed'?'Closed':'Total'}</CoquiButton>)}</div></div>
    <ActivityPnlChart key={mode} data={chart} label={mode==='closed'?'Cumulative realized net profit and loss':'Change in recorded realized plus unrealized profit and loss'}/>
    {mode==='total'&&chart.startAtMs!==null&&<p className="terminal-algo-caveat">Since first valid valuation · {formatLocalTimestamp(chart.startAtMs)}. Gaps retain missing evidence.</p>}
    <AlgoOrders client={client} filter={filter} overview={value} onProductChange={onProductChange}/>
    <p className="terminal-algo-evidence">{state.isStale?'Refresh due · ':''}Execution evidence {value.evidenceAtMs===null?'unavailable':formatLocalTimestamp(value.evidenceAtMs)} · after recorded fees</p>
  </div>;
}

export function AlgoPerformanceStrip({activity,state,filter,onOpen}:{readonly activity:TerminalActivityState;readonly state:ChannelState<Overview>;readonly filter:Filter;readonly onOpen:()=>void}):React.JSX.Element {
  return <button type="button" className="terminal-algo-performance-strip" onClick={onOpen} aria-label="Open algorithm activity performance">
    <span>{state.kind==='ready'?state.value.scope.label:'Algorithm performance'} · {scopeLabel(activity,filter)}</span>
    <span>Realized <strong className={tone(state.kind==='ready'?state.value.realizedPnlUsd:null)}>{state.kind==='ready'?signed(state.value.realizedPnlUsd):'Unavailable'}</strong> · Open <strong className={tone(state.kind==='ready'?state.value.unrealizedPnlUsd:null)}>{state.kind==='ready'?signed(state.value.unrealizedPnlUsd):'Unavailable'}</strong></span>
    <small>Paper · {state.kind==='ready'?`Refreshed ${formatLocalTime(state.value.asOfMs)}${state.value.valuation==='stale'?' · stale mark':''}${!state.value.historyComplete?' · partial history':''}`:'Awaiting activity read'}</small>
  </button>;
}
