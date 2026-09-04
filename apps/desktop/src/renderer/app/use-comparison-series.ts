import { useEffect, useMemo, useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';

import type {
  WorkstationComparisonSeries, WorkstationInterval,
} from './chart-workstation-types.js';

interface ComparisonState {
  readonly series: readonly WorkstationComparisonSeries[];
  readonly loading: boolean;
  readonly failedCount: number;
}

const EMPTY: ComparisonState = Object.freeze({ series: [], loading: false, failedCount: 0 });

/** One bounded, abortable IPC read per selected comparison. No renderer networking or polling. */
export function useComparisonSeries(client: CoquiClient, productIds: readonly string[],
  interval: WorkstationInterval, startTimeMs: number, endTimeMs: number): ComparisonState {
  const key = [...new Set(productIds)].slice(0, 3).join('|');
  const ids = useMemo(() => key === '' ? [] : key.split('|'), [key]);
  const [state, setState] = useState<ComparisonState>(EMPTY);

  useEffect(() => {
    if (ids.length === 0) { setState(EMPTY); return; }
    const controller = new AbortController();
    setState({ series: [], loading: true, failedCount: 0 });
    void Promise.all(ids.map(async (productId) => {
      const outcome = await client.query('market-data.display-bars', {
        productId, interval, startTimeMs, endTimeMs,
      }, { signal: controller.signal });
      if (outcome.status !== 'ok') return null;
      return {
        productId,
        points: outcome.value.bars.filter((bar) => bar.isComplete)
          .map((bar) => ({ timeMs: bar.startTimeMs, value: bar.close })),
      } satisfies WorkstationComparisonSeries;
    })).then((results) => {
      if (controller.signal.aborted) return;
      const failedCount = results.filter((result) => result === null).length;
      setState({ series: results.flatMap((result) => result ?? []), loading: false, failedCount });
    });
    return () => controller.abort();
  }, [client, endTimeMs, ids, interval, key, startTimeMs]);

  return state;
}
