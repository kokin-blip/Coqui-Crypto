import type { WorkstationBar } from './chart-workstation-types.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

interface ChartObservation { readonly day: string; readonly label: string }

/** Query history is immutable and structurally shared across live updates. */
export function createChartObservationCache(): (bars: readonly WorkstationBar[]) => readonly ChartObservation[] {
  const cache = new WeakMap<WorkstationBar, ChartObservation>();
  return bars => bars.map(bar => {
    let observation = cache.get(bar);
    if (observation === undefined) {
      observation = { day: String(bar.startTimeMs),
        label: `${formatLocalTimestamp(bar.startTimeMs)} (UTC ${exactUtcTimestamp(bar.startTimeMs)}): close ${bar.close}${bar.isComplete ? '' : ', live candle'}` };
      cache.set(bar, observation);
    }
    return observation;
  });
}
