import { nonNegativeDecimal } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

export type DisplayInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

export interface StoredDisplayBar {
  readonly profileId: string;
  readonly productId: string;
  readonly interval: DisplayInterval;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly retrievedAtMs: number;
  readonly expiresAtMs: number;
}

const PROFILE = /^(?:main|[0-9a-f-]{36})$/iu;
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;

function validate(row: StoredDisplayBar): void {
  if (!PROFILE.test(row.profileId) || !PRODUCT.test(row.productId) ||
    !['1m', '5m', '15m', '1h', '6h', '1d'].includes(row.interval) ||
    !Number.isSafeInteger(row.startTimeMs) || row.startTimeMs < 0 ||
    !Number.isSafeInteger(row.endTimeMs) || row.endTimeMs <= row.startTimeMs ||
    !Number.isSafeInteger(row.retrievedAtMs) || row.retrievedAtMs < 0 ||
    !Number.isSafeInteger(row.expiresAtMs) || row.expiresAtMs < row.retrievedAtMs) {
    throw new TypeError('Invalid display bar metadata.');
  }
  for (const value of [row.open, row.high, row.low, row.close]) {
    nonNegativeDecimal(value);
    if (Number(value) <= 0) throw new TypeError('Display prices must be positive.');
  }
  if (row.volume !== null) nonNegativeDecimal(row.volume);
  if (Number(row.high) < Number(row.low) || Number(row.open) < Number(row.low) ||
    Number(row.open) > Number(row.high) || Number(row.close) < Number(row.low) ||
    Number(row.close) > Number(row.high)) throw new TypeError('Invalid display OHLC values.');
}

export function upsertDisplayBars(rows: readonly StoredDisplayBar[], database: Db): void {
  inTransaction(database, () => {
    const statement = database.prepare(`
      INSERT INTO display_market_bars_v1 (
        profile_id, product_id, interval, start_time_ms, end_time_ms,
        open_text, high_text, low_text, close_text, volume_text,
        retrieved_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, product_id, interval, start_time_ms) DO UPDATE SET
        end_time_ms = excluded.end_time_ms,
        open_text = excluded.open_text, high_text = excluded.high_text,
        low_text = excluded.low_text, close_text = excluded.close_text,
        volume_text = excluded.volume_text,
        retrieved_at_ms = excluded.retrieved_at_ms,
        expires_at_ms = excluded.expires_at_ms
    `);
    for (const row of rows) {
      validate(row);
      statement.run(row.profileId, row.productId, row.interval, row.startTimeMs,
        row.endTimeMs, row.open, row.high, row.low, row.close, row.volume,
        row.retrievedAtMs, row.expiresAtMs);
    }
  });
}

export function listDisplayBars(input: {
  readonly profileId: string;
  readonly productId: string;
  readonly interval: DisplayInterval;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
}, database: Db): StoredDisplayBar[] {
  if (!PROFILE.test(input.profileId) || !PRODUCT.test(input.productId) ||
    !['1m', '5m', '15m', '1h', '6h', '1d'].includes(input.interval) ||
    !Number.isSafeInteger(input.startTimeMs) || input.startTimeMs < 0 ||
    !Number.isSafeInteger(input.endTimeMs) || input.endTimeMs <= input.startTimeMs) {
    throw new TypeError('Invalid display bar query.');
  }
  const rows = database.prepare(`
    SELECT * FROM display_market_bars_v1
    WHERE profile_id = ? AND product_id = ? AND interval = ?
      AND start_time_ms >= ? AND start_time_ms < ?
    ORDER BY start_time_ms
  `).all(input.profileId, input.productId, input.interval, input.startTimeMs,
    input.endTimeMs) as unknown as Array<{
      profile_id: string; product_id: string; interval: DisplayInterval;
      start_time_ms: number; end_time_ms: number; open_text: string;
      high_text: string; low_text: string; close_text: string;
      volume_text: string | null; retrieved_at_ms: number; expires_at_ms: number;
    }>;
  return rows.map((row) => Object.freeze({
    profileId: row.profile_id, productId: row.product_id, interval: row.interval,
    startTimeMs: row.start_time_ms, endTimeMs: row.end_time_ms,
    open: row.open_text, high: row.high_text, low: row.low_text,
    close: row.close_text, volume: row.volume_text,
    retrievedAtMs: row.retrieved_at_ms, expiresAtMs: row.expires_at_ms,
  }));
}

export function deleteExpiredDisplayBars(profileId: string, nowMs: number, database: Db): number {
  if (!PROFILE.test(profileId) || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError('Invalid display cache expiry.');
  }
  return Number(database.prepare(
    'DELETE FROM display_market_bars_v1 WHERE profile_id = ? AND expires_at_ms < ?',
  ).run(profileId, nowMs).changes);
}
