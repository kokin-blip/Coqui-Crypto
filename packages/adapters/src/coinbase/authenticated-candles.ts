import { instrumentKey, type InstrumentIdentity, type MarketBar } from '@coqui/core';

import type { CoinbaseReadHttpClient } from './auth.js';
import type { CoinbaseDisplayBar, CoinbaseDisplayBarsOptions, CoinbaseDailyBarsOptions } from './public.js';
import type { HttpResult } from '../http/index.js';

const DAY_MS = 86_400_000;
const PAGE_SIZE = 350;
const COMPLETE_DELAY_MS = 5 * 60_000;
const INTERVAL: Readonly<Record<string, { name: string; ms: number }>> = {
  '1m': { name: 'ONE_MINUTE', ms: 60_000 },
  '5m': { name: 'FIVE_MINUTE', ms: 300_000 },
  '15m': { name: 'FIFTEEN_MINUTE', ms: 900_000 },
  '1h': { name: 'ONE_HOUR', ms: 3_600_000 },
  '6h': { name: 'SIX_HOUR', ms: 21_600_000 },
  '1d': { name: 'ONE_DAY', ms: DAY_MS },
};

type Candle = { start: number; open: string; high: string; low: string; close: string; volume: string };

function invalid(status = 0): HttpResult<never> {
  return { ok: false, status, reason: 'parse', retried: 0 };
}

function decimal(value: unknown, positive: boolean): string | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && (positive ? number > 0 : number >= 0) ? value : null;
}

function parse(value: unknown, intervalMs: number): Candle | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row['start'] !== 'string' || !/^\d+$/u.test(row['start'])) return null;
  const startSeconds = Number(row['start']);
  const start = startSeconds * 1_000;
  const open = decimal(row['open'], true), high = decimal(row['high'], true);
  const low = decimal(row['low'], true), close = decimal(row['close'], true);
  const volume = decimal(row['volume'], false);
  if (!Number.isSafeInteger(startSeconds) || !Number.isSafeInteger(start) || start < 0 ||
      start % intervalMs !== 0 || open === null || high === null || low === null ||
      close === null || volume === null || Number(high) < Number(low) ||
      Number(open) < Number(low) || Number(open) > Number(high) ||
      Number(close) < Number(low) || Number(close) > Number(high)) return null;
  return { start, open, high, low, close, volume };
}

async function fetchWindow(client: Pick<CoinbaseReadHttpClient, 'getJson'>, instrument: InstrumentIdentity,
  interval: keyof typeof INTERVAL, startMs: number, endMs: number): Promise<HttpResult<Candle[]>> {
  const config = INTERVAL[interval];
  if (config === undefined || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) ||
      startMs < 0 || endMs <= startMs) return invalid();
  const rows = new Map<number, Candle>();
  let status = 200;
  for (let cursor = startMs; cursor < endMs; cursor += config.ms * PAGE_SIZE) {
    const pageEnd = Math.min(endMs, cursor + config.ms * PAGE_SIZE);
    const query = new URLSearchParams({ start: String(Math.floor(cursor / 1_000)),
      end: String(Math.floor(pageEnd / 1_000)), granularity: config.name, limit: String(PAGE_SIZE) });
    const url = `https://api.coinbase.com/api/v3/brokerage/products/${encodeURIComponent(instrument.productId)}/candles?${query.toString()}`;
    const result = await client.getJson<unknown>(url);
    if (!result.ok) return result;
    status = result.status;
    const payload = result.data;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
        !Array.isArray((payload as Record<string, unknown>)['candles']) ||
        (payload as { candles: unknown[] }).candles.length > PAGE_SIZE) return invalid(status);
    for (const raw of (payload as { candles: unknown[] }).candles) {
      const candle = parse(raw, config.ms);
      if (candle === null) return invalid(status);
      if (candle.start < cursor || candle.start >= pageEnd) continue;
      const prior = rows.get(candle.start);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(candle)) return invalid(status);
      rows.set(candle.start, candle);
    }
  }
  return { ok: true, status, data: [...rows.values()].sort((a, b) => a.start - b.start) };
}

export async function fetchAuthenticatedCoinbaseDailyBars(client: Pick<CoinbaseReadHttpClient, 'getJson'>,
  instrument: InstrumentIdentity, options: CoinbaseDailyBarsOptions): Promise<HttpResult<MarketBar[]>> {
  if (!Number.isSafeInteger(options.maxDays) || options.maxDays <= 0 ||
      !Number.isSafeInteger(options.nowMs) || options.nowMs <= 0) return invalid();
  const endMs = options.nowMs;
  const floorMs = Math.max(0, Math.floor(endMs / DAY_MS) * DAY_MS - options.maxDays * DAY_MS,
    options.sinceTimeMs === undefined ? 0 : options.sinceTimeMs + DAY_MS);
  const result = await fetchWindow(client, instrument, '1d', floorMs, endMs);
  if (!result.ok) return result;
  const retrievedAtMs = options.retrievedAtMs ?? options.nowMs;
  return { ok: true, status: result.status, data: result.data.map((bar) => ({
    assetId: instrumentKey(instrument), source: 'coinbase' as const, interval: '1d' as const,
    startTimeMs: bar.start, endTimeMs: bar.start + DAY_MS,
    open: Number(bar.open), high: Number(bar.high), low: Number(bar.low),
    close: Number(bar.close), volume: Number(bar.volume),
    isComplete: bar.start + DAY_MS + COMPLETE_DELAY_MS <= options.nowMs,
    retrievedAtMs, quality: 'reported_ohlc' as const,
  })) };
}

export async function fetchAuthenticatedCoinbaseDisplayBars(client: Pick<CoinbaseReadHttpClient, 'getJson'>,
  instrument: InstrumentIdentity, options: CoinbaseDisplayBarsOptions): Promise<HttpResult<CoinbaseDisplayBar[]>> {
  const config = INTERVAL[options.interval];
  if (config === undefined || !Number.isSafeInteger(options.nowMs) || options.nowMs < 0 ||
      options.endTimeMs - options.startTimeMs > config.ms * PAGE_SIZE) return invalid();
  const result = await fetchWindow(client, instrument, options.interval, options.startTimeMs, options.endTimeMs);
  if (!result.ok) return result;
  return { ok: true, status: result.status, data: result.data.filter((bar) =>
    bar.start + config.ms <= options.nowMs).map((bar) => ({
    productId: instrument.productId, interval: options.interval,
    startTimeMs: bar.start, endTimeMs: bar.start + config.ms,
    open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    volume: bar.volume, isComplete: true as const,
    retrievedAtMs: options.retrievedAtMs ?? options.nowMs,
  })) };
}
