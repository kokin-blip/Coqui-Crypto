import { useMemo, useState } from 'react';
import {
  BarChart3, CandlestickChart, ChevronDown, CircleDot, Columns2, Grid2X2,
  Layers3, LineChart, MousePointer2, PanelTop, RectangleHorizontal, Save, Search,
  SlidersHorizontal, TextCursorInput, TrendingUp, Waves, Puzzle,
} from 'lucide-react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { MarketFactsPanel } from './MarketFactsPanel.js';
import { ChartExtensionManager } from './ChartExtensionManager.js';
import { AdvisorSheet } from './AdvisorSheet.js';
import { TradingWorkstationChart } from './TradingWorkstationChart.js';
import type {
  ChartDrawing, DrawingTool, WorkstationBar, WorkstationChartStyle, WorkstationInterval,
} from './chart-workstation-types.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { useWorkspace } from './WorkspaceContext.js';

type Product = ChannelResponse<'market-data.products'>['products'][number];
const INTERVALS: readonly WorkstationInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];
const TOOL_ICONS: ReadonlyArray<readonly [DrawingTool, React.ComponentType<{ size?: number }>, string]> = [
  ['cursor', MousePointer2, 'Pointer'], ['horizontal', PanelTop, 'Horizontal line'],
  ['vertical', Columns2, 'Vertical line'], ['trend', TrendingUp, 'Trend line'],
  ['ray', LineChart, 'Ray'], ['rectangle', RectangleHorizontal, 'Range'],
  ['fibonacci', Waves, 'Fibonacci'], ['text', TextCursorInput, 'Text'],
  ['measure', SlidersHorizontal, 'Measure'],
];
const CHART_INVALIDATIONS = ['app.chart.workspace'] as const;

function rangeMs(interval: WorkstationInterval): number {
  return { '1m': 86_400_000, '5m': 7 * 86_400_000, '15m': 30 * 86_400_000,
    '1h': 90 * 86_400_000, '6h': 365 * 86_400_000, '1d': 365 * 86_400_000 }[interval];
}

function ChartTile({ client, productId, interval, style, activeTool, drawings, onDrawing }: {
  readonly client: CoquiClient; readonly productId: string; readonly interval: WorkstationInterval;
  readonly style: WorkstationChartStyle; readonly activeTool: DrawingTool;
  readonly drawings: readonly ChartDrawing[]; readonly onDrawing: (drawing: ChartDrawing) => void;
}): React.JSX.Element {
  const workspace = useWorkspace();
  const [anchor] = useState(() => Date.now());
  const history = useChannel(client, 'market-data.display-bars', {
    productId, interval, startTimeMs: anchor - rangeMs(interval), endTimeMs: anchor,
  });
  const live = useChannel(client, 'market-data.live-candles', { productIds: [productId], interval });
  const bars = useMemo<readonly WorkstationBar[]>(() => {
    const completed = history.kind === 'ready' ? history.value.bars : [];
    if (workspace.preferences?.marketLiveCandle !== true || live.kind !== 'ready') return completed;
    const provisional = live.value.candles[0];
    return provisional === undefined ? completed : [...completed, provisional];
  }, [history, live, workspace.preferences?.marketLiveCandle]);
  if (history.kind === 'loading') return <div className="workstation-chart-loading" aria-label={`Loading ${productId} chart`} />;
  if (history.kind !== 'ready') return <div className="workstation-chart-empty"><strong>Chart unavailable</strong><span>Coinbase history could not be loaded. No substitute source was used.</span></div>;
  if (bars.length === 0) return <div className="workstation-chart-empty"><strong>No completed candles</strong><span>Try a longer interval or range.</span></div>;
  return <TradingWorkstationChart client={client} bars={bars} productId={productId}
    style={style} scaleMode={workspace.preferences?.marketScaleMode ?? 'linear'}
    volumeVisible={workspace.preferences?.marketVolumeVisible ?? true}
    indicators={workspace.preferences?.marketIndicators ?? { sma20: false, sma50: false, ema20: false, bollinger20: false, rsi14: false, macd: false }}
    activeTool={activeTool} drawings={drawings} onDrawing={onDrawing} />;
}

export function AdvancedMarkets({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  const [query, setQuery] = useState('');
  const products = useChannel(client, 'market-data.products', { query, limit: 100 });
  const catalog = products.kind === 'ready' ? products.value.products : [];
  const [selected, setSelected] = useState('BTC-USD');
  const [style, setStyle] = useState<WorkstationChartStyle>('candles');
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [analystOpen, setAnalystOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [historyAnchor] = useState(() => Date.now());
  const interval = workspace.preferences?.marketInterval ?? '1d';
  const selectedProduct = catalog.find((product) => product.instrument.productId === selected) ?? catalog[0];
  const productId = selectedProduct?.instrument.productId ?? selected;
  const chartWorkspace = useChannel(client, 'app.chart.workspace', { productId, interval });
  const chartCommand = useCommand(client, 'app.chart.workspace.set', CHART_INVALIDATIONS);
  const drawings: readonly ChartDrawing[] = chartWorkspace.kind === 'ready'
    ? chartWorkspace.value.drawings.map((drawing) => ({
        id: drawing.id, kind: drawing.kind, points: drawing.points, label: drawing.label,
      }))
    : [];
  const layout = workspace.preferences?.marketLayout ?? 'single';
  const tileProducts = [productId, ...catalog.map((item) => item.instrument.productId).filter((item) => item !== productId)]
    .slice(0, layout === 'single' ? 1 : layout === 'horizontal' || layout === 'vertical' ? 2 : 4);
  const completed = useChannel(client, 'market-data.display-bars', {
    productId, interval, startTimeMs: historyAnchor - rangeMs(interval), endTimeMs: historyAnchor,
  });
  const factsBars: readonly WorkstationBar[] = completed.kind === 'ready' ? completed.value.bars : [];
  return <div className="advanced-markets-workstation">
    <header className="market-command-bar">
      <div className="market-symbol"><CircleDot size={15} /><div><strong>{productId}</strong><span>Coinbase spot · {interval}</span></div></div>
      <div className="market-timeframes" aria-label="Chart interval">{INTERVALS.map((item) => <button key={item} type="button" aria-pressed={item === interval} onClick={() => void workspace.update({ marketInterval: item })}>{item}</button>)}</div>
      <div className="market-style-control"><button type="button" aria-label="Candlestick chart" aria-pressed={style === 'candles'} onClick={() => setStyle('candles')}><CandlestickChart size={16} /></button><button type="button" aria-label="Line chart" aria-pressed={style === 'line'} onClick={() => setStyle('line')}><LineChart size={16} /></button><button type="button" aria-label="Area chart" aria-pressed={style === 'area'} onClick={() => setStyle('area')}><BarChart3 size={16} /></button></div>
      <button type="button" className="compact-control" onClick={() => void workspace.update({ marketLayout: layout === 'single' ? 'grid' : 'single' })}>{layout === 'single' ? <Grid2X2 size={15} /> : <Layers3 size={15} />} {layout === 'single' ? 'Multi-chart' : 'Single'} <ChevronDown size={13} /></button>
      <button type="button" className="compact-control" onClick={() => setExtensionsOpen(true)}><Puzzle size={14} /> Extensions</button>
      <button type="button" className="compact-control save-chart-view" disabled={chartCommand.state.kind === 'pending'} onClick={() => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'save_layout', id: crypto.randomUUID(), name: `${productId} workspace`, layout, tiles: tileProducts.map((tile) => ({ productId: tile, interval, linkGroup: 'primary' })) } })}><Save size={14} /> Save view</button>
    </header>
    <div className="market-workstation-grid">
      <nav className="drawing-tool-rail" aria-label="Chart drawing tools">{TOOL_ICONS.map(([tool, Icon, label]) => <button key={tool} type="button" aria-label={label} title={label} aria-pressed={activeTool === tool} onClick={() => setActiveTool(tool)}><Icon size={18} /></button>)}</nav>
      <section className={`market-chart-grid layout-${layout}`} aria-label="Market charts">{tileProducts.map((tile) => <article className="market-chart-tile" key={tile}><div className="chart-tile-label"><strong>{tile}</strong><span>{interval} · {workspace.preferences?.marketLiveCandle ? 'live candle visible' : 'completed only'}</span></div><ChartTile client={client} productId={tile} interval={interval} style={style} activeTool={activeTool} drawings={tile === productId ? drawings : []} onDrawing={(drawing) => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'save_drawing', drawing: { ...drawing, productId: tile, interval, layoutId: null } } })} /></article>)}</section>
      <aside className="advanced-watchlist"><header><strong>Watchlist</strong><button type="button" className="icon-button" aria-label="Save current watchlist" onClick={() => void chartCommand.run({ commandId: crypto.randomUUID(), action: { kind: 'save_watchlist', id: crypto.randomUUID(), name: 'Markets', productIds: catalog.map((item) => item.instrument.productId), isDefault: true } })}><Save size={14} /></button></header><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Coinbase USD" /></label><div className="watchlist-columns"><span>Symbol</span><span>Venue</span></div><ul>{catalog.map((product: Product) => <li key={product.instrument.productId}><button type="button" aria-pressed={product.instrument.productId === productId} onClick={() => setSelected(product.instrument.productId)}><span><strong>{product.symbol}</strong><small>{product.name}</small></span><span>USD</span></button></li>)}</ul></aside>
      <MarketFactsPanel productId={productId} bars={factsBars} freshness={products.kind === 'ready' ? new Date(products.value.asOfMs).toISOString() : 'Unavailable'} onOpenAnalyst={() => setAnalystOpen(true)} />
    </div>
    <footer className="market-workstation-footer"><span>Coinbase display data · informational only</span><label><input type="checkbox" checked={workspace.preferences?.marketLiveCandle ?? false} onChange={(event) => void workspace.update({ marketLiveCandle: event.target.checked })} /> Show provisional candle</label><span>UTC</span></footer>
    {analystOpen && <AdvisorSheet client={client} productId={productId} bars={factsBars} onClose={() => setAnalystOpen(false)} />}
    {extensionsOpen && <ChartExtensionManager client={client} onClose={() => setExtensionsOpen(false)} />}
  </div>;
}
