import { chartHistoryRange } from './chart-history-range.js';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';
import { useChartExtensionSeries } from './use-chart-extension-series.js';
import { useComparisonSeries } from './use-comparison-series.js';
import { ChartDrawingManager } from './ChartDrawingManager.js';
import { TradingWorkstationChart } from './TradingWorkstationChart.js';
import { routeHash } from './routes.js';
import type { ChartLinkController } from './chart-link-controller.js';
import type { ActivityAnnotation, ActivityPosition } from './TerminalActivity.js';
import type { ChartDrawing, ChartTileConfiguration, DrawingTool, WorkstationBar, WorkstationChartStyle, WorkstationExtensionMarker, WorkstationIndicators } from './chart-workstation-types.js';

const EMPTY_BARS: readonly WorkstationBar[] = [];

export function ChartTile({ client, tile, tileId, layoutId, style, activeTool, height,
  indicators, scaleMode, volumeVisible, liveVisible, extensionIds, linkController,
  decisionMarkers, position, pendingActions, historyAnchor, active, onDrawing, onDeleteDrawing }: {
  readonly pendingActions: readonly ActivityAnnotation[];
  readonly position: ActivityPosition | undefined;
  readonly historyAnchor: number; readonly active: boolean;
  readonly client: CoquiClient; readonly tile: ChartTileConfiguration; readonly tileId: string;
  readonly layoutId: string | null; readonly style: WorkstationChartStyle;
  readonly activeTool: DrawingTool; readonly height: number; readonly indicators: WorkstationIndicators;
  readonly scaleMode: 'linear' | 'percentage' | 'indexed' | 'logarithmic';
  readonly volumeVisible: boolean; readonly liveVisible: boolean; readonly extensionIds: readonly string[];
  readonly linkController: ChartLinkController; readonly onDrawing: (drawing: ChartDrawing) => void;
  readonly decisionMarkers: readonly WorkstationExtensionMarker[];
  readonly onDeleteDrawing: (id: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const range = chartHistoryRange(tile.interval, historyAnchor);
  const history = useChannel(client, 'market-data.display-bars', {
    productId: tile.productId, interval: tile.interval,
    ...range,
  });
  const live = useChannel(client, 'market-data.live-candles', { productIds: [tile.productId], interval: tile.interval }, active && liveVisible);
  const chartWorkspace = useChannel(client, 'app.chart.workspace', { productId: tile.productId, interval: tile.interval });
  const historyBars = history.kind === 'ready' ? history.value.bars : undefined;
  const liveCandle = live.kind === 'ready' ? live.value.candles[0] : undefined;
  const bars = useMemo<readonly WorkstationBar[]>(() => {
    const completed = historyBars ?? [];
    if (!liveVisible) return completed;
    const provisional = liveCandle;
    return provisional === undefined ? completed : [...completed, provisional];
  }, [historyBars, liveCandle, liveVisible, active]);
  // Provisional candle updates must not rebuild the immutable extension input.
  const extensionState = useChartExtensionSeries(client, extensionIds, historyBars ?? EMPTY_BARS);
  const comparisons = useComparisonSeries(client, tile.compareProductIds, tile.interval,
    range.startTimeMs, range.endTimeMs);
  const savedDrawings = chartWorkspace.kind === 'ready' ? chartWorkspace.value.drawings : undefined;
  const drawings = useMemo<readonly ChartDrawing[]>(() => savedDrawings !== undefined
    ? savedDrawings.filter((drawing) => drawing.layoutId === null || drawing.layoutId === layoutId)
      .map((drawing) => ({ id: drawing.id, kind: drawing.kind, points: drawing.points, label: drawing.label }))
    : [], [savedDrawings, layoutId]);
  const markers = useMemo(() => [...extensionState.markers, ...decisionMarkers], [extensionState.markers, decisionMarkers]);
  if (history.kind === 'loading') return <div className="workstation-chart-loading workstation-chart-empty" role="status"><strong>Loading completed candles</strong><span>Reading completed Coinbase display history for {tile.productId}.</span></div>;
  const retry = (): void => { void queryClient.invalidateQueries({ queryKey: ['market-data.display-bars'] }); };
  if (history.kind !== 'ready') return <div className="workstation-chart-empty"><strong>Chart unavailable</strong><span>Coinbase history could not be loaded. No substitute source was used.</span><div><button type="button" onClick={retry}>Refresh history</button><a href={routeHash('settings')}>Open connections</a></div></div>;
  if (bars.length === 0) return <div className="workstation-chart-empty"><strong>No completed candles</strong><span>Try a longer interval or refresh the completed-bar history.</span><div><button type="button" onClick={retry}>Refresh history</button><a href={routeHash('settings')}>Open connections</a></div></div>;
  return <div className="chart-render-stack">
    {extensionState.kind === 'loading' && <span className="chart-extension-state">Evaluating extensions…</span>}
    {extensionState.failedCount > 0 && <span className="chart-extension-state warning">{extensionState.failedCount} extension{extensionState.failedCount === 1 ? '' : 's'} unavailable</span>}
    {comparisons.loading && <span className="chart-comparison-state">Loading comparisons…</span>}
    {comparisons.failedCount > 0 && <span className="chart-comparison-state warning">{comparisons.failedCount} comparison{comparisons.failedCount === 1 ? '' : 's'} unavailable</span>}
    <TradingWorkstationChart client={client} bars={bars} productId={tile.productId}
      style={style} scaleMode={scaleMode} volumeVisible={volumeVisible} indicators={indicators}
      comparisons={comparisons.series}
      extensionSeries={extensionState.series} extensionMarkers={markers} activeTool={activeTool} drawings={drawings}
      onDrawing={onDrawing} height={height} syncId={tileId} linkGroup={tile.linkGroup}
      linkController={linkController} position={position} pendingActions={pendingActions} />
    <ChartDrawingManager drawings={drawings} onSave={onDrawing} onDelete={onDeleteDrawing} />
  </div>;
}
