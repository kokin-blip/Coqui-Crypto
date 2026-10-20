import { useState } from 'react';
import type { ChannelRequest, ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { ActivityControls, type TerminalActivityState } from './TerminalActivity.js';
import { AlgoActivity, AlgoPerformanceStrip, type PnlMode } from './TerminalAlgoActivity.js';
import { CoquiSelect } from './CoquiComponents.js';
import type { ChannelState } from '../query/use-channel.js';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice, TerminalTabs } from './TerminalPrimitives.js';
import { formatLocalTime } from './time-format.js';

type Book = ChannelResponse<'market-data.order-book'>;
const TABS = ['Algo Activity', 'Order Book'] as const;

function BookRows({ levels, side, peak }: { readonly levels: Book['bids']; readonly side: 'bid' | 'ask'; readonly peak: number }): React.JSX.Element {
  return <>{levels.map((level) => <tr data-figma-node="3:74" key={level.price} className={`book-${side}`} style={{
    backgroundImage: `linear-gradient(to left, var(--coqui-${side === 'bid' ? 'positive' : 'negative'}-soft) ${Math.min(100, Number(level.total) / peak * 100)}%, transparent 0)`,
  }}><td>{formatUsd(level.price)?.text ?? level.price}</td><td>{level.size}</td><td>{level.total}</td></tr>)}</>;
}


export function TerminalOrderBook({ client, productId, book, aggregation, onAggregation, onProductChange,activity,overview,overviewFilter,onPeriod,selectedMarketOnly,onSelectedMarketOnly }: {
  readonly activity:TerminalActivityState; readonly overview:ChannelState<ChannelResponse<'trading.activity.overview'>>;
  readonly overviewFilter:ChannelRequest<'trading.activity.overview'>;readonly onPeriod:(period:ChannelRequest<'trading.activity.overview'>['period'])=>void;
  readonly selectedMarketOnly:boolean;readonly onSelectedMarketOnly:(value:boolean)=>void;
  readonly client: CoquiClient; readonly productId: string; readonly book: ReturnType<typeof useChannel<'market-data.order-book'>>;
  readonly onProductChange: (productId: string) => void; readonly aggregation: string; readonly onAggregation: (value: string) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<typeof TABS[number]>('Algo Activity');
  const [pnlMode,setPnlMode]=useState<PnlMode>('closed');
  const catalog = useChannel(client, 'market-data.products', { query: '', limit: 500 });
  const products = [...new Set([productId, ...(catalog.kind === 'ready' ? catalog.value.products.map((p) => p.instrument.productId) : [])])];
  const quote = useChannel(client, 'market-data.live', {});
  const current = quote.kind === 'ready' ? quote.value.quotes.find((item) => item.instrument.productId === productId) : undefined;
  const ready = book.kind === 'ready' ? book.value : null;
  const peak = Math.max(Number(ready?.bids.at(-1)?.total ?? 0), Number(ready?.asks.at(-1)?.total ?? 0), 0.000001);
  return <section className="terminal-panel terminal-microstructure" data-figma-node="3:64">
    <TerminalTabs tabs={TABS} value={tab} onChange={setTab} label="Algorithm activity and market depth" id="microstructure" />
    <ActivityControls activity={activity} compact />
    <div className="terminal-algo-filters">
      <label><span className="sr-only">Activity assets</span><CoquiSelect aria-label="Activity assets" value={selectedMarketOnly?'market':'all'} onChange={event=>onSelectedMarketOnly(event.target.value==='market')}><option value="all">All assets</option><option value="market">{productId} only</option></CoquiSelect></label>
      <label><span className="sr-only">Activity period</span><CoquiSelect aria-label="Activity period" value={overviewFilter.period} onChange={event=>onPeriod(event.target.value as typeof overviewFilter.period)}>{[['today','Today'],['7d','7D'],['30d','30D'],['all','All']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</CoquiSelect></label>
    </div>
    {tab==='Order Book'&&<div className="terminal-book-controls"><label><span className="sr-only">Market</span><select aria-label="Order book market" value={productId} onChange={(event) => onProductChange(event.target.value)}>{products.map((id) => <option key={id}>{id}</option>)}</select></label><label><span className="sr-only">Price aggregation</span><select aria-label="Price aggregation" value={aggregation} onChange={(event) => onAggregation(event.target.value)}>
      {['0.0001', '0.001', '0.01', '0.1', '1', '10', '100'].map((step) => <option key={step}>{step}</option>)}</select></label>
      <span className={ready?.connection === 'live' ? 'terminal-positive' : 'terminal-warning'}>● {ready?.connection ?? 'Unknown'}</span></div>}
    <div id="microstructure-panel" role="tabpanel" aria-labelledby={`microstructure-tab-${TABS.indexOf(tab)}`} className="terminal-book-scroll">
      {tab === 'Algo Activity' ? <AlgoActivity mode={pnlMode} onMode={setPnlMode} key={JSON.stringify(overviewFilter)} client={client} activity={activity} state={overview} filter={overviewFilter} onProductChange={onProductChange} /> : <>
        <ChannelNotice state={book} label="Order book" />
        {ready !== null && <>{ready.state !== 'ready' && <p className="terminal-state-note">{ready.state === 'stale' ? 'Stale snapshot · last observed values' : 'Awaiting Level 2 snapshot'}</p>}
          {ready.bids.length + ready.asks.length === 0 ? <div className="terminal-empty">No depth available for {productId}.</div> : <table className="terminal-book-table"><thead><tr data-figma-node="3:70"><th>Price (USD)</th><th>Amount ({productId.split('-')[0]})</th><th>Total</th></tr></thead><tbody>
            <BookRows levels={[...ready.asks].reverse()} side="ask" peak={peak} />
            <tr className="terminal-midpoint"><td colSpan={3}><strong>{current === undefined ? 'Last price unavailable' : formatUsd(current.priceUsd)?.text}</strong><span>Last trade · {quote.kind === 'ready' ? quote.value.connection : 'unknown'}</span></td></tr>
            <BookRows levels={ready.bids} side="bid" peak={peak} />
          </tbody></table>}
        </>}
      </>}
    </div>
    {tab==='Order Book'&&<AlgoPerformanceStrip activity={activity} state={overview} filter={overviewFilter} onOpen={()=>setTab('Algo Activity')}/>}
    {tab==='Order Book'?<footer>Coinbase · {ready?.observedAtMs === null || ready?.observedAtMs === undefined ? 'Not observed' : formatLocalTime(ready.observedAtMs)} · display only</footer>:<footer>Paper activity · {overview.kind==='ready'?`Refreshed ${formatLocalTime(overview.value.asOfMs)}`:'Awaiting activity read'}</footer>}
  </section>;
}
