import { CHART_COLORS } from '@coqui/ui-kit';
import {
  ColorType,
  createChart,
  type IChartApi,
  type PriceScaleMode,
  type Time,
} from 'lightweight-charts';

import type { ChartLinkController, ChartLinkEvent } from './chart-link-controller.js';

export interface ChartLifecycleOptions {
  readonly height: number;
  readonly timeVisible?: boolean;
  readonly priceScaleMode?: PriceScaleMode;
  readonly onResize?: () => void;
}

export interface ChartLifecycle {
  readonly chart: IChartApi;
  readonly reducedMotion: boolean;
  registerCleanup(cleanup: () => void): void;
  onResize(listener: () => void): void;
  destroy(): void;
}

function motionIsReduced(): boolean {
  const preference = document.documentElement.dataset['motion'];
  return preference === 'reduced' || preference === 'none' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Shared ownership boundary for every Lightweight Charts instance.
 *
 * Feature charts still decide which series they compose. This layer owns the
 * renderer-wide theme, resize observer, reduced-motion behavior and teardown.
 */
export function createChartLifecycle(
  container: HTMLDivElement,
  options: ChartLifecycleOptions,
): ChartLifecycle {
  const reducedMotion = motionIsReduced();
  const chart = createChart(container, {
    height: options.height,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: CHART_COLORS.supportingText,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: CHART_COLORS.grid },
      horzLines: { color: CHART_COLORS.grid },
    },
    timeScale: {
      borderColor: CHART_COLORS.border,
      timeVisible: options.timeVisible ?? false,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: CHART_COLORS.border,
      ...(options.priceScaleMode === undefined ? {} : { mode: options.priceScaleMode }),
    },
    crosshair: {
      vertLine: { color: CHART_COLORS.supportingText },
      horzLine: { color: CHART_COLORS.supportingText },
    },
    kineticScroll: { mouse: !reducedMotion, touch: !reducedMotion },
  });
  const cleanups: Array<() => void> = [];
  const resizeListeners = new Set<() => void>();
  let destroyed = false;
  const observer = new ResizeObserver(([entry]) => {
    if (entry === undefined || destroyed) return;
    chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    options.onResize?.();
    for (const listener of resizeListeners) listener();
  });
  observer.observe(container);
  return {
    chart,
    reducedMotion,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    onResize(listener) { resizeListeners.add(listener); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      resizeListeners.clear();
      for (const cleanup of cleanups.reverse()) cleanup();
      chart.remove();
    },
  };
}

export interface IncrementalSeries<T> {
  setData(data: T[]): void;
  update(point: T): void;
}

export interface SeriesCursor {
  readonly length: number;
  readonly lastTime: Time | null;
}

/** Append a single new point when possible; replace when history changed. */
export function syncSeriesData<T extends { readonly time: Time }>(
  series: IncrementalSeries<T>,
  data: readonly T[],
  prior: SeriesCursor | undefined,
): SeriesCursor {
  const latest = data.at(-1);
  if (latest !== undefined && prior !== undefined && data.length === prior.length + 1 &&
      prior.lastTime === data.at(-2)?.time) {
    series.update(latest);
  } else {
    series.setData([...data]);
  }
  return { length: data.length, lastTime: latest?.time ?? null };
}

export function bindChartLink(
  lifecycle: ChartLifecycle,
  input: {
    readonly controller: ChartLinkController;
    readonly group: string | null;
    readonly sourceId: string;
    readonly receive: (event: ChartLinkEvent) => void;
  },
): (event: { readonly kind: 'crosshair'; readonly timeMs: number | null } |
  { readonly kind: 'range'; readonly range: { readonly fromTimeMs: number; readonly toTimeMs: number } | null }) => void {
  if (input.group === null) return () => undefined;
  const unsubscribe = input.controller.subscribe(input.group, (event) => {
    if (event.sourceId !== input.sourceId) input.receive(event);
  });
  lifecycle.registerCleanup(unsubscribe);
  return (event) => input.controller.publish(input.group!, { ...event, sourceId: input.sourceId } as ChartLinkEvent);
}
