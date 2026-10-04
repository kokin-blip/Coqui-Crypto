import type { MarketBarRecord } from '@coqui/storage';
import { DAY_MS, type AcquisitionProduct } from './config.js';

export interface DailyRecord {
  startTimeMs: number; endTimeMs: number;
  open: string; high: string; low: string; close: string; volume: string;
  isComplete: boolean;
}
export function normalizeAcquiredRecords(product: AcquisitionProduct, rows: readonly DailyRecord[],
  retrievedAtMs: number, start: number, end: number): MarketBarRecord[] {
  return rows.filter((row) => row.isComplete && row.startTimeMs >= start && row.endTimeMs <= end)
    .map((row) => ({ source: product.instrument.venue, instrument: product.instrument,
      providerAssetId: product.instrument.productId, interval: '1d' as const,
      startTimeMs: row.startTimeMs, endTimeMs: row.endTimeMs,
      open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
      isComplete: row.isComplete, quality: 'reported_ohlc' as const, retrievedAtMs }));
}
/** Compare observations independently of capture time; preserve the first capture. */
export function mergeAcquiredRecords(rows: readonly MarketBarRecord[]): MarketBarRecord[] {
  const unique = new Map<string, MarketBarRecord>();
  for (const row of rows) {
    const key = `${row.instrument.venue}|${row.instrument.productType}|${row.instrument.productId}|${row.startTimeMs}`;
    const prior = unique.get(key);
    if (prior) {
      const comparable = (record: MarketBarRecord): string => JSON.stringify([
        record.source, record.endTimeMs, record.open, record.high, record.low, record.close,
        record.volume, record.isComplete, record.quality,
      ]);
      if (comparable(prior) !== comparable(row)) throw new Error('Conflicting acquired daily observation.');
    } else unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => a.startTimeMs - b.startTimeMs);
}
export function coverageOf(rows: readonly MarketBarRecord[], start: number, end: number): {
  firstStartTimeMs: number | null; endExclusiveMs: number | null;
  observedDayCount: number; missingRanges: { startTimeMs: number; endExclusiveMs: number }[];
} {
  const days = new Set(rows.map((row) => row.startTimeMs));
  const missingRanges: { startTimeMs: number; endExclusiveMs: number }[] = [];
  for (let time = start; time < end; time += DAY_MS) {
    if (days.has(time)) continue;
    const last = missingRanges.at(-1);
    if (last?.endExclusiveMs === time) last.endExclusiveMs += DAY_MS;
    else missingRanges.push({ startTimeMs: time, endExclusiveMs: time + DAY_MS });
  }
  return { firstStartTimeMs: rows[0]?.startTimeMs ?? null,
    endExclusiveMs: rows.at(-1)?.endTimeMs ?? null, observedDayCount: rows.length, missingRanges };
}
