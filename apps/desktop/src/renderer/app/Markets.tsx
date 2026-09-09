import { useEffect, useMemo, useState } from 'react';
import { Activity, Clock3, Radio, ShieldCheck } from 'lucide-react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd, freshnessBadge, provenanceBadge } from '@coqui/ui-kit';

import { ChartRangeControl, rangeLookbackDays } from './ChartRangeControl.js';
import { AdvisorSheet } from './AdvisorSheet.js';
import { ChartViewControl } from './ChartViewControl.js';
import { MarketHistoryChart } from './MarketHistoryChart.js';
import { eventMatchesProduct, MarketEventsPanel } from './MarketEventsPanel.js';
import { useChannel, type ChannelState } from '../query/use-channel.js';
import { useWorkspace } from './WorkspaceContext.js';
import { AdvancedMarkets } from './AdvancedMarkets.js';
import { decisionTimelineMarkers } from './decision-timeline-markers.js';
import { takeAdvisorSelection } from './advisor-navigation.js';
import { completedBarQuality } from './evidence-visualization.js';

type LiveView = ChannelResponse<'market-data.live'>;
type LiveQuote = LiveView['quotes'][number];

function sourceState(connection: LiveView['connection']): string {
  switch (connection) {
    case 'live': return 'Live';
    case 'stale': return 'Stale';
    case 'connecting': return 'Connecting';
    case 'reconnecting': return 'Reconnecting';
    case 'offline': return 'Offline';
  }
}

function QuoteValue({ value }: { readonly value: string | null }): React.JSX.Element {
  return <>{value === null ? '—' : (formatUsd(value)?.text ?? value)}</>;
}

function MarketDetail({ client, productId, quote, eventTimeline }: {
  readonly client: CoquiClient;
  readonly productId: string;
  readonly quote: LiveQuote | undefined;
  readonly eventTimeline: ChannelState<ChannelResponse<'market-events.timeline'>>;
}): React.JSX.Element {
  const workspace = useWorkspace();
  const range = workspace.preferences?.chartRanges.markets ?? '1y';
  const chartMode = workspace.preferences?.marketsChart ?? 'candles';
  const indicators = workspace.preferences?.marketIndicators;
  const candles = useChannel(client, 'market-data.candles', {
    instrument: { venue: 'coinbase', productId, productType: 'spot' },
    lookbackDays: rangeLookbackDays(range),
  });
  const timeline = useChannel(client, 'decision.timeline', {
    assetScope: productId.split('-')[0] ?? null, asOfMs: null, limit: 100,
  });
  const decisionMarkers = useMemo(() => decisionTimelineMarkers(
    timeline.kind === 'ready' ? timeline.value.items : [], productId,
  ).map((event) => ({ id: event.decisionId, atMs: event.timeMs,
    label: event.label, tone: event.tone })), [timeline, productId]);
  const eventMarkers = useMemo(() => eventTimeline.kind !== 'ready' ? [] : eventTimeline.value.events
    .filter((event) => eventMatchesProduct(event, productId)).map((event) => ({ id: event.id,
      atMs: event.firstSeenAtMs, label: `Event ${event.id.slice(0, 8)}`, tone: event.classification?.sentiment === 'positive' ? 'positive' as const :
        event.classification?.sentiment === 'negative' ? 'negative' as const : 'neutral' as const })), [eventTimeline, productId]);
  const quality=candles.kind==='ready'?completedBarQuality(candles.value.bars):null;
  return (
    <section className="market-detail" aria-labelledby="market-detail-heading">
      <div className="market-detail-heading">
        <div><p className="section-label">Selected market</p><h2 id="market-detail-heading">{productId}</h2></div>
        <div className="market-last-price"><span>Last observed</span><strong><QuoteValue value={quote?.priceUsd ?? null} /></strong></div>
      </div>
      <dl className="market-quote-strip">
        <div><dt>Best bid</dt><dd><QuoteValue value={quote?.bestBidUsd ?? null} /></dd></div>
        <div><dt>Best ask</dt><dd><QuoteValue value={quote?.bestAskUsd ?? null} /></dd></div>
        <div><dt>24h volume</dt><dd>{quote?.volume24h ?? '—'}</dd></div>
        <div><dt>Observed</dt><dd>{quote === undefined ? 'Awaiting quote' : new Date(quote.observedAtMs).toISOString().slice(11, 19) + 'Z'}</dd></div>
      </dl>
      <div className="market-chart-panel">
        <div className="panel-heading">
          <div><p className="section-label">Verified venue history</p><h3>Completed daily prices</h3></div>
          <div className="chart-toolbar">
            <ChartViewControl ariaLabel="Market chart type" disabled={workspace.pending} value={chartMode} options={[{ value: 'candles', label: 'Candles' }, { value: 'line', label: 'Line' }]} onChange={(value) => void workspace.update({ marketsChart: value })} />
            <ChartRangeControl surface="markets" />
          </div>
        </div>
        <details className="indicator-controls"><summary>Indicators</summary><div>{Object.entries({ sma20: 'SMA 20', sma50: 'SMA 50', ema20: 'EMA 20', bollinger20: 'Bollinger 20/2', rsi14: 'RSI 14', macd: 'MACD 12/26/9' } as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={indicators?.[key as keyof typeof indicators] ?? false} onChange={() => { if (indicators !== undefined) void workspace.update({ marketIndicators: { ...indicators, [key]: !indicators[key as keyof typeof indicators] } }); }} /> {label}</label>)}</div></details>
        <span className="data-boundary"><ShieldCheck size={14} aria-hidden="true" /> Coinbase REST · complete bars only</span>
        {candles.kind === 'loading' && <div className="chart-skeleton" aria-label="Loading completed daily prices" />}
        {candles.kind === 'ready' && candles.value.bars.length > 0 && <MarketHistoryChart client={client} bars={candles.value.bars} mode={chartMode} productId={productId} decisionMarkers={[...decisionMarkers, ...eventMarkers]} {...(workspace.preferences === null ? {} : { volumeVisible: workspace.preferences.marketVolumeVisible, indicators: workspace.preferences.marketIndicators })} />}
        {candles.kind === 'ready' && candles.value.bars.length === 0 && <div className="chart-empty-canvas"><strong>No completed bars in this range</strong><span>Choose a longer range. Coqui never substitutes another venue or an incomplete candle.</span></div>}
        {candles.kind !== 'loading' && candles.kind !== 'ready' && <p role="alert" className="empty-copy">Completed daily history unavailable. No alternative source was substituted.</p>}
      </div>
      <section className="market-quality" aria-labelledby="market-quality-heading"><div className="panel-heading"><div><p className="section-label">Decision-data boundary</p><h3 id="market-quality-heading">Source quality</h3></div></div>
        <dl><div><dt>Operational source</dt><dd>Coinbase completed daily bars</dd></div>
          <div><dt>Completed bars</dt><dd>{quality?.count??'Unavailable'}</dd></div>
          <div><dt>Detected gaps</dt><dd>{quality?.gaps??'Unavailable'}</dd></div>
          <div><dt>Latest completion</dt><dd>{quality?.latest===null||quality===null?'Unavailable':new Date(quality.latest).toISOString()}</dd></div></dl>
        <p>Live quotes and Robinhood prices remain display or valuation evidence only; they cannot replace this dataset.</p>
      </section>
    </section>
  );
}

function ReferenceContext({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const fearGreed = useChannel(client, 'market-data.fear-greed', {});
  const trending = useChannel(client, 'market-data.trending', {});
  return (
    <section className="market-reference" aria-labelledby="reference-context-heading">
      <div className="panel-heading">
        <div><p className="section-label">Human context only</p><h2 id="reference-context-heading">Reference signals</h2></div>
        <span className="data-boundary"><ShieldCheck size={14} aria-hidden="true" /> Never a strategy input</span>
      </div>
      <div className="reference-grid">
        <div>
          <span className="reference-name">Market sentiment</span>
          <strong>{fearGreed.kind === 'ready' ? `${fearGreed.value.data.value} · ${fearGreed.value.data.classification}` : 'Unavailable'}</strong>
          {fearGreed.kind === 'ready' && <small>{freshnessBadge(fearGreed.value.provenance.freshness, fearGreed.value.provenance.ageMs).text} · {provenanceBadge({ source: fearGreed.value.provenance.source, informationalOnly: true }).text}</small>}
        </div>
        <div><span className="reference-name">Trending searches</span><strong>{trending.kind === 'ready' ? `${trending.value.data.length} observed` : 'Unavailable'}</strong><small>Attention, not performance</small></div>
      </div>
    </section>
  );
}

export function Markets({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  if (workspace.preferences?.workspaceMode !== 'simple') return <AdvancedMarkets client={client} />;
  const live = useChannel(client, 'market-data.live', {});
  const portfolio = useChannel(client, 'portfolio.current', {});
  const [selected, setSelected] = useState<string | null>(null);
  const [openAdvisorFor,setOpenAdvisorFor]=useState<string|null>(null);
  const eventTimeline = useChannel(client, 'market-events.timeline', { asOfMs: null, limit: 50 });
  const products = useMemo(() => {
    const held = portfolio.kind === 'ready' && portfolio.value !== null ? portfolio.value.exposures
      .filter((item) => item.exposureKey !== 'USD' && Number(item.quantity) > 0)
      .sort((a, b) => Number(b.valueUsd ?? 0) - Number(a.valueUsd ?? 0))
      .map((item) => `${item.exposureKey}-USD`) : [];
    return held.length > 0 ? held : live.kind === 'ready' ? live.value.subscribedProducts : [];
  }, [live, portfolio]);

  useEffect(() => {
    if (selected === null && products[0] !== undefined) setSelected(products[0]);
    if (selected !== null && products.length > 0 && !products.includes(selected)) setSelected(products[0] ?? null);
  }, [products, selected]);

  useEffect(()=>{
    const selection=takeAdvisorSelection();
    if(selection?.productId!==null&&selection?.productId!==undefined) setSelected(selection.productId);
    if(selection?.openAdvisor===true&&selection.productId!==null) setOpenAdvisorFor(selection.productId);
  },[]);

  const quote = live.kind === 'ready' && selected !== null
    ? live.value.quotes.find((item) => item.instrument.productId === selected)
    : undefined;

  return (
    <div className="market-workspace">
      <section className="market-source-bar" aria-label="Live market data boundary">
        <span className={`connection-state connection-${live.kind === 'ready' ? live.value.connection : 'offline'}`}><Radio size={15} aria-hidden="true" /> {live.kind === 'ready' ? sourceState(live.value.connection) : 'Unavailable'}</span>
        <span><Activity size={15} aria-hidden="true" /> Coinbase public market feed</span>
        <span><Clock3 size={15} aria-hidden="true" /> {live.kind === 'ready' && live.value.lastMessageAtMs !== null ? `last message ${new Date(live.value.lastMessageAtMs).toISOString().slice(11, 19)}Z` : 'awaiting first message'}</span>
        <span className="market-boundary-copy">Display only · never used for research, risk, or execution</span>
      </section>
      <div className="market-layout">
        <aside className="market-watchlist" aria-labelledby="watchlist-heading">
          <div className="watchlist-heading"><div><p className="section-label">Profile universe</p><h2 id="watchlist-heading">Watchlist</h2></div><span>{products.length}</span></div>
          {products.length === 0 ? <p className="empty-copy">No connected crypto holdings are available for this profile.</p> : (
            <ul>{products.map((product) => {
              const item = live.kind === 'ready' ? live.value.quotes.find((candidate) => candidate.instrument.productId === product) : undefined;
              return <li key={product}><button type="button" aria-pressed={selected === product} onClick={() => setSelected(product)}><span><strong>{product.replace('-USD', '')}</strong><small>{product}</small></span><span className="watch-price"><QuoteValue value={item?.priceUsd ?? null} /></span></button></li>;
            })}</ul>
          )}
        </aside>
        {selected === null ? <section className="market-detail market-empty"><h2>Select a tracked market</h2><p>Completed Coinbase history and live display quotes will appear here without changing any decision dataset.</p></section> : <MarketDetail client={client} productId={selected} quote={quote} eventTimeline={eventTimeline} />}
      </div>
      <ReferenceContext client={client} />
      {selected !== null && <MarketEventsPanel client={client} productId={selected} events={eventTimeline.kind === 'ready' ? eventTimeline.value.events : []} state={eventTimeline.kind === 'ready' ? 'ready' : eventTimeline.kind === 'loading' ? 'loading' : 'unavailable'} />}
      {openAdvisorFor!==null&&<AdvisorSheet client={client} productId={openAdvisorFor} bars={[]}
        onClose={()=>setOpenAdvisorFor(null)} />}
    </div>
  );
}
