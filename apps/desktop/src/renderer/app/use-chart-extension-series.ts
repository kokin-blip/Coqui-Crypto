import { useEffect, useMemo, useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';

import type { WorkstationBar, WorkstationExtensionMarker, WorkstationExtensionSeries } from './chart-workstation-types.js';

interface ExtensionSeriesState {
  readonly kind: 'idle' | 'loading' | 'ready' | 'failed';
  readonly series: readonly WorkstationExtensionSeries[];
  readonly markers: readonly WorkstationExtensionMarker[];
  readonly failedCount: number;
}

const IDLE: ExtensionSeriesState = Object.freeze({ kind: 'idle', series: [], markers: [], failedCount: 0 });

/**
 * Evaluate signed extensions through the main-process boundary.
 *
 * Only immutable completed display bars cross this boundary. The result is
 * presentation-only and never becomes research or execution evidence.
 */
export function useChartExtensionSeries(
  client: CoquiClient,
  extensionIds: readonly string[],
  bars: readonly WorkstationBar[],
): ExtensionSeriesState {
  const completed = useMemo(() => bars.filter((bar) => bar.isComplete).slice(-2_000), [bars]);
  const key = useMemo(() => `${extensionIds.join('|')}:${completed.map((bar) => `${bar.startTimeMs}:${bar.close}`).join('|')}`, [completed, extensionIds]);
  const [state, setState] = useState<ExtensionSeriesState>(IDLE);

  useEffect(() => {
    if (extensionIds.length === 0 || completed.length === 0) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState({ kind: 'loading', series: [], markers: [], failedCount: 0 });
    void Promise.all(extensionIds.map(async (extensionId) => {
      const outcome = await client.query('chart-extensions.evaluate', {
        extensionId,
        bars: completed.map((bar) => ({
          timeMs: bar.startTimeMs,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
      }, { signal: controller.signal });
      if (outcome.status !== 'ok') return null;
      return {
        series: outcome.value.series.map((series): WorkstationExtensionSeries => ({
          extensionId, id: series.id, title: series.title, pane: series.pane,
          color: series.color, points: series.points.map((point) => ({ timeMs: point.timeMs, value: point.value })),
        })),
        markers: outcome.value.markers.map((marker): WorkstationExtensionMarker => ({ extensionId, ...marker })),
      };
    })).then((results) => {
      if (controller.signal.aborted) return;
      const failedCount = results.filter((result) => result === null).length;
      setState({
        kind: failedCount === results.length ? 'failed' : 'ready',
        series: results.flatMap((result) => result?.series ?? []),
        markers: results.flatMap((result) => result?.markers ?? []),
        failedCount,
      });
    });
    return () => controller.abort();
  }, [client, completed, extensionIds, key]);

  return state;
}
