import { useEffect, useRef } from 'react';

import type { ChannelResponse } from '@coqui/contracts';
import { CHART_COLORS } from '@coqui/ui-kit';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from 'lightweight-charts';

type MarketBar = ChannelResponse<'market-data.candles'>['bars'][number];

export function MarketHistoryChart({ bars, mode, productId }: {
  readonly bars: readonly MarketBar[];
  readonly mode: 'candles' | 'line';
  readonly productId: string;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (container.current === null) return;
    const chart = createChart(container.current, {
      height: 390,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: CHART_COLORS.supportingText,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      timeScale: { borderColor: CHART_COLORS.border },
      rightPriceScale: { borderColor: CHART_COLORS.border },
    });
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
    volume.setData(volumes);
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [bars, mode]);

  return (
    <figure className="market-history-chart">
      <div ref={container} aria-hidden="true" />
      <figcaption className="sr-only">
        {bars.length} completed Coinbase daily {mode === 'candles' ? 'candles' : 'closing prices'} for {productId}, with recorded volume where available.
      </figcaption>
    </figure>
  );
}
