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
  setHeight(height: number): void;
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
  const colors = (): { text: string; grid: string; border: string } => {
    const style = getComputedStyle(container);
    return { text: style.getPropertyValue('--coqui-text-muted').trim() || CHART_COLORS.supportingText,
      grid: style.getPropertyValue('--coqui-border').trim() || CHART_COLORS.grid,
      border: style.getPropertyValue('--coqui-border').trim() || CHART_COLORS.border };
  };
  const palette = colors();
  const chart = createChart(container, {
    height: options.height,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: palette.text,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    timeScale: {
      borderColor: palette.border,
      timeVisible: options.timeVisible ?? false,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: palette.border,
      ...(options.priceScaleMode === undefined ? {} : { mode: options.priceScaleMode }),
    },
    crosshair: {
      vertLine: { color: palette.text },
      horzLine: { color: palette.text },
    },
    kineticScroll: { mouse: !reducedMotion, touch: !reducedMotion },
  });
  const themeObserver = new MutationObserver(() => {
    const next = colors();
    chart.applyOptions({ layout: { textColor: next.text },
      grid: { vertLines: { color: next.grid }, horzLines: { color: next.grid } },
      timeScale: { borderColor: next.border }, rightPriceScale: { borderColor: next.border },
      crosshair: { vertLine: { color: next.text }, horzLine: { color: next.text } } });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const cleanups: Array<() => void> = [];
  const resizeListeners = new Set<() => void>();
  let destroyed = false;
  let baseHeight = options.height;
  const fullscreenHeight = (): number => document.fullscreenElement?.contains(container) === true
    ? Math.max(baseHeight, document.fullscreenElement.clientHeight - 200) : baseHeight;
  const onFullscreen = (): void => { if (!destroyed) chart.applyOptions({ height: fullscreenHeight() }); };
  document.addEventListener('fullscreenchange', onFullscreen);
  const observer = new ResizeObserver(([entry]) => {
    if (entry === undefined || destroyed) return;
    chart.applyOptions({ width: Math.floor(entry.contentRect.width), height: fullscreenHeight() });
    options.onResize?.();
    for (const listener of resizeListeners) listener();
  });
  observer.observe(container);
  return {
    chart,
    reducedMotion,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    setHeight(height) { baseHeight = height; if (!destroyed) chart.applyOptions({ height: fullscreenHeight() }); },
    onResize(listener) { resizeListeners.add(listener); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreen);
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
