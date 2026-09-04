import { useDeferredValue, useMemo, useState } from 'react';
import {
  CircleDot, Columns2, Link2, MousePointer2, PanelTop, RectangleHorizontal,
  Save, Search, SlidersHorizontal, TextCursorInput, TrendingUp, Unlink2, Waves,
} from 'lucide-react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { AdvisorSheet } from './AdvisorSheet.js';
import { ChartExtensionManager } from './ChartExtensionManager.js';
import { ChartLinkController } from './chart-link-controller.js';
import type {
  ChartDrawing, ChartTileConfiguration, DrawingTool, WorkstationBar,
  WorkstationChartStyle, WorkstationIndicators, WorkstationInterval, WorkstationLayout,
} from './chart-workstation-types.js';
import { MarketFactsPanel } from './MarketFactsPanel.js';
import { MarketWorkspaceToolbar } from './MarketWorkspaceToolbar.js';
import { TradingWorkstationChart } from './TradingWorkstationChart.js';
import { useChartExtensionSeries } from './use-chart-extension-series.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { useWorkspace } from './WorkspaceContext.js';

type Product = ChannelResponse<'market-data.products'>['products'][number];
const INTERVALS: readonly WorkstationInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];
const EMPTY_INDICATORS: WorkstationIndicators = Object.freeze({
  sma20: false, sma50: false, ema20: false, bollinger20: false, rsi14: false, macd: false,
});
const TOOL_ICONS: ReadonlyArray<readonly [DrawingTool, React.ComponentType<{ size?: number }>, string]> = [
  ['cursor', MousePointer2, 'Pointer'], ['horizontal', PanelTop, 'Horizontal line'],
  ['vertical', Columns2, 'Vertical line'], ['trend', TrendingUp, 'Trend line'],
  ['ray', TrendingUp, 'Ray'], ['rectangle', RectangleHorizontal, 'Range'],
  ['fibonacci', Waves, 'Fibonacci'], ['text', TextCursorInput, 'Text'],
  ['measure', SlidersHorizontal, 'Measure'],
];
const CHART_INVALIDATIONS = ['app.chart.workspace'] as const;

function rangeMs(interval: WorkstationInterval): number {
  return { '1m': 86_400_000, '5m': 7 * 86_400_000, '15m': 30 * 86_400_000,
    '1h': 90 * 86_400_000, '6h': 365 * 86_400_000, '1d': 5 * 365 * 86_400_000 }[interval];
}

function tileCount(layout: WorkstationLayout): number {
  return layout === 'single' ? 1 : layout === 'horizontal' || layout === 'vertical' ? 2 : 4;
}

function resizeTiles(current: readonly ChartTileConfiguration[], layout: WorkstationLayout,
  productIds: readonly string[], interval: WorkstationInterval): readonly ChartTileConfiguration[] {
  const products = [...new Set([...current.map((tile) => tile.productId), ...productIds])];
  return Array.from({ length: Math.min(tileCount(layout), Math.max(1, products.length)) }, (_, index) =>
    current[index] ?? { productId: products[index] ?? products[0] ?? 'BTC-USD', interval, linkGroup: 'primary' });
}

function chartHeight(layout: WorkstationLayout, index: number): number {
  if (layout === 'single') return 520;
  if (layout === 'horizontal') return 500;
  if (layout === 'dominant' && index === 0) return 520;
  return 280;
}

function ChartTile({ client, tile, tileId, layoutId, style, activeTool, height,
  indicators, scaleMode, volumeVisible, liveVisible, extensionIds, linkController,
  onDrawing }: {
  readonly client: CoquiClient; readonly tile: ChartTileConfiguration; readonly tileId: string;
  readonly layoutId: string | null; readonly style: WorkstationChartStyle;
  readonly activeTool: DrawingTool; readonly height: number; readonly indicators: WorkstationIndicators;
  readonly scaleMode: 'linear' | 'percentage' | 'indexed' | 'logarithmic';
  readonly volumeVisible: boolean; readonly liveVisible: boolean; readonly extensionIds: readonly string[];
  readonly linkController: ChartLinkController; readonly onDrawing: (drawing: ChartDrawing) => void;
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
    <TradingWorkstationChart client={client} bars={bars} productId={tile.productId}
      style={style} scaleMode={scaleMode} volumeVisible={volumeVisible} indicators={indicators}
      extensionSeries={extensionState.series} activeTool={activeTool} drawings={drawings}
      onDrawing={onDrawing} height={height} syncId={tileId} linkGroup={tile.linkGroup}
      linkController={linkController} />
  </div>;
}

export function AdvancedMarkets({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const productSearch = useChannel(client, 'market-data.products', { query: deferredQuery, limit: 100 });
  const allProducts = useChannel(client, 'market-data.products', { query: '', limit: 100 });
  const searchCatalog = productSearch.kind === 'ready' ? productSearch.value.products : [];
  const catalog = allProducts.kind === 'ready' ? allProducts.value.products : searchCatalog;
  const [selected, setSelected] = useState('BTC-USD');
  const [styleOverride, setStyleOverride] = useState<WorkstationChartStyle | null>(null);
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
  const chartCommand = useCommand(client, 'app.chart.workspace.set', CHART_INVALIDATIONS);
  const stored = chartWorkspace.kind === 'ready' ? chartWorkspace.value : { layouts: [], watchlists: [], drawings: [] };
  const defaultWatchlist = stored.watchlists.find((item) => item.isDefault);
  const effectiveWatchlistId = activeWatchlistId === undefined ? defaultWatchlist?.id ?? null : activeWatchlistId;
  const activeWatchlist = stored.watchlists.find((item) => item.id === effectiveWatchlistId);
  const watchlistProducts = new Set(activeWatchlist?.productIds ?? []);
  const visibleProducts = searchCatalog.filter((item) => activeWatchlist === undefined || watchlistProducts.has(item.instrument.productId));
  const preferredLayout = workspace.preferences?.marketLayout ?? 'single';
  const layout = stored.layouts.find((item) => item.id === activeLayoutId)?.layout ?? preferredLayout;
  const defaultTiles = resizeTiles([{ productId: selected, interval: defaultInterval, linkGroup: 'primary' }], layout,
    catalog.map((item) => item.instrument.productId), defaultInterval);
  const tiles = draftTiles ?? defaultTiles;
  const style = styleOverride ?? workspace.preferences?.marketsChart ?? 'candles';
  const indicators = workspace.preferences?.marketIndicators ?? EMPTY_INDICATORS;
  const enabledExtensionIds = extensionCatalog.kind === 'ready'
    ? extensionCatalog.value.extensions.filter((item) => item.enabled).map((item) => item.id) : [];
  const completed = useChannel(client, 'market-data.display-bars', {
    productId: selected, interval: defaultInterval,
    startTimeMs: historyAnchor - rangeMs(defaultInterval), endTimeMs: historyAnchor,
  });
  const factsBars: readonly WorkstationBar[] = completed.kind === 'ready' ? completed.value.bars : [];

  const chooseProduct = (productId: string): void => {
    setSelected(productId);
    setDraftTiles(tiles.map((tile, index) => index === 0 ? { ...tile, productId } : tile));
  };
  const changeInterval = (interval: WorkstationInterval): void => {
    const group = tiles[0]?.linkGroup;
    setDraftTiles(tiles.map((tile, index) => index === 0 || (group !== null && tile.linkGroup === group) ? { ...tile, interval } : tile));
    void workspace.update({ marketInterval: interval });
  };
  const changeLayout = (next: WorkstationLayout): void => {
    setActiveLayoutId(null);
    setDraftTiles(resizeTiles(tiles, next, catalog.map((item) => item.instrument.productId), defaultInterval));
    void workspace.update({ marketLayout: next });
  };
  const applyLayout = (id: string | null): void => {
    setActiveLayoutId(id);
    const saved = stored.layouts.find((item) => item.id === id);
    if (saved === undefined) { setDraftTiles(null); return; }
    setDraftTiles(saved.tiles);
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
      name: existing?.name ?? `${selected} view ${stored.layouts.length + 1}`, layout, tiles,
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
      <MarketWorkspaceToolbar style={style} scaleMode={workspace.preferences?.marketScaleMode ?? 'linear'}
        indicators={indicators} volumeVisible={workspace.preferences?.marketVolumeVisible ?? true}
        layout={layout} savedLayouts={stored.layouts} activeLayoutId={activeLayoutId}
        saving={chartCommand.state.kind === 'pending'} extensionsOpen={extensionsOpen}
        onStyle={(next) => { setStyleOverride(next); if (next === 'candles' || next === 'line') void workspace.update({ marketsChart: next }); }}
        onScale={(marketScaleMode) => void workspace.update({ marketScaleMode })}
        onIndicators={(marketIndicators) => void workspace.update({ marketIndicators })}
        onVolume={(marketVolumeVisible) => void workspace.update({ marketVolumeVisible })}
        onLayout={changeLayout} onApplyLayout={applyLayout} onSave={saveLayout}
        onOpenExtensions={() => setExtensionsOpen(true)} />
    </header>
    <div className="market-workstation-grid">
      <nav className="drawing-tool-rail" aria-label="Chart drawing tools">{TOOL_ICONS.map(([tool, Icon, label]) => <button key={tool} type="button" aria-label={label} title={label} aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)}><Icon size={18} /></button>)}</nav>
      <section className={`market-chart-grid layout-${layout}`} aria-label="Market charts">{tiles.map((tile, index) => {
        const tileId = `${index}:${tile.productId}:${tile.interval}`;
        return <article className="market-chart-tile" key={tileId}>
          <div className="chart-tile-label"><span><strong>{tile.productId}</strong><small>{tile.interval} · {workspace.preferences?.marketLiveCandle ? 'live candle visible' : 'completed only'}</small></span><button type="button" className="chart-link-toggle" aria-label={`${tile.linkGroup === null ? 'Link' : 'Unlink'} ${tile.productId} chart`} aria-pressed={tile.linkGroup !== null} onClick={() => toggleLink(index)}>{tile.linkGroup === null ? <Unlink2 size={13} /> : <Link2 size={13} />}<span>{tile.linkGroup === null ? 'Independent' : 'Linked'}</span></button></div>
          <ChartTile client={client} tile={tile} tileId={tileId} layoutId={activeLayoutId}
            style={style} activeTool={activeTool} height={chartHeight(layout, index)} indicators={indicators}
            scaleMode={workspace.preferences?.marketScaleMode ?? 'linear'} volumeVisible={workspace.preferences?.marketVolumeVisible ?? true}
            liveVisible={workspace.preferences?.marketLiveCandle ?? false} extensionIds={enabledExtensionIds}
            linkController={linkController} onDrawing={(drawing) => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'save_drawing', drawing: { ...drawing, productId: tile.productId, interval: tile.interval, layoutId: activeLayoutId } } })} />
        </article>;
      })}</section>
      <aside className="advanced-watchlist">
        <header><strong>Watchlist</strong><label className="watchlist-picker"><span className="sr-only">Saved watchlist</span><select value={effectiveWatchlistId ?? ''} onChange={(event) => setActiveWatchlistId(event.target.value === '' ? null : event.target.value)}><option value="">All products</option>{stored.watchlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="icon-button" aria-label="Save current watchlist" disabled={visibleProducts.length === 0} onClick={saveWatchlist}><Save size={14} /></button></header>
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Coinbase USD" /></label>
        <div className="watchlist-columns"><span>Symbol</span><span>Venue</span></div>
        <ul>{visibleProducts.map((product: Product) => <li key={product.instrument.productId}><button type="button" aria-pressed={product.instrument.productId === selected} onClick={() => chooseProduct(product.instrument.productId)}><span><strong>{product.symbol}</strong><small>{product.name}</small></span><span>USD</span></button></li>)}</ul>
      </aside>
      <MarketFactsPanel productId={selected} bars={factsBars} freshness={productSearch.kind === 'ready' ? new Date(productSearch.value.asOfMs).toISOString() : 'Unavailable'} onOpenAnalyst={() => setAnalystOpen(true)} />
    </div>
    <footer className="market-workstation-footer"><span>Coinbase display data · informational only</span><label><input type="checkbox" checked={workspace.preferences?.marketLiveCandle ?? false} onChange={(event) => void workspace.update({ marketLiveCandle: event.target.checked })} /> Show provisional candle</label><span>UTC</span></footer>
    {analystOpen && <AdvisorSheet client={client} productId={selected} bars={factsBars} onClose={() => setAnalystOpen(false)} />}
    {extensionsOpen && <ChartExtensionManager client={client} onClose={() => setExtensionsOpen(false)} />}
  </div>;
}
