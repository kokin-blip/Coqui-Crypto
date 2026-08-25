import { useEffect, useRef } from 'react';

import {
  ColorType,
  LineSeries,
  createChart,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import { CHART_COLORS } from '@coqui/ui-kit';

export interface FinancialChartSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly { readonly day: string; readonly value: number }[];
}

export function FinancialChart({
  series,
  summary,
}: {
  readonly series: readonly FinancialChartSeries[];
  readonly summary: string;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const apis = useRef(new Map<string, ISeriesApi<'Line'>>());
  const priorLengths = useRef(new Map<string, number>());

  useEffect(() => {
    if (container.current === null) return;
    const chart = createChart(container.current, {
      height: 300,
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
      handleScroll: true,
      handleScale: true,
    });
    for (const definition of series) {
      apis.current.set(definition.id, chart.addSeries(LineSeries, {
        color: definition.color,
        lineWidth: 2,
        title: definition.label,
        priceLineVisible: false,
        lastValueVisible: true,
      }));
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      apis.current.clear();
      priorLengths.current.clear();
      chart.remove();
    };
    // Series identities are fixed by each chart surface; values update below.
  }, []);

  useEffect(() => {
    for (const definition of series) {
      const api = apis.current.get(definition.id);
      if (api === undefined) continue;
      const data: LineData<Time>[] = definition.values.map((point) => ({
        time: point.day as Time,
        value: point.value,
      }));
      const prior = priorLengths.current.get(definition.id) ?? 0;
      if (data.length === prior + 1 && prior > 0) api.update(data.at(-1)!);
      else api.setData(data);
      priorLengths.current.set(definition.id, data.length);
    }
  }, [series]);

  return (
    <figure className="financial-chart">
      <div ref={container} aria-hidden="true" />
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
