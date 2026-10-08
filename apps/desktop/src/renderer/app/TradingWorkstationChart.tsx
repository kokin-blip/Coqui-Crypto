import { useEffect, useMemo, useRef, useState } from 'react';
import { createChartObservationCache } from './chart-observations.js';

import type { CoquiClient } from '@coqui/contracts';
import { CHART_COLORS } from '@coqui/ui-kit';
import {
  AreaSeries, BaselineSeries, CandlestickSeries, HistogramSeries,
  LineSeries, LineStyle, PriceScaleMode,
  type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type LineData, type Time,
} from 'lightweight-charts';

import type { ActivityAnnotation, ActivityPosition } from './TerminalActivity.js';
import { nearestBar } from './chart-bar-lookup.js';
import { ChartFrame } from './ChartFrame.js';
import { ChartEvidenceList } from './ChartEvidenceList.js';
import { chartPaperAnnotations } from './chart-paper-annotations.js';
import { ChartEventLabels } from './chart-event-labels.js';
import { groupChartEvidence } from './chart-evidence-groups.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';
import { ChartDrawingLayer, type DrawingShape } from './ChartDrawingLayer.js';
import { bindChartLink, createChartLifecycle, type ChartLifecycle } from './chart-lifecycle.js';
import type { ChartLinkController } from './chart-link-controller.js';
import { bollinger, ema, macd, rsi, sma } from './chart-indicators.js';
import type {
  ChartDrawing, DrawingTool, WorkstationBar,
  WorkstationChartStyle, WorkstationComparisonSeries, WorkstationExtensionMarker, WorkstationExtensionSeries,
  WorkstationIndicators, WorkstationScaleMode,
} from './chart-workstation-types.js';

type PriceSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> |
  ISeriesApi<'Area'> | ISeriesApi<'Baseline'>;

const EMPTY_MARKERS: readonly WorkstationExtensionMarker[] = Object.freeze([]);

const SCALE_MODE: Readonly<Record<WorkstationScaleMode, PriceScaleMode>> = {
  linear: PriceScaleMode.Normal,
  percentage: PriceScaleMode.Percentage,
  indexed: PriceScaleMode.IndexedTo100,
  logarithmic: PriceScaleMode.Logarithmic,
};

function timeOf(bar: WorkstationBar): Time {
  return Math.floor(bar.startTimeMs / 1_000) as Time;
}

export function TradingWorkstationChart({ bars, productId, style, scaleMode,
  volumeVisible, indicators, comparisons, extensionSeries, extensionMarkers, activeTool, drawings, onDrawing,
  client, position, pendingActions, height = 520, syncId, linkGroup, linkController }: {
  readonly pendingActions?: readonly ActivityAnnotation[];
  readonly position?: ActivityPosition | undefined;
  readonly bars: readonly WorkstationBar[];
  readonly productId: string;
  readonly style: WorkstationChartStyle;
  readonly scaleMode: WorkstationScaleMode;
  readonly volumeVisible: boolean;
  readonly indicators: WorkstationIndicators;
  readonly comparisons?: readonly WorkstationComparisonSeries[];
  readonly extensionSeries?: readonly WorkstationExtensionSeries[];
  readonly extensionMarkers?: readonly WorkstationExtensionMarker[];
  readonly activeTool: DrawingTool;
  readonly drawings: readonly ChartDrawing[];
  readonly onDrawing: (drawing: ChartDrawing) => void;
  readonly client: CoquiClient;
  readonly height?: number;
  readonly syncId: string;
  readonly linkGroup: string | null;
  readonly linkController: ChartLinkController;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const lifecycleRef = useRef<ChartLifecycle | null>(null);
  const savedRange = useRef<{ identity: string; range: { from: number; to: number } | null } | null>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const priceApi = useRef<PriceSeries | null>(null);
  const pendingPoint = useRef<{ timeMs: number; value: string } | null>(null);
  const suppressSync = useRef(false);
  const [cursorLabel, setCursorLabel] = useState<string | null>(null);
  const [observationCache] = useState(createChartObservationCache);
  const [drawingShapes, setDrawingShapes] = useState<readonly DrawingShape[]>([]);
  const paperAnnotations = useMemo(() => chartPaperAnnotations(position, pendingActions ?? []), [position, pendingActions]);
  const markers = useMemo(() => [...(extensionMarkers ?? EMPTY_MARKERS), ...paperAnnotations.markers], [extensionMarkers, paperAnnotations]);
  const groupedMarkers = useMemo(() => groupChartEvidence(bars, markers), [bars, markers]);
  const volumeApi = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerApi = useRef<ChartEventLabels | null>(null);
  const previousBars = useRef<readonly WorkstationBar[]>([]);
  const currentBars = useRef<readonly WorkstationBar[]>(bars);
  const currentDrawings = useRef(drawings);
  const redraw = useRef<() => void>(() => undefined);
  const interval = bars[0]?.interval;
  useEffect(() => { currentBars.current = bars; currentDrawings.current = drawings; });
  const completedBars = useMemo(() => bars.filter(bar => bar.isComplete), [bars]);
  const completedKey = useMemo(() => completedBars.map(bar => `${bar.startTimeMs}:${bar.close}`).join('|'), [completedBars]);
  const indicatorKey = JSON.stringify(indicators);


  useEffect(() => {
    if (container.current === null) return;
    const lifecycle = createChartLifecycle(container.current, { height,
      timeVisible: bars[0]?.interval !== '1d', priceScaleMode: SCALE_MODE[scaleMode] });
    lifecycleRef.current = lifecycle;
    const chart = lifecycle.chart;
    chartApi.current = chart;
    const price: PriceSeries = style === 'candles'
      ? chart.addSeries(CandlestickSeries, { upColor: CHART_COLORS.primary,
          downColor: CHART_COLORS.negative, borderVisible: false,
          wickUpColor: CHART_COLORS.primary, wickDownColor: CHART_COLORS.negative })
      : style === 'area'
        ? chart.addSeries(AreaSeries, { lineColor: CHART_COLORS.primary,
            topColor: 'rgb(46 233 139 / 30%)', bottomColor: 'rgb(46 233 139 / 2%)' })
        : style === 'baseline'
          ? chart.addSeries(BaselineSeries, { topLineColor: CHART_COLORS.primary,
              topFillColor1: 'rgb(46 233 139 / 22%)', topFillColor2: 'transparent',
              bottomLineColor: CHART_COLORS.negative, bottomFillColor1: 'transparent',
              bottomFillColor2: 'rgb(255 100 117 / 18%)' })
          : chart.addSeries(LineSeries, { color: CHART_COLORS.primary, lineWidth: 2 });
    priceApi.current = price;
    volumeApi.current = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' },
      priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
    volumeApi.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const eventLabels = new ChartEventLabels(container.current);
    price.attachPrimitive(eventLabels);
    markerApi.current = eventLabels;
    lifecycle.registerCleanup(() => price.detachPrimitive(eventLabels));
    previousBars.current = [];
    const updateDrawingShapes = (): void => {
      const width = container.current?.clientWidth ?? 0;
      const chartHeight = container.current?.clientHeight ?? height;
      const coordinate = (point: ChartDrawing['points'][number]): readonly [number, number] | null => {
        const x = chart.timeScale().timeToCoordinate(Math.floor(point.timeMs / 1_000) as Time);
        const y = price.priceToCoordinate(Number(point.value));
        return x === null || y === null ? null : [x, y];
      };
      const next: DrawingShape[] = [];
      for (const drawing of currentDrawings.current) {
        const first = drawing.points[0] === undefined ? null : coordinate(drawing.points[0]);
        const second = drawing.points[1] === undefined ? null : coordinate(drawing.points[1]);
        if (first === null) continue;
        if (drawing.kind === 'horizontal') next.push({ id: drawing.id, kind: 'line', x1: 0, y1: first[1], x2: width, y2: first[1], dashed: true });
        else if (drawing.kind === 'vertical') next.push({ id: drawing.id, kind: 'line', x1: first[0], y1: 0, x2: first[0], y2: chartHeight, dashed: true });
        else if (drawing.kind === 'text') next.push({ id: drawing.id, kind: 'text', x: first[0], y: first[1], text: drawing.label ?? 'Note' });
        else if (second !== null && drawing.kind === 'rectangle') next.push({ id: drawing.id, kind: 'rectangle', x: Math.min(first[0], second[0]), y: Math.min(first[1], second[1]), width: Math.abs(second[0] - first[0]), height: Math.abs(second[1] - first[1]) });
        else if (second !== null && drawing.kind === 'fibonacci') next.push({ id: drawing.id, kind: 'fibonacci', x1: first[0], x2: second[0], y1: first[1], y2: second[1] });
        else if (second !== null) {
          const x2 = drawing.kind === 'ray' ? width : second[0];
          const slope = (second[1] - first[1]) / Math.max(1, second[0] - first[0]);
          next.push({ id: drawing.id, kind: 'line', x1: first[0], y1: first[1], x2, y2: drawing.kind === 'ray' ? first[1] + slope * (x2 - first[0]) : second[1], dashed: drawing.kind === 'measure' });
        }
      }
      setDrawingShapes(next);
    };
    redraw.current = updateDrawingShapes;
    const publishLink = bindChartLink(lifecycle, {
      controller: linkController, group: linkGroup, sourceId: syncId,
      receive: (event) => {
        suppressSync.current = true;
        if (event.kind === 'range') {
          if (event.range !== null) chart.timeScale().setVisibleRange({
            from: Math.floor(event.range.fromTimeMs / 1_000) as Time,
            to: Math.floor(event.range.toTimeMs / 1_000) as Time,
          });
        } else if (event.timeMs === null) chart.clearCrosshairPosition();
        else {
          const nearest = nearestBar(currentBars.current, event.timeMs);
          if (nearest !== null) chart.setCrosshairPosition(Number(nearest.close), timeOf(nearest), price);
        }
        queueMicrotask(() => { suppressSync.current = false; });
      },
    });
    chart.subscribeCrosshairMove((parameter) => {
      if (parameter.time === undefined) {
        setCursorLabel(null);
        if (!suppressSync.current) publishLink({ kind: 'crosshair', timeMs: null });
        return;
      }
      const match = nearestBar(currentBars.current, Number(parameter.time) * 1_000);
      setCursorLabel(match === null ? String(parameter.time) :
        `${formatLocalTimestamp(match.startTimeMs)} · UTC ${exactUtcTimestamp(match.startTimeMs)} · O ${match.open} H ${match.high} L ${match.low} C ${match.close}${match.isComplete ? '' : ' · LIVE'}`);
      if (!suppressSync.current) publishLink({ kind: 'crosshair', timeMs: Number(parameter.time) * 1_000 });
    });
    updateDrawingShapes();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateDrawingShapes);
    const publishRange = (range: { readonly from: Time; readonly to: Time } | null): void => {
      if (suppressSync.current || linkGroup === null) return;
      publishLink({ kind: 'range', range: range === null ? null : {
        fromTimeMs: Number(range.from) * 1_000,
        toTimeMs: Number(range.to) * 1_000,
      } });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(publishRange);
    lifecycle.onResize(updateDrawingShapes);
    lifecycle.registerCleanup(() => chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateDrawingShapes));
    lifecycle.registerCleanup(() => chart.timeScale().unsubscribeVisibleTimeRangeChange(publishRange));
    return () => { savedRange.current = { identity: `${productId}:${interval}:${syncId}`, range: chart.timeScale().getVisibleLogicalRange() }; lifecycle.destroy(); lifecycleRef.current = null; chartApi.current = null; priceApi.current = null;
      volumeApi.current = null; markerApi.current = null; redraw.current = () => undefined; };
    // Data, overlays and options update below; only instrument/series identity owns the canvas.
  }, [productId, interval, style, linkController, linkGroup, syncId]);

  useEffect(() => {
    const chart = chartApi.current;
    const price = priceApi.current;
    if (chart === null || price === null) return;
    const prior = previousBars.current;
    const same = (a: WorkstationBar | undefined, b: WorkstationBar | undefined): boolean => a !== undefined && b !== undefined &&
      a.startTimeMs === b.startTimeMs && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
    const prefixUnchanged = prior.length > 0 && (bars.length === prior.length || bars.length === prior.length + 1) &&
      prior.slice(0, -1).every((bar, index) => same(bar, bars[index])) &&
      (bars.length === prior.length || same(prior.at(-1), bars[prior.length - 1]));
    const candle = (bar: WorkstationBar): CandlestickData<Time> => ({ time: timeOf(bar), open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close) });
    const line = (bar: WorkstationBar): LineData<Time> => ({ time: timeOf(bar), value: Number(bar.close) });
    const volume = (bar: WorkstationBar): HistogramData<Time> => ({ time: timeOf(bar), value: Number(bar.volume ?? 0), color: Number(bar.close) >= Number(bar.open) ? 'rgb(46 233 139 / 34%)' : 'rgb(255 100 117 / 34%)' });
    const last = bars.at(-1);
    if (prefixUnchanged && last !== undefined && prior.at(-1)?.startTimeMs === (bars.length === prior.length ? last.startTimeMs : bars.at(-2)?.startTimeMs)) {
      if (style === 'candles') (price as ISeriesApi<'Candlestick'>).update(candle(last));
      else (price as ISeriesApi<'Line'>).update(line(last));
      volumeApi.current?.update(volume(last));
    } else {
      if (style === 'candles') (price as ISeriesApi<'Candlestick'>).setData(bars.map(candle));
      else (price as ISeriesApi<'Line'>).setData(bars.map(line));
      volumeApi.current?.setData(bars.map(volume));
    }
    if (prior.length === 0) chart.timeScale().setVisibleLogicalRange(savedRange.current?.identity === `${productId}:${interval}:${syncId}` && savedRange.current.range !== null ? savedRange.current.range : { from: Math.max(0, bars.length - 120), to: bars.length + 4 });
    previousBars.current = bars;
    redraw.current();
  }, [bars, productId, interval, style, linkController, linkGroup, syncId]);

  useEffect(() => {
    lifecycleRef.current?.setHeight(height);
    chartApi.current?.applyOptions({ rightPriceScale: { mode: SCALE_MODE[scaleMode] } });
    volumeApi.current?.applyOptions({ visible: volumeVisible });
  }, [height, scaleMode, volumeVisible, productId, interval, style, linkController, linkGroup, syncId]);

  useEffect(() => {
    const chart = chartApi.current;
    if (chart === null) return;
    const seriesToRemove: ISeriesApi<'Line'>[] = [];
    const input = currentBars.current.filter((bar) => bar.isComplete).map((bar) => ({ day: String(timeOf(bar)), close: Number(bar.close) }));
    const addLine = (values: readonly { readonly day: string; readonly value: number }[], color: string, title: string, pane = 0) => {
      const series = chart.addSeries(LineSeries, { color, lineWidth: 1, title,
        priceLineVisible: false, lastValueVisible: false }, pane);
      seriesToRemove.push(series);
      series.setData(values.map((point) => ({ time: Number(point.day) as Time, value: point.value })));
    };
    if (indicators.sma20) addLine(sma(input, 20), CHART_COLORS.benchmark, 'SMA 20');
    if (indicators.sma50) addLine(sma(input, 50), '#f2b84b', 'SMA 50');
    if (indicators.ema20) addLine(ema(input, 20), '#8b7cff', 'EMA 20');
    if (indicators.bollinger20) {
      const bands = bollinger(input);
      addLine(bands.map(({ day, upper }) => ({ day, value: upper })), '#91a39a', 'BB upper');
      addLine(bands.map(({ day, lower }) => ({ day, value: lower })), '#91a39a', 'BB lower');
    }
    if (indicators.rsi14) addLine(rsi(input), '#8b7cff', 'RSI 14', 1);
    if (indicators.macd) {
      const values = macd(input); const pane = indicators.rsi14 ? 2 : 1;
      addLine(values, CHART_COLORS.primary, 'MACD', pane);
      addLine(values.map(({ day, signal }) => ({ day, value: signal })), '#f2b84b', 'Signal', pane);
    }
    const comparisonColors = [CHART_COLORS.benchmark, '#f2b84b', '#57a8ff'] as const;
    for (const [index, comparison] of (comparisons ?? []).entries()) {
      addLine(comparison.points.map((point) => ({
        day: String(Math.floor(point.timeMs / 1_000)), value: Number(point.value),
      })), comparisonColors[index % comparisonColors.length]!, comparison.productId);
    }
    for (const series of extensionSeries ?? []) {
      addLine(series.points.map((point) => ({ day: String(Math.floor(point.timeMs / 1_000)), value: Number(point.value) })), series.color, series.title, series.pane);
    }

    return () => { if (chartApi.current === chart) for (const series of seriesToRemove) chart.removeSeries(series); };
  }, [completedKey, indicatorKey, comparisons, extensionSeries, productId, interval, style, linkController, linkGroup, syncId]);

  useEffect(() => {
    markerApi.current?.update(groupedMarkers, bars);
  }, [groupedMarkers, bars, productId, interval, style, linkController, linkGroup, syncId]);
  useEffect(() => { redraw.current(); }, [drawings, position]);
  useEffect(() => {
    const price = priceApi.current;
    if (price === null || position?.status !== 'holding' || position.averageEntryUsd === null) return;
    const line = price.createPriceLine({ price: Number(position.averageEntryUsd), color: position.unrealizedPnlUsd === null ? CHART_COLORS.supportingText : Number(position.unrealizedPnlUsd) < 0 ? CHART_COLORS.negative : CHART_COLORS.primary,
      lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
    return () => { if (priceApi.current === price) price.removePriceLine(line); };
  }, [position?.status, position?.averageEntryUsd, position?.unrealizedPnlUsd, productId, interval, style, linkController, linkGroup, syncId]);

  const capturePoint = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activeTool === 'cursor' || chartApi.current === null || priceApi.current === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const time = chartApi.current.timeScale().coordinateToTime(event.clientX - bounds.left);
    const value = priceApi.current.coordinateToPrice(event.clientY - bounds.top);
    if (time === null || value === null) return;
    const point = { timeMs: Number(time) * 1_000, value: String(value) };
    const onePoint = activeTool === 'horizontal' || activeTool === 'vertical' || activeTool === 'text';
    if (onePoint || pendingPoint.current !== null) {
      onDrawing({ id: crypto.randomUUID(), kind: activeTool,
        points: onePoint ? [point] : [pendingPoint.current!, point],
        label: activeTool === 'text' ? 'Note' : null });
      pendingPoint.current = null;
    } else pendingPoint.current = point;
  };
  const snapshot = async (): Promise<void> => {
    const png = chartApi.current?.takeScreenshot().toDataURL('image/png').split(',')[1];
    if (png !== undefined) await client.query('app.chart.snapshot.save', {
      commandId: crypto.randomUUID(), filenameStem: `coqui-${productId.toLowerCase()}`, pngBase64: png,
    });
  };
  const observations = useMemo(() => observationCache(bars), [bars, observationCache]);
  return <><div className={`workstation-chart-host tool-${activeTool}`} onPointerDown={capturePoint}>
    <ChartFrame className="trading-workstation-chart" containerRef={container}
      observations={observations} summary={`${bars.length} Coinbase ${bars[0]?.interval ?? ''} observations for ${productId}. Provisional bars are display only.`}
      cursorLabel={cursorLabel} onSnapshot={snapshot} />
    <ChartDrawingLayer shapes={drawingShapes} />
  </div>{paperAnnotations.notes.length > 0 && <div className="chart-paper-notes">{paperAnnotations.notes.map(note => <p key={note}>{note}</p>)}</div>}<ChartEvidenceList bars={bars} items={markers} /></>;
}
