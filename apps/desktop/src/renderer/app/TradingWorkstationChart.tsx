import { useEffect, useRef, useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { CHART_COLORS } from '@coqui/ui-kit';
import {
  AreaSeries, BaselineSeries, CandlestickSeries, ColorType, HistogramSeries,
  LineSeries, PriceScaleMode, createChart,
  type CandlestickData, type HistogramData, type ISeriesApi, type LineData, type Time,
} from 'lightweight-charts';

import { ChartFrame } from './ChartFrame.js';
import { ChartDrawingLayer, type DrawingShape } from './ChartDrawingLayer.js';
import type { ChartLinkController } from './chart-link-controller.js';
import { bollinger, ema, macd, rsi, sma } from './chart-indicators.js';
import type {
  ChartDrawing, DrawingTool, WorkstationBar,
  WorkstationChartStyle, WorkstationComparisonSeries, WorkstationExtensionSeries,
  WorkstationIndicators, WorkstationScaleMode,
} from './chart-workstation-types.js';

type PriceSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> |
  ISeriesApi<'Area'> | ISeriesApi<'Baseline'>;

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
  volumeVisible, indicators, comparisons, extensionSeries, activeTool, drawings, onDrawing,
  client, height = 520, syncId, linkGroup, linkController }: {
  readonly bars: readonly WorkstationBar[];
  readonly productId: string;
  readonly style: WorkstationChartStyle;
  readonly scaleMode: WorkstationScaleMode;
  readonly volumeVisible: boolean;
  readonly indicators: WorkstationIndicators;
  readonly comparisons?: readonly WorkstationComparisonSeries[];
  readonly extensionSeries?: readonly WorkstationExtensionSeries[];
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
  const chartApi = useRef<ReturnType<typeof createChart> | null>(null);
  const priceApi = useRef<PriceSeries | null>(null);
  const pendingPoint = useRef<{ timeMs: number; value: string } | null>(null);
  const suppressSync = useRef(false);
  const [cursorLabel, setCursorLabel] = useState<string | null>(null);
  const [drawingShapes, setDrawingShapes] = useState<readonly DrawingShape[]>([]);

  useEffect(() => {
    if (container.current === null) return;
    const chart = createChart(container.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' },
        textColor: CHART_COLORS.supportingText, attributionLogo: false },
      grid: { vertLines: { color: CHART_COLORS.grid }, horzLines: { color: CHART_COLORS.grid } },
      timeScale: { borderColor: CHART_COLORS.border, timeVisible: bars[0]?.interval !== '1d', secondsVisible: false },
      rightPriceScale: { borderColor: CHART_COLORS.border, mode: SCALE_MODE[scaleMode] },
      crosshair: { vertLine: { color: CHART_COLORS.supportingText }, horzLine: { color: CHART_COLORS.supportingText } },
    });
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
    if (style === 'candles') (price as ISeriesApi<'Candlestick'>).setData(bars.map((bar): CandlestickData<Time> => ({
      time: timeOf(bar), open: Number(bar.open), high: Number(bar.high),
      low: Number(bar.low), close: Number(bar.close),
    })));
    else (price as ISeriesApi<'Line'>).setData(bars.map((bar): LineData<Time> => ({
      time: timeOf(bar), value: Number(bar.close),
    })));
    if (volumeVisible) {
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' },
        priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(bars.flatMap((bar): HistogramData<Time>[] => bar.volume === null ? [] : [{
        time: timeOf(bar), value: Number(bar.volume),
        color: Number(bar.close) >= Number(bar.open) ? 'rgb(46 233 139 / 34%)' : 'rgb(255 100 117 / 34%)',
      }]));
    }
    const input = bars.filter((bar) => bar.isComplete).map((bar) => ({ day: String(timeOf(bar)), close: Number(bar.close) }));
    const addLine = (values: readonly { readonly day: string; readonly value: number }[], color: string, title: string, pane = 0) => {
      const series = chart.addSeries(LineSeries, { color, lineWidth: 1, title,
        priceLineVisible: false, lastValueVisible: false }, pane);
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
    const updateDrawingShapes = (): void => {
      const width = container.current?.clientWidth ?? 0;
      const chartHeight = container.current?.clientHeight ?? height;
      const coordinate = (point: ChartDrawing['points'][number]): readonly [number, number] | null => {
        const x = chart.timeScale().timeToCoordinate(Math.floor(point.timeMs / 1_000) as Time);
        const y = price.priceToCoordinate(Number(point.value));
        return x === null || y === null ? null : [x, y];
      };
      const next: DrawingShape[] = [];
      for (const drawing of drawings) {
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
    chart.subscribeCrosshairMove((parameter) => {
      if (parameter.time === undefined) {
        setCursorLabel(null);
        if (!suppressSync.current && linkGroup !== null) linkController.publish(linkGroup, { kind: 'crosshair', sourceId: syncId, timeMs: null });
        return;
      }
      const match = bars.find((bar) => Number(timeOf(bar)) === Number(parameter.time));
      setCursorLabel(match === undefined ? String(parameter.time) :
        `${new Date(match.startTimeMs).toISOString()} · O ${match.open} H ${match.high} L ${match.low} C ${match.close}${match.isComplete ? '' : ' · LIVE'}`);
      if (!suppressSync.current && linkGroup !== null) linkController.publish(linkGroup, { kind: 'crosshair', sourceId: syncId, timeMs: Number(parameter.time) * 1_000 });
    });
    chart.timeScale().fitContent();
    updateDrawingShapes();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateDrawingShapes);
    const publishRange = (range: { readonly from: Time; readonly to: Time } | null): void => {
      if (suppressSync.current || linkGroup === null) return;
      linkController.publish(linkGroup, { kind: 'range', sourceId: syncId, range: range === null ? null : {
        fromTimeMs: Number(range.from) * 1_000,
        toTimeMs: Number(range.to) * 1_000,
      } });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(publishRange);
    const unsubscribeLink = linkGroup === null ? () => undefined : linkController.subscribe(linkGroup, (event) => {
      if (event.sourceId === syncId) return;
      suppressSync.current = true;
      if (event.kind === 'range') {
        if (event.range !== null) chart.timeScale().setVisibleRange({
          from: Math.floor(event.range.fromTimeMs / 1_000) as Time,
          to: Math.floor(event.range.toTimeMs / 1_000) as Time,
        });
      } else if (event.timeMs === null) chart.clearCrosshairPosition();
      else {
        const nearest = bars.reduce<WorkstationBar | null>((best, bar) =>
          best === null || Math.abs(bar.startTimeMs - event.timeMs!) < Math.abs(best.startTimeMs - event.timeMs!) ? bar : best, null);
        if (nearest !== null) chart.setCrosshairPosition(Number(nearest.close), timeOf(nearest), price);
      }
      queueMicrotask(() => { suppressSync.current = false; });
    });
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) { chart.applyOptions({ width: Math.floor(entry.contentRect.width) }); updateDrawingShapes(); }
    });
    observer.observe(container.current);
    return () => { unsubscribeLink(); observer.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateDrawingShapes); chart.timeScale().unsubscribeVisibleTimeRangeChange(publishRange); chart.remove(); chartApi.current = null; priceApi.current = null; };
  }, [bars, comparisons, drawings, extensionSeries, height, indicators, linkController, linkGroup, scaleMode, style, syncId, volumeVisible]);

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
  const observations = bars.map((bar) => ({ day: String(bar.startTimeMs),
    label: `${new Date(bar.startTimeMs).toISOString()}: close ${bar.close}${bar.isComplete ? '' : ', live candle'}` }));
  return <div className={`workstation-chart-host tool-${activeTool}`} onPointerDown={capturePoint}>
    <ChartFrame className="trading-workstation-chart" containerRef={container}
      observations={observations} summary={`${bars.length} Coinbase ${bars[0]?.interval ?? ''} observations for ${productId}. Provisional bars are display only.`}
      cursorLabel={cursorLabel} onSnapshot={snapshot} />
    <ChartDrawingLayer shapes={drawingShapes} />
  </div>;
}
