import type { BinanceDailyKlineRecord } from '@coqui/adapters';
import { instrumentKey } from '@coqui/core';
import { upsertMarketBars, type Db } from '@coqui/storage';

/** Persist verified Binance research rows without erasing exact decimal text. */
export function persistBinanceDailyKlines(
  records: readonly BinanceDailyKlineRecord[],
  retrievedAtMs: number,
  database: Db,
): number {
  if (!Number.isSafeInteger(retrievedAtMs) || retrievedAtMs < 0) {
    throw new TypeError('retrievedAtMs must be a non-negative safe integer.');
  }
  const identities = new Set<string>();
  for (const record of records) {
    if (record.instrument.venue !== 'binance' || record.instrument.productType !== 'spot') {
      throw new TypeError('Binance archive rows require Binance spot identities.');
    }
    identities.add(instrumentKey(record.instrument));
  }
  if (identities.size > 1) throw new TypeError('One archive import cannot mix instruments.');
  upsertMarketBars(records.map((record) => ({
    source: 'binance',
    instrument: record.instrument,
    providerAssetId: record.instrument.productId,
    interval: '1d',
    startTimeMs: record.startTimeMs,
    endTimeMs: record.endTimeMs,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
    isComplete: record.isComplete,
    quality: 'reported_ohlc',
    retrievedAtMs,
  })), database);
  return records.length;
}
