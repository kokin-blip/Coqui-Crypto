import { useEffect, useRef, useState } from 'react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { CHART_COLORS } from '@coqui/ui-kit';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type LineData,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { bollinger, ema, macd, rsi, sma } from './chart-indicators.js';
import { createChartLifecycle } from './chart-lifecycle.js';
import { ChartFrame } from './ChartFrame.js';

type MarketBar = ChannelResponse<'market-data.candles'>['bars'][number];
export interface EvidenceChartMarker {
  readonly id: string;
  readonly label: string;
  readonly atMs: number;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'warning';
}

export function MarketHistoryChart({ bars, mode, productId, volumeVisible = true, indicators, client,
  decisionMarkers = [] }: {
  readonly bars: readonly MarketBar[];
  readonly mode: 'candles' | 'line';
  readonly productId: string;
  readonly volumeVisible?: boolean;
  readonly indicators?: {
    readonly sma20: boolean; readonly sma50: boolean; readonly ema20: boolean;
    readonly bollinger20: boolean; readonly rsi14: boolean; readonly macd: boolean;
  };
  readonly client?: CoquiClient;
  readonly decisionMarkers?: readonly EvidenceChartMarker[];
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const [cursorLabel, setCursorLabel] = useState<string | null>(null);

  useEffect(() => {
    if (container.current === null) return;
    const lifecycle = createChartLifecycle(container.current, { height: 390 });
    const chart = lifecycle.chart;
    chartApi.current = chart;
    const price = mode === 'candles'
      ? chart.addSeries(CandlestickSeries, {
        upColor: CHART_COLORS.primary,
        downColor: CHART_COLORS.negative,
        borderUpColor: CHART_COLORS.primary,
        borderDownColor: CHART_COLORS.negative,
        wickUpColor: CHART_COLORS.primary,
        wickDownColor: CHART_COLORS.negative,
      })
      : chart.addSeries(LineSeries, {
        color: CHART_COLORS.primary,
        lineWidth: 2,
        priceLineVisible: false,
      });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    if (mode === 'candles') {
      const values: CandlestickData<Time>[] = bars.map((bar) => ({
        time: new Date(bar.startTimeMs).toISOString().slice(0, 10) as Time,
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      }));
      price.setData(values);
    } else {
      const values: LineData<Time>[] = bars.map((bar) => ({
        time: new Date(bar.startTimeMs).toISOString().slice(0, 10) as Time,
        value: bar.close,
      }));
      price.setData(values);
    }
    const volumes: HistogramData<Time>[] = bars.flatMap((bar) => bar.volume === null ? [] : [{
      time: new Date(bar.startTimeMs).toISOString().slice(0, 10) as Time,
      value: bar.volume,
      color: bar.close >= bar.open ? 'rgb(67 224 138 / 36%)' : 'rgb(255 107 122 / 36%)',
    }]);
    if (volumeVisible !== false) volume.setData(volumes);
    const input = bars.map((bar) => ({ day: new Date(bar.startTimeMs).toISOString().slice(0, 10), close: bar.close }));
    const addLine = (values: readonly { readonly day: string; readonly value: number }[], color: string, title: string, pane = 0) => {
      const series = chart.addSeries(LineSeries, { color, lineWidth: 1, title, priceLineVisible: false, lastValueVisible: false }, pane);
      series.setData(values.map((point) => ({ time: point.day as Time, value: point.value })));
    };
    if (indicators?.sma20 === true) addLine(sma(input, 20), CHART_COLORS.benchmark, 'SMA 20');
    if (indicators?.sma50 === true) addLine(sma(input, 50), '#f2b84b', 'SMA 50');
    if (indicators?.ema20 === true) addLine(ema(input, 20), '#8b7cff', 'EMA 20');
    if (indicators?.bollinger20 === true) {
      const bands = bollinger(input);
      addLine(bands.map(({ day, upper }) => ({ day, value: upper })), '#91a39a', 'Bollinger upper');
      addLine(bands.map(({ day, lower }) => ({ day, value: lower })), '#91a39a', 'Bollinger lower');
    }
    if (indicators?.rsi14 === true) addLine(rsi(input), '#8b7cff', 'RSI 14', 1);
    if (indicators?.macd === true) {
      const values = macd(input);
      const pane = indicators.rsi14 ? 2 : 1;
      addLine(values, CHART_COLORS.primary, 'MACD', pane);
      addLine(values.map(({ day, signal }) => ({ day, value: signal })), '#f2b84b', 'Signal', pane);
    }
    if (decisionMarkers.length > 0) {
      const colors = { neutral: CHART_COLORS.supportingText, positive: CHART_COLORS.primary,
        negative: CHART_COLORS.negative, warning: '#f2b84b' } as const;
      createSeriesMarkers(price, decisionMarkers.map((marker): SeriesMarker<Time> => ({
        time: new Date(marker.atMs).toISOString().slice(0, 10) as Time,
        position: 'aboveBar', shape: marker.tone === 'positive' ? 'arrowUp' : marker.tone === 'negative' ? 'arrowDown' : 'circle',
        color: colors[marker.tone], text: marker.label,
      })));
    }
    chart.subscribeCrosshairMove((parameter) => {
      if (parameter.time === undefined) { setCursorLabel(null); return; }
      const bar = bars.find((item) => new Date(item.startTimeMs).toISOString().slice(0, 10) === String(parameter.time));
      setCursorLabel(bar === undefined ? String(parameter.time) : `${String(parameter.time)} · O ${bar.open} H ${bar.high} L ${bar.low} C ${bar.close}`);
    });
    chart.timeScale().fitContent();
    return () => { lifecycle.destroy(); chartApi.current = null; };
  }, [bars, decisionMarkers, indicators, mode, volumeVisible]);

  const summary = `${bars.length} completed Coinbase daily ${mode === 'candles' ? 'candles' : 'closing prices'} for ${productId}, with recorded volume where available.`;
  const observations = bars.map((bar) => ({ day: new Date(bar.startTimeMs).toISOString().slice(0, 10), label: `${new Date(bar.startTimeMs).toISOString().slice(0, 10)}: close ${bar.close}` }));
  const snapshot = client === undefined ? undefined : async (): Promise<void> => {
    const png = chartApi.current?.takeScreenshot().toDataURL('image/png').split(',')[1];
    if (png === undefined) return;
    await client.query('app.chart.snapshot.save', { commandId: crypto.randomUUID(), filenameStem: `coqui-${productId.toLowerCase()}`, pngBase64: png });
  };
  return <ChartFrame className="market-history-chart" containerRef={container} observations={observations} summary={summary} cursorLabel={cursorLabel} {...(snapshot === undefined ? {} : { onSnapshot: snapshot })} />;
}
