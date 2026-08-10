import {
  instrumentKey,
  nonNegativeDecimal,
  type InstrumentIdentity,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

export interface DailyCloseRecord {
  readonly instrument: InstrumentIdentity;
  readonly timeS: number;
  readonly close: number;
}

export interface MarketBarRecord {
  readonly source: 'binance' | 'coinbase' | 'coingecko' | 'fixture' | 'kraken';
  readonly instrument: InstrumentIdentity;
  readonly providerAssetId: string;
  readonly interval: '1d';
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly isComplete: boolean;
  readonly quality: 'reported_ohlc' | 'close_only_legacy' | 'synthetic_ohlc';
  readonly retrievedAtMs: number;
}

export interface ProviderHistoryPoint {
  readonly source: string;
  readonly providerAssetId: string;
  readonly dayS: number;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number;
  readonly marketCapUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly fetchedAt: number;
}

export interface GlobalMarketHistoryPoint {
  readonly source: string;
  readonly dayS: number;
  readonly marketCapUsd: number;
  readonly volume24hUsd: number | null;
  readonly fetchedAt: number;
}

export interface MarketDataMigrationException {
  readonly id: string;
  readonly legacyTable: string;
  readonly legacyKey: string;
  readonly reason: string;
}

/** Cache canonical daily closes; research prices may remain binary numbers. */
export function upsertDailyCloses(
  instrument: InstrumentIdentity,
  rows: readonly Omit<DailyCloseRecord, 'instrument'>[],
  database: Db,
): void {
  const key = instrumentKey(instrument);
  inTransaction(database, () => {
    const statement = database.prepare(`
      INSERT INTO daily_closes (asset_id, time_s, close) VALUES (?, ?, ?)
      ON CONFLICT(asset_id, time_s) DO UPDATE SET close = excluded.close
    `);
    for (const row of rows) {
      if (!Number.isFinite(row.close) || row.close <= 0) {
        throw new TypeError('Daily close must be a positive finite number.');
      }
      statement.run(key, row.timeS, row.close);
    }
  });
}

export function listDailyCloses(
  instrument: InstrumentIdentity,
  database: Db,
): DailyCloseRecord[] {
  const rows = database.prepare(`
    SELECT time_s, close FROM daily_closes
    WHERE asset_id = ? ORDER BY time_s
  `).all(instrumentKey(instrument)) as unknown as Array<{ time_s: number; close: number }>;
  return rows.map((row) => ({ instrument, timeS: row.time_s, close: row.close }));
}

export function latestDailyCloseTime(
  instrument: InstrumentIdentity,
  database: Db,
): number | null {
  const row = database.prepare(
    'SELECT MAX(time_s) AS time_s FROM daily_closes WHERE asset_id = ?',
  ).get(instrumentKey(instrument)) as { time_s: number | null };
  return row.time_s;
}

export function upsertMarketBars(rows: readonly MarketBarRecord[], database: Db): void {
  inTransaction(database, () => {
    const statement = database.prepare(`
      INSERT INTO market_bars_v2 (
        source, asset_id, provider_asset_id, interval, start_time_ms, end_time_ms,
        open_text, high_text, low_text, close_text, volume_text, is_complete,
        quality, retrieved_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, asset_id, interval, start_time_ms) DO UPDATE SET
        provider_asset_id = excluded.provider_asset_id,
        end_time_ms = excluded.end_time_ms,
        open_text = excluded.open_text,
        high_text = excluded.high_text,
        low_text = excluded.low_text,
        close_text = excluded.close_text,
        volume_text = excluded.volume_text,
        is_complete = excluded.is_complete,
        quality = excluded.quality,
        retrieved_at_ms = excluded.retrieved_at_ms
    `);
    for (const row of rows) {
      nonNegativeDecimal(row.open);
      nonNegativeDecimal(row.high);
      nonNegativeDecimal(row.low);
      nonNegativeDecimal(row.close);
      if (row.volume !== null) nonNegativeDecimal(row.volume);
      statement.run(
        row.source,
        instrumentKey(row.instrument),
        row.providerAssetId,
        row.interval,
        row.startTimeMs,
        row.endTimeMs,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.isComplete ? 1 : 0,
        row.quality,
        row.retrievedAtMs,
      );
    }
  });
}

export function listMarketBars(
  instrument: InstrumentIdentity,
  database: Db,
  source: MarketBarRecord['source'] = 'coinbase',
): MarketBarRecord[] {
  const rows = database.prepare(`
    SELECT * FROM market_bars_v2
    WHERE asset_id = ? AND source = ? AND interval = '1d'
    ORDER BY start_time_ms
  `).all(instrumentKey(instrument), source) as unknown as Array<{
    source: MarketBarRecord['source'];
    provider_asset_id: string;
    interval: '1d';
    start_time_ms: number;
    end_time_ms: number;
    open_text: string;
    high_text: string;
    low_text: string;
    close_text: string;
    volume_text: string | null;
    is_complete: number;
    quality: MarketBarRecord['quality'];
    retrieved_at_ms: number;
  }>;
  return rows.map((row) => ({
    source: row.source,
    instrument,
    providerAssetId: row.provider_asset_id,
    interval: row.interval,
    startTimeMs: row.start_time_ms,
    endTimeMs: row.end_time_ms,
    open: nonNegativeDecimal(row.open_text),
    high: nonNegativeDecimal(row.high_text),
    low: nonNegativeDecimal(row.low_text),
    close: nonNegativeDecimal(row.close_text),
    volume: row.volume_text === null ? null : nonNegativeDecimal(row.volume_text),
    isComplete: row.is_complete === 1,
    quality: row.quality,
    retrievedAtMs: row.retrieved_at_ms,
  }));
}

export function upsertProviderHistory(
  points: readonly ProviderHistoryPoint[],
  database: Db,
): void {
  inTransaction(database, () => {
    const statement = database.prepare(`
      INSERT INTO market_history_daily
        (source, asset_id, day_s, open, high, low, close, market_cap_usd,
         volume_24h_usd, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, asset_id, day_s) DO UPDATE SET
        open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, market_cap_usd = excluded.market_cap_usd,
        volume_24h_usd = excluded.volume_24h_usd, fetched_at = excluded.fetched_at
    `);
    for (const point of points) statement.run(
      point.source,
      point.providerAssetId,
      point.dayS,
      point.open,
      point.high,
      point.low,
      point.close,
      point.marketCapUsd,
      point.volume24hUsd,
      point.fetchedAt,
    );
  });
}

export function listProviderHistory(
  source: string,
  providerAssetId: string,
  database: Db,
): ProviderHistoryPoint[] {
  const rows = database.prepare(`
    SELECT * FROM market_history_daily
    WHERE source = ? AND asset_id = ? ORDER BY day_s
  `).all(source, providerAssetId) as unknown as Array<{
    source: string;
    asset_id: string;
    day_s: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    market_cap_usd: number | null;
    volume_24h_usd: number | null;
    fetched_at: number;
  }>;
  return rows.map((row) => ({
    source: row.source,
    providerAssetId: row.asset_id,
    dayS: row.day_s,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    marketCapUsd: row.market_cap_usd,
    volume24hUsd: row.volume_24h_usd,
    fetchedAt: row.fetched_at,
  }));
}

export function latestProviderHistoryDay(
  source: string,
  providerAssetId: string,
  database: Db,
): number | null {
  const row = database.prepare(`
    SELECT MAX(day_s) AS day_s FROM market_history_daily
    WHERE source = ? AND asset_id = ?
  `).get(source, providerAssetId) as { day_s: number | null };
  return row.day_s;
}

export function listMarketDataMigrationExceptions(
  database: Db,
): MarketDataMigrationException[] {
  const rows = database.prepare(`
    SELECT id, legacy_table, legacy_key, reason
    FROM market_data_migration_exceptions
    WHERE resolved_at IS NULL ORDER BY legacy_table, legacy_key
  `).all() as unknown as Array<{
    id: string;
    legacy_table: string;
    legacy_key: string;
    reason: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    legacyTable: row.legacy_table,
    legacyKey: row.legacy_key,
    reason: row.reason,
  }));
}
