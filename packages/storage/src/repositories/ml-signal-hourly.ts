import type { Db } from '../sqlite/index.js';

export interface MlHourlyBar {
  readonly productId: 'BTC-USD' | 'ETH-USD' | 'LTC-USD';
  readonly startTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly source: 'authenticated' | 'public';
  readonly retrievedAtMs: number;
}

export function saveMlHourlyBars(profileId: string, bars: readonly MlHourlyBar[], db: Db): void {
  const insert = db.prepare(`INSERT INTO ml_signal_hourly_bars_v1
    (profile_id,product_id,start_ms,open,high,low,close,volume,source,retrieved_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,product_id,start_ms) DO UPDATE SET
    open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,
    volume=excluded.volume,source=excluded.source,retrieved_at_ms=excluded.retrieved_at_ms`);
  db.exec('BEGIN');
  try {
    for (const bar of bars) insert.run(profileId, bar.productId, bar.startTimeMs, bar.open,
      bar.high, bar.low, bar.close, bar.volume, bar.source, bar.retrievedAtMs);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function listMlHourlyBars(profileId: string, fromMs: number, toMs: number, db: Db): readonly MlHourlyBar[] {
  return (db.prepare(`SELECT product_id,start_ms,open,high,low,close,volume,source,retrieved_at_ms
    FROM ml_signal_hourly_bars_v1 WHERE profile_id=? AND start_ms>=? AND start_ms<?
    ORDER BY start_ms,product_id`).all(profileId, fromMs, toMs) as Record<string, unknown>[])
    .map((row) => ({ productId: String(row['product_id']) as MlHourlyBar['productId'],
      startTimeMs: Number(row['start_ms']), open: String(row['open']), high: String(row['high']),
      low: String(row['low']), close: String(row['close']), volume: row['volume'] === null ? null : String(row['volume']),
      source: String(row['source']) as MlHourlyBar['source'], retrievedAtMs: Number(row['retrieved_at_ms']) }));
}
