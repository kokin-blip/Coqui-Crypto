import { chartHistoryRange } from './chart-history-range.js';
import { memo, useDeferredValue, useEffect, useState } from 'react';
import { ArrowDownAZ, CircleDot, Save, Search, X } from 'lucide-react';
import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { AdvisorSheet } from './AdvisorSheet.js';
import { decisionTimelineMarkers } from './decision-timeline-markers.js';
import { ChartExtensionManager } from './ChartExtensionManager.js';
import { ChartLinkController } from './chart-link-controller.js';
import { MarketChartTileHeader } from './MarketChartTileHeader.js';
import { workstationChartHeight } from './chart-workstation-types.js';
import type { ChartTileConfiguration, DrawingTool, WorkstationBar, WorkstationChartStyle, WorkstationExtensionMarker, WorkstationIndicators, WorkstationInterval, WorkstationLayout } from './chart-workstation-types.js';
import { MarketFactsPanel } from './MarketFactsPanel.js'; import { CoinbaseMarketContext } from './CoinbaseMarketContext.js';
import { MarketDrawingTools, MarketPanelTriggers } from './MarketPanelControls.js';
import { eventMatchesProduct, MarketEventsDisclosure } from './MarketEventsPanel.js';
import { MarketFeedStatus } from './MarketFeedStatus.js';
import { SurfaceState } from './SurfaceState.js';
import { MarketWorkspaceToolbar } from './MarketWorkspaceToolbar.js';
import type { ActivitySummary } from './TerminalActivity.js';
import { ChartTile } from './MarketChartTile.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { useWorkspace } from './WorkspaceContext.js';
import { takeAdvisorSelection } from './advisor-navigation.js';
type Product = ChannelResponse<'market-data.products'>['products'][number]; const INTERVALS: readonly WorkstationInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];
const EMPTY_INDICATORS: WorkstationIndicators = Object.freeze({
  sma20: false, sma50: false, ema20: false, bollinger20: false, rsi14: false, macd: false,
});
const CHART_INVALIDATIONS = ['app.chart.workspace'] as const;

function tileCount(layout: WorkstationLayout): number {
  return layout === 'single' ? 1 : layout === 'horizontal' || layout === 'vertical' ? 2 : 4;
}
function makeTile(productId: string, interval: WorkstationInterval, chartStyle: WorkstationChartStyle,
  scaleMode: ChartTileConfiguration['scaleMode'], indicators: WorkstationIndicators): ChartTileConfiguration {
  return { productId, interval, linkGroup: 'primary', chartStyle, scaleMode,
    indicators, compareProductIds: [] };
}
function normalizeTile(tile: { readonly productId: string; readonly interval: WorkstationInterval;
  readonly linkGroup: string | null; readonly chartStyle?: WorkstationChartStyle | undefined;
  readonly scaleMode?: ChartTileConfiguration['scaleMode'] | undefined;
  readonly indicatorSet?: WorkstationIndicators | undefined;
  readonly compareProductIds?: readonly string[] | undefined }, fallback: ChartTileConfiguration): ChartTileConfiguration {
  return { productId: tile.productId, interval: tile.interval, linkGroup: tile.linkGroup,
    chartStyle: tile.chartStyle ?? fallback.chartStyle, scaleMode: tile.scaleMode ?? fallback.scaleMode,
    indicators: tile.indicatorSet ?? fallback.indicators,
    compareProductIds: [...new Set(tile.compareProductIds ?? [])].filter((id) => id !== tile.productId).slice(0, 3) };
}
function resizeTiles(current: readonly ChartTileConfiguration[], layout: WorkstationLayout,
  productIds: readonly string[], fallback: ChartTileConfiguration): readonly ChartTileConfiguration[] {
  const products = [...new Set([...current.map((tile) => tile.productId), ...productIds])];
  return Array.from({ length: Math.min(tileCount(layout), Math.max(1, products.length)) }, (_, index) =>
    current[index] ?? { ...fallback, productId: products[index] ?? products[0] ?? 'BTC-USD' });
}
export const AdvancedMarkets = memo(function AdvancedMarkets({ client, embedded = false, productId, onProductChange, active = true, activity }: {
  readonly activity?: ActivitySummary | undefined;
  readonly active?: boolean;
  readonly client: CoquiClient; readonly embedded?: boolean;
  readonly productId?: string; readonly onProductChange?: (productId: string) => void;
}): React.JSX.Element {
  const workspace = useWorkspace();
  const profiles = useChannel(client, 'accounts.profiles', {});
  const portfolio = useChannel(client, 'portfolio.current', {});
  const [query, setQuery] = useState(''); const deferredQuery = useDeferredValue(query);
  const productSearch = useChannel(client, 'market-data.products', { query: deferredQuery, limit: 100 });
  const allProducts = useChannel(client, 'market-data.products', { query: '', limit: 500 });
  const searchCatalog = productSearch.kind === 'ready' ? productSearch.value.products : []; const catalog = allProducts.kind === 'ready' ? allProducts.value.products : searchCatalog;
  const [localSelected, setLocalSelected] = useState('BTC-USD');
  const selected = productId ?? localSelected;
  const setSelected = (next: string): void => { setLocalSelected(next); onProductChange?.(next); };
  const [recentProducts, setRecentProducts] = useState<readonly string[]>([]);
  const [sortAscending, setSortAscending] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [analystOpen, setAnalystOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string | null | undefined>(undefined);
  const [draftTiles, setDraftTiles] = useState<readonly ChartTileConfiguration[] | null>(null);
  const [linkController] = useState(() => new ChartLinkController());
  const [historyAnchor] = useState(() => Date.now());
  const defaultInterval = workspace.preferences?.marketInterval ?? '1d';
  const chartWorkspace = useChannel(client, 'app.chart.workspace', { productId: selected, interval: defaultInterval });
  const extensionCatalog = useChannel(client, 'chart-extensions.catalog', {});
  const timeline = useChannel(client, 'decision.timeline', { assetScope: null, asOfMs: null, limit: 100 });
  const eventTimeline = useChannel(client, 'market-events.timeline', { asOfMs: null, limit: 50 });
  const chartCommand = useCommand(client, 'app.chart.workspace.set', CHART_INVALIDATIONS);
  const stored = chartWorkspace.kind === 'ready' ? chartWorkspace.value : { layouts: [], watchlists: [], drawings: [] };
  const defaultWatchlist = stored.watchlists.find((item) => item.isDefault);
  const portfolioProductIds = portfolio.kind === 'ready' && portfolio.value !== null ? portfolio.value.exposures
    .filter((item) => item.exposureKey !== 'USD' && Number(item.quantity) > 0)
    .sort((a, b) => Number(b.valueUsd ?? 0) - Number(a.valueUsd ?? 0)).map((item) => `${item.exposureKey}-USD`) : [];
  const portfolioWatchlist = activeWatchlistId === undefined && portfolioProductIds.length > 0; const effectiveWatchlistId = activeWatchlistId === undefined ? portfolioWatchlist ? null : defaultWatchlist?.id ?? null : activeWatchlistId;
  const activeWatchlist = stored.watchlists.find((item) => item.id === effectiveWatchlistId);
  const watchlistProducts = new Set(portfolioWatchlist ? portfolioProductIds : activeWatchlist?.productIds ?? []);
  const visibleProducts = [...searchCatalog
    .filter((item) => portfolioWatchlist ? watchlistProducts.has(item.instrument.productId) : activeWatchlist === undefined || watchlistProducts.has(item.instrument.productId))]
    .sort((left, right) => (sortAscending ? 1 : -1) * left.symbol.localeCompare(right.symbol));
  const preferredLayout = workspace.preferences?.marketLayout ?? 'single';
  const layout = stored.layouts.find((item) => item.id === activeLayoutId)?.layout ?? preferredLayout;
  const fallbackTile = makeTile(selected, defaultInterval, workspace.preferences?.marketsChart ?? 'candles',
    workspace.preferences?.marketScaleMode ?? 'linear', workspace.preferences?.marketIndicators ?? EMPTY_INDICATORS);
  const defaultTiles = resizeTiles([fallbackTile], layout,
    catalog.map((item) => item.instrument.productId), fallbackTile);
  const tiles = (draftTiles ?? defaultTiles).map((tile, index) => index === 0 && productId !== undefined ? { ...tile, productId } : tile);
  const primaryTile = tiles[0] ?? fallbackTile;
  const style = primaryTile.chartStyle;
  const indicators = primaryTile.indicators;
  const enabledExtensionIds = extensionCatalog.kind === 'ready'
    ? extensionCatalog.value.extensions.filter((item) => item.enabled).map((item) => item.id) : [];
  const decisionMarkers = (productId: string): readonly WorkstationExtensionMarker[] => {
    if (timeline.kind !== 'ready') return [];
    return decisionTimelineMarkers(timeline.value.items, productId).map((event) => ({
      extensionId: `decision:${event.decisionId}`, timeMs: event.timeMs,
      label: event.label, tone: event.tone,
    }));
  };
  const eventMarkers = (productId: string): readonly WorkstationExtensionMarker[] => eventTimeline.kind !== 'ready' ? [] :
    eventTimeline.value.events.filter((event) => eventMatchesProduct(event, productId)).map((event) => ({
      extensionId: `event:${event.id}`, timeMs: event.firstSeenAtMs, label: `Event ${event.id.slice(0, 8)}`,
      tone: event.classification?.sentiment === 'positive' ? 'positive' :
        event.classification?.sentiment === 'negative' ? 'negative' : 'neutral',
    }));
  const completed = useChannel(client, 'market-data.display-bars', {
    productId: selected, interval: defaultInterval,
    ...chartHistoryRange(defaultInterval, historyAnchor),
  });
  const factsBars: readonly WorkstationBar[] = completed.kind === 'ready' ? completed.value.bars : [];
  const activeProfileId = profiles.kind === 'ready' ? profiles.value.activeProfile.id : null;
  useEffect(()=>setRecentProducts([]),[activeProfileId]);
  useEffect(()=>{const selection=takeAdvisorSelection();if(selection?.productId!==null&&selection?.productId!==undefined) {setSelected(selection.productId);setDraftTiles(null);}if(selection?.openAdvisor===true) setAnalystOpen(true);},[]);

  useEffect(()=>{const first=portfolioProductIds[0];
    if (productId === undefined && first !== undefined && selected === 'BTC-USD' && !portfolioProductIds.includes(selected)) {
      setSelected(first); setDraftTiles(null);
    }
  }, [portfolioProductIds, selected]);

  const updateTile = (index: number, patch: Partial<ChartTileConfiguration>): void => {
    const source = tiles[index];
    if (source === undefined) return;
    setActiveLayoutId(null);
    setDraftTiles(tiles.map((tile, tileIndex) => {
      const linkedIdentityChange = ('productId' in patch || 'interval' in patch) && source.linkGroup !== null && tile.linkGroup === source.linkGroup;
      return tileIndex === index || linkedIdentityChange ? { ...tile, ...patch } : tile;
    }));
    if (index === 0 && patch.productId !== undefined) setSelected(patch.productId);
  };
  const chooseProduct = (productId: string): void => {
    setRecentProducts((current) => [productId, ...current.filter((item) => item !== productId)].slice(0, 8));
    updateTile(0, { productId, compareProductIds: primaryTile.compareProductIds.filter((id) => id !== productId) });
  };
  const changeInterval = (interval: WorkstationInterval): void => {
    updateTile(0, { interval });
    void workspace.update({ marketInterval: interval });
  };
  const changeLayout = (next: WorkstationLayout): void => {
    setActiveLayoutId(null);
    setDraftTiles(resizeTiles(tiles, next, catalog.map((item) => item.instrument.productId), fallbackTile));
    void workspace.update({ marketLayout: next });
  };
  const applyLayout = (id: string | null): void => {
    setActiveLayoutId(id);
    const saved = stored.layouts.find((item) => item.id === id);
    if (saved === undefined) { setDraftTiles(null); return; }
    setDraftTiles(saved.tiles.map((tile) => normalizeTile(tile, fallbackTile)));
    setSelected(saved.tiles[0]?.productId ?? selected);
    void workspace.update({ marketLayout: saved.layout, marketInterval: saved.tiles[0]?.interval ?? defaultInterval });
  };
  const toggleLink = (index: number): void => {
    setActiveLayoutId(null);
    setDraftTiles(tiles.map((tile, tileIndex) => tileIndex === index
      ? { ...tile, linkGroup: tile.linkGroup === null ? 'primary' : null } : tile));
  };
  const saveLayout = (): void => {
    const existing = stored.layouts.find((item) => item.id === activeLayoutId);
    void chartCommand.run({ commandId: crypto.randomUUID(), action: {
      kind: 'save_layout', id: existing?.id ?? crypto.randomUUID(),
      name: existing?.name ?? `${selected} view ${stored.layouts.length + 1}`, layout,
      tiles: tiles.map((tile) => ({ productId: tile.productId, interval: tile.interval,
        linkGroup: tile.linkGroup, chartStyle: tile.chartStyle, scaleMode: tile.scaleMode,
        indicatorSet: tile.indicators, compareProductIds: tile.compareProductIds })),
    } });
  };
  const saveWatchlist = (): void => {
    const existing = stored.watchlists.find((item) => item.id === effectiveWatchlistId);
    void chartCommand.run({ commandId: crypto.randomUUID(), action: {
      kind: 'save_watchlist', id: existing?.id ?? crypto.randomUUID(),
      name: existing?.name ?? `Watchlist ${stored.watchlists.length + 1}`,
      productIds: visibleProducts.map((item) => item.instrument.productId), isDefault: existing?.isDefault ?? stored.watchlists.length === 0,
    } });
  };
  return <div className={`advanced-markets-workstation${embedded ? ' terminal-chart-workspace' : ''}`}>
    <header className="market-command-bar">
      <div className="market-symbol"><CircleDot size={15} /><div><strong>{selected}</strong><span>Coinbase spot · {defaultInterval}</span></div></div>
      <MarketFeedStatus client={client} productId={selected} interval={defaultInterval} />
      <div className="market-timeframes" aria-label="Chart interval">{INTERVALS.map((item) => <button key={item} type="button" aria-pressed={item === defaultInterval} onClick={() => changeInterval(item)}>{item}</button>)}</div>
      <MarketPanelTriggers toolsOpen={toolsOpen} watchlistOpen={watchlistOpen} factsOpen={factsOpen}
        onTools={() => setToolsOpen((open) => !open)} onWatchlist={() => setWatchlistOpen((open) => !open)} onFacts={() => setFactsOpen((open) => !open)} />
      <MarketWorkspaceToolbar style={style} scaleMode={primaryTile.scaleMode}
        indicators={indicators} volumeVisible={workspace.preferences?.marketVolumeVisible ?? true}
        layout={layout} savedLayouts={stored.layouts} activeLayoutId={activeLayoutId}
        saving={chartCommand.state.kind === 'pending'} extensionsOpen={extensionsOpen}
        onStyle={(chartStyle) => { updateTile(0, { chartStyle }); if (chartStyle === 'candles' || chartStyle === 'line') void workspace.update({ marketsChart: chartStyle }); }}
        onScale={(scaleMode) => updateTile(0, { scaleMode })}
        onIndicators={(next) => updateTile(0, { indicators: next })}
        onVolume={(marketVolumeVisible) => void workspace.update({ marketVolumeVisible })}
        onLayout={changeLayout} onApplyLayout={applyLayout} onSave={saveLayout}
        onOpenExtensions={() => setExtensionsOpen(true)} />
    </header>
    <div className="market-workstation-grid">
      <MarketDrawingTools activeTool={activeTool} open={toolsOpen} onChange={setActiveTool} onClose={() => setToolsOpen(false)} />
      <section className={`market-chart-grid layout-${layout}`} aria-label="Market charts">{tiles.map((tile, index) => {
        const tileId = `${index}:${tile.productId}:${tile.interval}`;
        return <article className="market-chart-tile" key={tileId}>
          <MarketChartTileHeader tile={tile} products={catalog.map((item) => ({
            productId: item.instrument.productId, label: item.symbol,
          }))} liveVisible={workspace.preferences?.marketLiveCandle ?? false}
            onChange={(patch) => updateTile(index, patch)} onToggleLink={() => toggleLink(index)} />
          <ChartTile client={client} tile={tile} tileId={tileId} layoutId={activeLayoutId}
            style={tile.chartStyle} activeTool={activeTool} height={embedded && layout === 'single' ? 410 : workstationChartHeight(layout, index)} indicators={tile.indicators}
            scaleMode={tile.scaleMode} volumeVisible={workspace.preferences?.marketVolumeVisible ?? true}
            liveVisible={workspace.preferences?.marketLiveCandle ?? false} extensionIds={enabledExtensionIds}
            pendingActions={activity?.annotations.filter(a => a.productId === tile.productId && a.kind === 'proposal').filter((a, index, all) => !all.slice(index + 1).some(other => other.proposalId === a.proposalId)).filter(a => ['proposed', 'pending_review', 'approved', 'executing'].includes(a.status)).map(a => ({ ...a, atMs: activity?.annotations.find(original => original.kind === 'proposal' && original.proposalId === a.proposalId && original.productId === a.productId && original.status === 'proposed')?.atMs ?? a.atMs })) ?? []} position={activity?.positions.find(p => p.productId === tile.productId)} decisionMarkers={[...decisionMarkers(tile.productId), ...eventMarkers(tile.productId), ...(activity?.annotations.filter(a => a.kind === 'fill' && a.productId === tile.productId && a.priceUsd !== null && a.timestampSource === 'recorded_fill').map(a => ({ extensionId: `fill:${a.id}`, timeMs: a.atMs, priceUsd: a.priceUsd!, label: `${a.side === 'buy' ? 'Buy' : a.side === 'sell' ? 'Sell' : 'Fill'} ${a.quantity ?? 'unknown quantity'} @ ${a.priceUsd ?? 'unavailable'}${a.timestampSource === 'recorded_event_fill_time_unavailable' ? ' · exact fill time unavailable' : ''}`, tone: a.side === 'sell' ? 'negative' as const : 'positive' as const })) ?? [])]} historyAnchor={historyAnchor} active={active}
            linkController={linkController} onDrawing={(drawing) => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'save_drawing', drawing: { ...drawing, productId: tile.productId, interval: tile.interval, layoutId: activeLayoutId } } })}
            onDeleteDrawing={(drawingId) => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'delete_drawing', drawingId } })} />
        </article>;
      })}</section>
      <aside className={`advanced-watchlist${watchlistOpen ? ' panel-open' : ''}`}>
        <header><strong>Watchlist</strong><label className="watchlist-picker"><span className="sr-only">Saved watchlist</span><select value={portfolioWatchlist ? '__portfolio__' : effectiveWatchlistId ?? ''} onChange={(event) => setActiveWatchlistId(event.target.value === '__portfolio__' ? undefined : event.target.value === '' ? null : event.target.value)}>{portfolioProductIds.length > 0 && <option value="__portfolio__">Portfolio</option>}<option value="">All products</option>{stored.watchlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="icon-button" aria-label="Save current watchlist" disabled={visibleProducts.length === 0 || portfolioWatchlist} onClick={saveWatchlist}><Save size={14} /></button><button type="button" className="market-panel-close" aria-label="Close watchlist" onClick={() => setWatchlistOpen(false)}><X size={16} /></button></header>
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search Coinbase USD products" placeholder="Search Coinbase USD" /></label>
        <div className="recent-products" aria-label="Current and recent products">{[selected, ...recentProducts.filter((productId) => productId !== selected)].map((productId) => <button key={productId} type="button" aria-pressed={productId === selected} onClick={() => chooseProduct(productId)}>{productId.replace('-USD', '')}</button>)}</div>
        <div className="watchlist-columns"><button type="button" aria-label={`Sort symbols ${sortAscending ? 'descending' : 'ascending'}`} onClick={() => setSortAscending((value) => !value)}>Symbol <ArrowDownAZ className={sortAscending ? '' : 'sort-descending'} size={11} /></button><span>Venue</span></div>
        {productSearch.kind === 'loading' && <SurfaceState kind="loading" title="Loading USD products" compact />}
        {productSearch.kind !== 'loading' && productSearch.kind !== 'ready' && <SurfaceState kind="error" title="Product search unavailable" detail="The selected chart remains available. Retry the search when market data returns." compact />}
        {productSearch.kind === 'ready' && visibleProducts.length === 0 && <SurfaceState kind="empty" title="No matching USD products" detail="Try another symbol or choose a different watchlist." compact />}
        {productSearch.kind === 'ready' && visibleProducts.length > 0 && <ul>{visibleProducts.map((product: Product) => <li key={product.instrument.productId}><button type="button" aria-pressed={product.instrument.productId === selected} onClick={() => chooseProduct(product.instrument.productId)}><span><strong>{product.symbol}</strong><small>{product.name}</small></span><span>USD</span></button></li>)}</ul>}
      </aside>
      <MarketFactsPanel className={factsOpen ? 'panel-open' : ''} productId={selected} bars={factsBars} freshness={productSearch.kind === 'ready' ? new Date(productSearch.value.asOfMs).toLocaleString() : 'Unavailable'} onClose={() => setFactsOpen(false)} onOpenAnalyst={() => setAnalystOpen(true)} />
    </div>
    <footer className="market-workstation-footer"><span>Coinbase display data · informational only</span><label><input type="checkbox" checked={workspace.preferences?.marketLiveCandle ?? false} onChange={(event) => void workspace.update({ marketLiveCandle: event.target.checked })} /> Show provisional candle</label><span>UTC</span></footer>
    {!embedded && <MarketEventsDisclosure client={client} productId={selected} events={eventTimeline.kind === 'ready' ? eventTimeline.value.events : []} state={eventTimeline.kind === 'ready' ? 'ready' : eventTimeline.kind === 'loading' ? 'loading' : 'unavailable'} />}
    {analystOpen && <AdvisorSheet client={client} productId={selected} bars={factsBars} onClose={() => setAnalystOpen(false)} />}
    {!embedded && <CoinbaseMarketContext client={client} productId={selected} />}{extensionsOpen && <ChartExtensionManager client={client} onClose={() => setExtensionsOpen(false)} />}
  </div>;
});
