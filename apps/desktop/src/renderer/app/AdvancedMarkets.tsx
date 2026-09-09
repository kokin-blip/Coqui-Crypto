import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ, CircleDot, Columns2, MousePointer2, PanelTop, RectangleHorizontal,
  Save, Search, SlidersHorizontal, TextCursorInput, TrendingUp, Waves,
} from 'lucide-react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { AdvisorSheet } from './AdvisorSheet.js';
import { decisionTimelineMarkers } from './decision-timeline-markers.js';
import { ChartExtensionManager } from './ChartExtensionManager.js';
import { ChartLinkController } from './chart-link-controller.js';
import { ChartDrawingManager } from './ChartDrawingManager.js';
import { MarketChartTileHeader } from './MarketChartTileHeader.js';
import type {
  ChartDrawing, ChartTileConfiguration, DrawingTool, WorkstationBar,
  WorkstationChartStyle, WorkstationExtensionMarker, WorkstationIndicators, WorkstationInterval, WorkstationLayout,
} from './chart-workstation-types.js';
import { MarketFactsPanel } from './MarketFactsPanel.js';
import { eventMatchesProduct, MarketEventsPanel } from './MarketEventsPanel.js';
import { MarketWorkspaceToolbar } from './MarketWorkspaceToolbar.js';
import { TradingWorkstationChart } from './TradingWorkstationChart.js';
import { useChartExtensionSeries } from './use-chart-extension-series.js';
import { useComparisonSeries } from './use-comparison-series.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { useWorkspace } from './WorkspaceContext.js';
import { takeAdvisorSelection } from './advisor-navigation.js';

type Product = ChannelResponse<'market-data.products'>['products'][number]; const INTERVALS: readonly WorkstationInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];
const EMPTY_INDICATORS: WorkstationIndicators = Object.freeze({
  sma20: false, sma50: false, ema20: false, bollinger20: false, rsi14: false, macd: false,
});
const TOOL_ICONS: ReadonlyArray<readonly [DrawingTool, React.ComponentType<{ size?: number }>, string]> = [
  ['cursor', MousePointer2, 'Pointer'], ['horizontal', PanelTop, 'Horizontal line'],
  ['vertical', Columns2, 'Vertical line'], ['trend', TrendingUp, 'Trend line'],
  ['ray', TrendingUp, 'Ray'], ['rectangle', RectangleHorizontal, 'Range'],
  ['fibonacci', Waves, 'Fibonacci'], ['text', TextCursorInput, 'Text'],
  ['measure', SlidersHorizontal, 'Measure'],
]; const CHART_INVALIDATIONS = ['app.chart.workspace'] as const;

function rangeMs(interval: WorkstationInterval): number {
  return { '1m': 86_400_000, '5m': 7 * 86_400_000, '15m': 30 * 86_400_000,
    '1h': 90 * 86_400_000, '6h': 365 * 86_400_000, '1d': 5 * 365 * 86_400_000 }[interval];
}

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

function chartHeight(layout: WorkstationLayout, index: number): number {
  if (layout === 'single') return 520;
  if (layout === 'horizontal') return 500;
  if (layout === 'dominant' && index === 0) return 520;
  return 280;
}

function ChartTile({ client, tile, tileId, layoutId, style, activeTool, height,
  indicators, scaleMode, volumeVisible, liveVisible, extensionIds, linkController,
  decisionMarkers, onDrawing, onDeleteDrawing }: {
  readonly client: CoquiClient; readonly tile: ChartTileConfiguration; readonly tileId: string;
  readonly layoutId: string | null; readonly style: WorkstationChartStyle;
  readonly activeTool: DrawingTool; readonly height: number; readonly indicators: WorkstationIndicators;
  readonly scaleMode: 'linear' | 'percentage' | 'indexed' | 'logarithmic';
  readonly volumeVisible: boolean; readonly liveVisible: boolean; readonly extensionIds: readonly string[];
  readonly linkController: ChartLinkController; readonly onDrawing: (drawing: ChartDrawing) => void;
  readonly decisionMarkers: readonly WorkstationExtensionMarker[];
  readonly onDeleteDrawing: (id: string) => void;
}): React.JSX.Element {
  const [anchor] = useState(() => Date.now());
  const history = useChannel(client, 'market-data.display-bars', {
    productId: tile.productId, interval: tile.interval,
    startTimeMs: anchor - rangeMs(tile.interval), endTimeMs: anchor,
  });
  const live = useChannel(client, 'market-data.live-candles', { productIds: [tile.productId], interval: tile.interval });
  const chartWorkspace = useChannel(client, 'app.chart.workspace', { productId: tile.productId, interval: tile.interval });
  const bars = useMemo<readonly WorkstationBar[]>(() => {
    const completed = history.kind === 'ready' ? history.value.bars : [];
    if (!liveVisible || live.kind !== 'ready') return completed;
    const provisional = live.value.candles[0];
    return provisional === undefined ? completed : [...completed, provisional];
  }, [history, live, liveVisible]);
  const extensionState = useChartExtensionSeries(client, extensionIds, bars);
  const comparisons = useComparisonSeries(client, tile.compareProductIds, tile.interval,
    anchor - rangeMs(tile.interval), anchor);
  const drawings: readonly ChartDrawing[] = chartWorkspace.kind === 'ready'
    ? chartWorkspace.value.drawings.filter((drawing) => drawing.layoutId === null || drawing.layoutId === layoutId)
      .map((drawing) => ({ id: drawing.id, kind: drawing.kind, points: drawing.points, label: drawing.label }))
    : [];
  if (history.kind === 'loading') return <div className="workstation-chart-loading" aria-label={`Loading ${tile.productId} chart`} />;
  if (history.kind !== 'ready') return <div className="workstation-chart-empty"><strong>Chart unavailable</strong><span>Coinbase history could not be loaded. No substitute source was used.</span></div>;
  if (bars.length === 0) return <div className="workstation-chart-empty"><strong>No completed candles</strong><span>Try a longer interval or range.</span></div>;
  return <div className="chart-render-stack">
    {extensionState.kind === 'loading' && <span className="chart-extension-state">Evaluating extensions…</span>}
    {extensionState.failedCount > 0 && <span className="chart-extension-state warning">{extensionState.failedCount} extension{extensionState.failedCount === 1 ? '' : 's'} unavailable</span>}
    {comparisons.loading && <span className="chart-comparison-state">Loading comparisons…</span>}
    {comparisons.failedCount > 0 && <span className="chart-comparison-state warning">{comparisons.failedCount} comparison{comparisons.failedCount === 1 ? '' : 's'} unavailable</span>}
    <TradingWorkstationChart client={client} bars={bars} productId={tile.productId}
      style={style} scaleMode={scaleMode} volumeVisible={volumeVisible} indicators={indicators}
      comparisons={comparisons.series}
      extensionSeries={extensionState.series} extensionMarkers={[...extensionState.markers, ...decisionMarkers]} activeTool={activeTool} drawings={drawings}
      onDrawing={onDrawing} height={height} syncId={tileId} linkGroup={tile.linkGroup}
      linkController={linkController} />
    <ChartDrawingManager drawings={drawings} onSave={onDrawing} onDelete={onDeleteDrawing} />
  </div>;
}

export function AdvancedMarkets({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  const profiles = useChannel(client, 'accounts.profiles', {});
  const portfolio = useChannel(client, 'portfolio.current', {});
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const productSearch = useChannel(client, 'market-data.products', { query: deferredQuery, limit: 100 });
  const allProducts = useChannel(client, 'market-data.products', { query: '', limit: 100 });
  const searchCatalog = productSearch.kind === 'ready' ? productSearch.value.products : [];
  const catalog = allProducts.kind === 'ready' ? allProducts.value.products : searchCatalog;
  const [selected, setSelected] = useState('BTC-USD');
  const [recentProducts, setRecentProducts] = useState<readonly string[]>([]);
  const [sortAscending, setSortAscending] = useState(true);
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [analystOpen, setAnalystOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
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
  const portfolioWatchlist = activeWatchlistId === undefined && portfolioProductIds.length > 0;
  const effectiveWatchlistId = activeWatchlistId === undefined ? portfolioWatchlist ? null : defaultWatchlist?.id ?? null : activeWatchlistId;
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
  const tiles = draftTiles ?? defaultTiles;
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
    startTimeMs: historyAnchor - rangeMs(defaultInterval), endTimeMs: historyAnchor,
  });
  const factsBars: readonly WorkstationBar[] = completed.kind === 'ready' ? completed.value.bars : [];
  const activeProfileId = profiles.kind === 'ready' ? profiles.value.activeProfile.id : null;

  useEffect(()=>setRecentProducts([]),[activeProfileId]);

  useEffect(()=>{const selection=takeAdvisorSelection();if(selection?.productId!==null&&selection?.productId!==undefined) {setSelected(selection.productId);setDraftTiles(null);}if(selection?.openAdvisor===true) setAnalystOpen(true);},[]);

  useEffect(()=>{const first=portfolioProductIds[0];
    if (first !== undefined && selected === 'BTC-USD' && !portfolioProductIds.includes(selected)) {
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

  return <div className="advanced-markets-workstation">
    <header className="market-command-bar">
      <div className="market-symbol"><CircleDot size={15} /><div><strong>{selected}</strong><span>Coinbase spot · {defaultInterval}</span></div></div>
      <div className="market-timeframes" aria-label="Chart interval">{INTERVALS.map((item) => <button key={item} type="button" aria-pressed={item === defaultInterval} onClick={() => changeInterval(item)}>{item}</button>)}</div>
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
      <nav className="drawing-tool-rail" aria-label="Chart drawing tools">{TOOL_ICONS.map(([tool, Icon, label]) => <button key={tool} type="button" aria-label={label} title={label} aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)}><Icon size={18} /></button>)}</nav>
      <section className={`market-chart-grid layout-${layout}`} aria-label="Market charts">{tiles.map((tile, index) => {
        const tileId = `${index}:${tile.productId}:${tile.interval}`;
        return <article className="market-chart-tile" key={tileId}>
          <MarketChartTileHeader tile={tile} products={catalog.map((item) => ({
            productId: item.instrument.productId, label: item.symbol,
          }))} liveVisible={workspace.preferences?.marketLiveCandle ?? false}
            onChange={(patch) => updateTile(index, patch)} onToggleLink={() => toggleLink(index)} />
          <ChartTile client={client} tile={tile} tileId={tileId} layoutId={activeLayoutId}
            style={tile.chartStyle} activeTool={activeTool} height={chartHeight(layout, index)} indicators={tile.indicators}
            scaleMode={tile.scaleMode} volumeVisible={workspace.preferences?.marketVolumeVisible ?? true}
            liveVisible={workspace.preferences?.marketLiveCandle ?? false} extensionIds={enabledExtensionIds}
            decisionMarkers={[...decisionMarkers(tile.productId), ...eventMarkers(tile.productId)]}
            linkController={linkController} onDrawing={(drawing) => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'save_drawing', drawing: { ...drawing, productId: tile.productId, interval: tile.interval, layoutId: activeLayoutId } } })}
            onDeleteDrawing={(drawingId) => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'delete_drawing', drawingId } })} />
        </article>;
      })}</section>
      <aside className="advanced-watchlist">
        <header><strong>Watchlist</strong><label className="watchlist-picker"><span className="sr-only">Saved watchlist</span><select value={portfolioWatchlist ? '__portfolio__' : effectiveWatchlistId ?? ''} onChange={(event) => setActiveWatchlistId(event.target.value === '__portfolio__' ? undefined : event.target.value === '' ? null : event.target.value)}>{portfolioProductIds.length > 0 && <option value="__portfolio__">Portfolio</option>}<option value="">All products</option>{stored.watchlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="icon-button" aria-label="Save current watchlist" disabled={visibleProducts.length === 0 || portfolioWatchlist} onClick={saveWatchlist}><Save size={14} /></button></header>
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Coinbase USD" /></label>
        <div className="recent-products" aria-label="Recent products">{recentProducts.map((productId) => <button key={productId} type="button" onClick={() => chooseProduct(productId)}>{productId.replace('-USD', '')}</button>)}</div>
        <div className="watchlist-columns"><button type="button" aria-label={`Sort symbols ${sortAscending ? 'descending' : 'ascending'}`} onClick={() => setSortAscending((value) => !value)}>Symbol <ArrowDownAZ className={sortAscending ? '' : 'sort-descending'} size={11} /></button><span>Venue</span></div>
        <ul>{visibleProducts.map((product: Product) => <li key={product.instrument.productId}><button type="button" aria-pressed={product.instrument.productId === selected} onClick={() => chooseProduct(product.instrument.productId)}><span><strong>{product.symbol}</strong><small>{product.name}</small></span><span>USD</span></button></li>)}</ul>
      </aside>
      <MarketFactsPanel productId={selected} bars={factsBars} freshness={productSearch.kind === 'ready' ? new Date(productSearch.value.asOfMs).toISOString() : 'Unavailable'} onOpenAnalyst={() => setAnalystOpen(true)} />
    </div>
    <footer className="market-workstation-footer"><span>Coinbase display data · informational only</span><label><input type="checkbox" checked={workspace.preferences?.marketLiveCandle ?? false} onChange={(event) => void workspace.update({ marketLiveCandle: event.target.checked })} /> Show provisional candle</label><span>UTC</span></footer>
    <MarketEventsPanel client={client} productId={selected} events={eventTimeline.kind === 'ready' ? eventTimeline.value.events : []} state={eventTimeline.kind === 'ready' ? 'ready' : eventTimeline.kind === 'loading' ? 'loading' : 'unavailable'} />
    {analystOpen && <AdvisorSheet client={client} productId={selected} bars={factsBars} onClose={() => setAnalystOpen(false)} />}
    {extensionsOpen && <ChartExtensionManager client={client} onClose={() => setExtensionsOpen(false)} />}
  </div>;
}
