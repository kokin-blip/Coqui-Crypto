import {
  instrumentKey,
  nonNegativeDecimal,
  type AssetCatalog,
  type AssetRef,
  type Candle,
  type InstrumentIdentity,
  type MarketBar,
  type PriceSource,
  type SpotPriceObservation,
  type UsdAmount,
} from '@coqui/core';

import type { HttpClient, HttpFailure, HttpResult } from '../http/index.js';

export const COINBASE_EXCHANGE_HOST = 'api.exchange.coinbase.com';

const DAY_SECONDS = 86_400;
const DAY_MS = DAY_SECONDS * 1_000;
const CANDLES_PER_PAGE = 300;
const COMPLETION_DELAY_MS = 5 * 60_000;

const GRANULARITY: Readonly<Record<string, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '6h': 21_600,
  '1d': DAY_SECONDS,
};

interface CoinbaseStats {
  last?: unknown;
}

interface CoinbaseProduct {
  id?: unknown;
  base_currency?: unknown;
  quote_currency?: unknown;
  status?: unknown;
  trading_disabled?: unknown;
}

interface CoinbaseCurrency {
  id?: unknown;
  name?: unknown;
}

export interface CoinbaseDailyBarsOptions {
  maxDays: number;
  nowMs: number;
  sinceTimeMs?: number;
  retrievedAtMs?: number;
}

function productPath(instrument: InstrumentIdentity, suffix: string): string {
  return `https://${COINBASE_EXCHANGE_HOST}/products/${encodeURIComponent(instrument.productId)}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveUsd(value: unknown): UsdAmount | null {
  if (typeof value !== 'string' || /^0(?:\.0+)?$/.test(value)) return null;
  try {
    return nonNegativeDecimal(value);
  } catch {
    return null;
  }
}

function parseFailure(status: number): HttpFailure {
  return { ok: false, status, reason: 'parse', retried: 0 };
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseCandle(
  value: unknown,
  instrument: InstrumentIdentity,
  nowMs: number,
  retrievedAtMs: number,
): MarketBar | null {
  if (!Array.isArray(value) || value.length < 6) return null;
  const [timeS, low, high, open, close, volume] = value as unknown[];
  if (
    !validNumber(timeS) ||
    !Number.isSafeInteger(timeS) ||
    timeS % DAY_SECONDS !== 0 ||
    !validNumber(low) ||
    !validNumber(high) ||
    !validNumber(open) ||
    !validNumber(close) ||
    !validNumber(volume) ||
    low <= 0 ||
    high <= 0 ||
    open <= 0 ||
    close <= 0 ||
    volume < 0 ||
    high < low ||
    open < low ||
    open > high ||
    close < low ||
    close > high
  ) {
    return null;
  }
  const startTimeMs = timeS * 1_000;
  if (!Number.isSafeInteger(startTimeMs) || startTimeMs > nowMs) return null;
  const endTimeMs = startTimeMs + DAY_MS;
  return {
    assetId: instrumentKey(instrument),
    source: 'coinbase',
    interval: '1d',
    startTimeMs,
    endTimeMs,
    open,
    high,
    low,
    close,
    volume,
    isComplete: endTimeMs + COMPLETION_DELAY_MS <= nowMs,
    retrievedAtMs,
    quality: 'reported_ohlc',
  };
}

function sameCandle(left: MarketBar, right: MarketBar): boolean {
  return left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume;
}

/** Coinbase spot and recent-candle implementation of the core PriceSource seam. */
export function createCoinbasePriceSource(http: HttpClient): PriceSource {
  return {
    name: 'coinbase',
    async spot(instruments) {
      const prices = new Map<string, SpotPriceObservation>();
      await Promise.all(instruments.map(async (instrument) => {
        const result = await http.getJson<CoinbaseStats>(
          productPath(instrument, '/stats'),
        );
        if (!result.ok) return;
        const data: CoinbaseStats = isRecord(result.data) ? result.data : {};
        const price = positiveUsd(data.last);
        if (price !== null) {
          prices.set(instrumentKey(instrument), Object.freeze({
            priceUsd: price,
            source: 'coinbase',
            quality: 'venue_reported_last' as const,
            observedAtMs: null,
          }));
        }
      }));
      return prices;
    },
    async candles(instrument, timeframe) {
      const granularity = GRANULARITY[timeframe];
      if (granularity === undefined) return [];
      const result = await http.getJson<unknown>(
        `${productPath(instrument, '/candles')}?granularity=${granularity}`,
      );
      if (!result.ok || !Array.isArray(result.data)) return [];
      return result.data.flatMap((value): Candle[] => {
        if (!Array.isArray(value) || value.length < 6) return [];
        const [timeS, low, high, open, close, volume] = value as unknown[];
        if (
          !validNumber(timeS) ||
          !validNumber(low) ||
          !validNumber(high) ||
          !validNumber(open) ||
          !validNumber(close) ||
          !validNumber(volume) ||
          !Number.isSafeInteger(timeS) ||
          timeS < 0 ||
          low <= 0 ||
          high < low ||
          open < low ||
          open > high ||
          close < low ||
          close > high ||
          volume < 0
        ) return [];
        return [{ time: timeS * 1_000, open, high, low, close, volume }];
      }).sort((left, right) => left.time - right.time);
    },
  };
}

/**
 * Fetch validated daily OHLCV pages, oldest first. Any malformed or conflicting
 * page fails as a unit so callers never promote partial provider corruption.
 */
export async function fetchCoinbaseDailyBars(
  http: HttpClient,
  instrument: InstrumentIdentity,
  options: CoinbaseDailyBarsOptions,
): Promise<HttpResult<MarketBar[]>> {
  if (
    !Number.isSafeInteger(options.maxDays) ||
    options.maxDays <= 0 ||
    !Number.isSafeInteger(options.nowMs) ||
    options.nowMs <= 0 ||
    options.nowMs > 8_640_000_000_000_000 ||
    (options.sinceTimeMs !== undefined &&
      (!Number.isSafeInteger(options.sinceTimeMs) || options.sinceTimeMs < 0)) ||
    (options.retrievedAtMs !== undefined &&
      (!Number.isSafeInteger(options.retrievedAtMs) || options.retrievedAtMs < 0))
  ) return parseFailure(0);

  const retrievedAtMs = options.retrievedAtMs ?? options.nowMs;
  const sinceFloor = options.sinceTimeMs === undefined
    ? 0
    : options.sinceTimeMs + DAY_MS;
  const floorMs = Math.max(
    Math.floor(options.nowMs / DAY_MS) * DAY_MS - options.maxDays * DAY_MS,
    sinceFloor,
  );
  const bars = new Map<number, MarketBar>();
  let endMs = options.nowMs;
  let lastStatus = 200;

  while (endMs > floorMs) {
    const startMs = Math.max(floorMs, endMs - CANDLES_PER_PAGE * DAY_MS);
    const query = new URLSearchParams({
      granularity: String(DAY_SECONDS),
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    });
    const result = await http.getJson<unknown>(
      `${productPath(instrument, '/candles')}?${query.toString()}`,
    );
    if (!result.ok) return result;
    lastStatus = result.status;
    if (!Array.isArray(result.data)) return parseFailure(result.status);

    let added = 0;
    for (const value of result.data) {
      const bar = parseCandle(value, instrument, options.nowMs, retrievedAtMs);
      if (bar === null) return parseFailure(result.status);
      if (bar.startTimeMs < floorMs) continue;
      const duplicate = bars.get(bar.startTimeMs);
      if (duplicate && !sameCandle(duplicate, bar)) return parseFailure(result.status);
      if (!duplicate) {
        bars.set(bar.startTimeMs, bar);
        added += 1;
      }
    }
    if (added === 0) break;
    endMs = startMs;
  }

  return {
    ok: true,
    status: lastStatus,
    data: [...bars.values()].sort(
      (left, right) => left.startTimeMs - right.startTimeMs,
    ),
  };
}

/** Coinbase's online USD spot-product catalog with canonical venue identities. */
export function createCoinbaseAssetCatalog(http: HttpClient): AssetCatalog {
  let cache: Promise<AssetRef[]> | null = null;

  async function build(): Promise<AssetRef[]> {
    const [products, currencies] = await Promise.all([
      http.getJson<unknown>(`https://${COINBASE_EXCHANGE_HOST}/products`),
      http.getJson<unknown>(`https://${COINBASE_EXCHANGE_HOST}/currencies`),
    ]);
    if (!products.ok || !Array.isArray(products.data)) return [];

    const names = new Map<string, string>();
    if (currencies.ok && Array.isArray(currencies.data)) {
      for (const value of currencies.data) {
        if (!isRecord(value)) continue;
        const currency = value as CoinbaseCurrency;
        if (typeof currency.id === 'string' && typeof currency.name === 'string') {
          names.set(currency.id, currency.name);
        }
      }
    }

    const assets = new Map<string, AssetRef>();
    for (const value of products.data) {
      if (!isRecord(value)) continue;
      const product = value as CoinbaseProduct;
      if (
        typeof product.id !== 'string' ||
        typeof product.base_currency !== 'string' ||
        product.quote_currency !== 'USD' ||
        product.status !== 'online' ||
        product.trading_disabled === true
      ) continue;
      const instrument: InstrumentIdentity = {
        venue: 'coinbase',
        productId: product.id,
        productType: 'spot',
      };
      let key: string;
      try {
        key = instrumentKey(instrument);
      } catch {
        continue;
      }
      assets.set(key, {
        instrument,
        symbol: product.base_currency,
        name: names.get(product.base_currency) ?? product.base_currency,
        baseAsset: product.base_currency,
        quoteAsset: 'USD',
        coingeckoId: null,
      });
    }
    return [...assets.values()].sort(
      (left, right) => left.symbol.localeCompare(right.symbol) ||
        left.instrument.productId.localeCompare(right.instrument.productId),
    );
  }

  function all(): Promise<AssetRef[]> {
    if (cache !== null) return cache;
    const pending = build().catch((): AssetRef[] => []);
    cache = pending;
    void pending.then((assets) => {
      if (assets.length === 0 && cache === pending) cache = null;
    });
    return pending;
  }

  return {
    name: 'coinbase',
    async search(query, limit = 25) {
      const normalized = query.trim().toLowerCase();
      const assets = await all();
      if (normalized.length === 0) return assets.slice(0, limit);
      return assets.map((asset) => {
        const symbol = asset.symbol.toLowerCase();
        const name = asset.name.toLowerCase();
        let score = -1;
        if (symbol === normalized) score = 0;
        else if (symbol.startsWith(normalized)) score = 1;
        else if (name.startsWith(normalized)) score = 2;
        else if (symbol.includes(normalized) || name.includes(normalized)) score = 3;
        return { asset, score };
      }).filter(({ score }) => score >= 0)
        .sort((left, right) => left.score - right.score ||
          left.asset.symbol.localeCompare(right.asset.symbol))
        .slice(0, limit)
        .map(({ asset }) => asset);
    },
    async page(offset, limit) {
      return (await all()).slice(offset, offset + limit);
    },
  };
}
