import { useEffect, useRef, useState } from 'react';

import {
  AreaSeries,
  BaselineSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import { CHART_COLORS } from '@coqui/ui-kit';
import type { CoquiClient } from '@coqui/contracts';
import { ChartFrame } from './ChartFrame.js';
import { createChartLifecycle, syncSeriesData, type SeriesCursor } from './chart-lifecycle.js';

export interface FinancialChartSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly { readonly day: string; readonly value: number }[];
}

export function FinancialChart({
  series,
  summary,
  style = 'line',
  client,
  filenameStem = 'coqui-chart',
}: {
  readonly series: readonly FinancialChartSeries[];
  readonly summary: string;
  readonly style?: 'line' | 'area' | 'baseline';
  readonly client?: CoquiClient;
  readonly filenameStem?: string;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const apis = useRef(new Map<string, ISeriesApi<'Line'>>());
  const seriesCursors = useRef(new Map<string, SeriesCursor>());
  const chartApi = useRef<IChartApi | null>(null);
  const [cursorLabel, setCursorLabel] = useState<string | null>(null);

  useEffect(() => {
    if (container.current === null) return;
    const lifecycle = createChartLifecycle(container.current, { height: 300 });
    const chart = lifecycle.chart;
    chartApi.current = chart;
    for (const definition of series) {
      const shared = { lineWidth: 2 as const, title: definition.label, priceLineVisible: false, lastValueVisible: true };
      const api = style === 'area' ? chart.addSeries(AreaSeries, {
        ...shared, lineColor: definition.color, topColor: `${definition.color}55`, bottomColor: `${definition.color}05`,
      }) : style === 'baseline' ? chart.addSeries(BaselineSeries, {
        ...shared, topLineColor: definition.color, topFillColor1: `${definition.color}55`, topFillColor2: `${definition.color}05`,
        bottomLineColor: CHART_COLORS.negative, bottomFillColor1: 'rgb(255 107 122 / 5%)', bottomFillColor2: 'rgb(255 107 122 / 32%)',
      }) : chart.addSeries(LineSeries, { ...shared, color: definition.color });
      apis.current.set(definition.id, api as ISeriesApi<'Line'>);
    }
    chart.subscribeCrosshairMove((parameter) => {
      if (parameter.time === undefined) { setCursorLabel(null); return; }
      const values = series.flatMap((definition) => {
        const api = apis.current.get(definition.id);
        const point = api === undefined ? undefined : parameter.seriesData.get(api) as { value?: number } | undefined;
        return point?.value === undefined ? [] : [`${definition.label} ${point.value.toLocaleString()}`];
      });
      setCursorLabel(`${String(parameter.time)}${values.length === 0 ? '' : ` · ${values.join(' · ')}`}`);
    });
    return () => {
      apis.current.clear();
      seriesCursors.current.clear();
      lifecycle.destroy();
      chartApi.current = null;
    };
    // Series identities are fixed by each chart surface; values update below.
  }, [style]);

  useEffect(() => {
    for (const definition of series) {
      const api = apis.current.get(definition.id);
      if (api === undefined) continue;
      const data: LineData<Time>[] = definition.values.map((point) => ({
        time: point.day as Time,
        value: point.value,
      }));
      seriesCursors.current.set(definition.id,
        syncSeriesData(api, data, seriesCursors.current.get(definition.id)));
    }
  }, [series]);

  const observations = series[0]?.values.map((point) => ({ day: point.day, label: `${point.day}: ${point.value.toLocaleString()}` })) ?? [];
  const snapshot = client === undefined ? undefined : async (): Promise<void> => {
    const png = chartApi.current?.takeScreenshot().toDataURL('image/png').split(',')[1];
    if (png === undefined) return;
    await client.query('app.chart.snapshot.save', { commandId: crypto.randomUUID(), filenameStem, pngBase64: png });
  };
  return <ChartFrame className="financial-chart" containerRef={container} observations={observations} summary={summary} cursorLabel={cursorLabel} {...(snapshot === undefined ? {} : { onSnapshot: snapshot })} />;
}
