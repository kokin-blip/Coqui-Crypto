import { describe, expect, it } from 'vitest';
import { createChartObservationCache } from '../apps/desktop/src/renderer/app/chart-observations.js';
import type { WorkstationBar } from '../apps/desktop/src/renderer/app/chart-workstation-types.js';
import { exactUtcTimestamp, formatLocalTimestamp } from '../apps/desktop/src/renderer/app/time-format.js';

const bar: WorkstationBar = { productId: 'BTC-USD', interval: '5m', startTimeMs: 1_700_000_000_000,
  endTimeMs: 1_700_000_300_000, open: '84000', high: '84200', low: '83900', close: '84100',
  volume: '2', isComplete: true };

describe('chart keyboard observation cache', () => {
  it('reuses completed labels while updating the live candle and preserving order', () => {
    const observe = createChartObservationCache();
    const live = { ...bar, startTimeMs: bar.endTimeMs, isComplete: false };
    const first = observe([bar, live]);
    const next = observe([bar, { ...live, close: '84200' }]);
    expect(next[0]).toBe(first[0]);
    expect(next[1]?.day).toBe(String(live.startTimeMs));
    expect(next[1]?.label).toContain('close 84200, live candle');
    expect(first[1]?.label).toContain('close 84100, live candle');
  });

  it('reflects corrected history and candle completion without losing accessible timestamps', () => {
    const observe = createChartObservationCache();
    observe([bar]);
    const corrected = { ...bar, close: '84300' };
    expect(observe([corrected])[0]?.label).toBe(`${formatLocalTimestamp(bar.startTimeMs)} (UTC ${exactUtcTimestamp(bar.startTimeMs)}): close 84300`);
    const provisional = { ...bar, isComplete: false };
    expect(observe([provisional])[0]?.label).toContain(', live candle');
    expect(observe([{ ...provisional, isComplete: true }])[0]?.label).not.toContain('live candle');
    expect(observe([])).toEqual([]);
  });
});
