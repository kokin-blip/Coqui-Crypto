import type { WorkstationBar } from './chart-workstation-types.js';
/** Binary lookup keeps synchronized crosshair work bounded on long histories. */
export function nearestBar(bars: readonly WorkstationBar[], timeMs: number): WorkstationBar | null {
  let low = 0; let high = bars.length;
  while (low < high) { const mid = (low + high) >>> 1;
    if (bars[mid]!.startTimeMs < timeMs) low = mid + 1; else high = mid; }
  const next = bars[low]; const previous = bars[low - 1];
  return next === undefined ? previous ?? null : previous === undefined ||
    Math.abs(next.startTimeMs - timeMs) < Math.abs(previous.startTimeMs - timeMs) ? next : previous;
}
