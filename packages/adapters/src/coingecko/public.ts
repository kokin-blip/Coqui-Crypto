import {
  instrumentKey,
  nonNegativeDecimal,
  type AssetRef,
  type InstrumentIdentity,
  type InstrumentKey,
  type PriceSource,
  type SpotPriceObservation,
  type UsdAmount,
} from '@coqui/core';

import type { HttpClient } from '../http/index.js';

export const COINGECKO_PUBLIC_HOST = 'api.coingecko.com';
export const COINGECKO_PUBLIC_ROOT = `https://${COINGECKO_PUBLIC_HOST}/api/v3`;

// CoinGecko documents at most 250 IDs for /coins/markets. Keeping both public
// reads at 100 also leaves ample URL headroom for long provider IDs.
const BATCH_SIZE = 100;

interface SimplePriceRow {
  usd?: unknown;
}

interface MarketRow {
  id?: unknown;
  current_price?: unknown;
  market_cap?: unknown;
  market_cap_rank?: unknown;
  total_volume?: unknown;
  price_change_percentage_24h?: unknown;
  price_change_percentage_7d_in_currency?: unknown;
  image?: unknown;
  last_updated?: unknown;
}

interface RegistryEntry {
  instrument: InstrumentIdentity;
  key: InstrumentKey;
  coingeckoId: string;
}

export interface CoinGeckoMarketSnapshot {
  readonly instrument: InstrumentIdentity;
  readonly coingeckoId: string;
  readonly priceUsd: UsdAmount;
  readonly marketCapUsd: UsdAmount | null;
  readonly volume24hUsd: UsdAmount | null;
  readonly marketCapRank: number | null;
  readonly change24hPct: number | null;
  readonly change7dPct: number | null;
  readonly imageUrl: string | null;
  readonly providerUpdatedAtMs: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += BATCH_SIZE) {
    result.push(values.slice(index, index + BATCH_SIZE));
  }
  return result;
}

function expandExponent(value: number): string {
  const text = String(value);
  const marker = text.search(/[eE]/);
  if (marker < 0) return text;
  const coefficient = text.slice(0, marker);
  const exponent = Number(text.slice(marker + 1));
  const point = coefficient.indexOf('.');
  const digits = coefficient.replace('.', '');
  const integerDigits = point < 0 ? coefficient.length : point;
  const decimalPosition = integerDigits + exponent;
  if (decimalPosition <= 0) {
    return `0.${'0'.repeat(-decimalPosition)}${digits}`;
  }
  if (decimalPosition >= digits.length) {
    return `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  }
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function usd(value: unknown, allowZero = false): UsdAmount | null {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) return null;
  try {
    return nonNegativeDecimal(expandExponent(value));
  } catch {
    return null;
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function registryEntries(assets: readonly AssetRef[]): RegistryEntry[] {
  const byKey = new Map<InstrumentKey, RegistryEntry>();
  for (const asset of assets) {
    const coingeckoId = asset.coingeckoId?.trim();
    if (!coingeckoId) continue;
    let key: InstrumentKey;
    try {
      key = instrumentKey(asset.instrument);
    } catch {
      continue;
    }
    byKey.set(key, { instrument: asset.instrument, key, coingeckoId });
  }
  return [...byKey.values()];
}

function entriesByProviderId(
  entries: readonly RegistryEntry[],
): Map<string, RegistryEntry[]> {
  const result = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    const values = result.get(entry.coingeckoId) ?? [];
    values.push(entry);
    result.set(entry.coingeckoId, values);
  }
  return result;
}

/** CoinGecko spot prices joined only through explicit AssetRef.coingeckoId values. */
export function createCoinGeckoPriceSource(
  http: HttpClient,
  assets: readonly AssetRef[],
): PriceSource {
  const byKey = new Map(registryEntries(assets).map((entry) => [entry.key, entry]));
  return {
    name: 'coingecko',
    async spot(instruments) {
      const requested = new Map<InstrumentKey, RegistryEntry>();
      for (const instrument of instruments) {
        let key: InstrumentKey;
        try {
          key = instrumentKey(instrument);
        } catch {
          continue;
        }
        const entry = byKey.get(key);
        if (entry) requested.set(key, entry);
      }
      const byId = entriesByProviderId([...requested.values()]);
      const prices = new Map<InstrumentKey, SpotPriceObservation>();
      await Promise.all(chunks([...byId.keys()]).map(async (ids) => {
        const query = new URLSearchParams({
          ids: ids.join(','),
          vs_currencies: 'usd',
          precision: 'full',
        });
        const response = await http.getJson<unknown>(
          `${COINGECKO_PUBLIC_ROOT}/simple/price?${query.toString()}`,
        );
        if (!response.ok || !isRecord(response.data)) return;
        for (const id of ids) {
          const row = response.data[id];
          const price = isRecord(row) ? usd((row as SimplePriceRow).usd) : null;
          if (price === null) continue;
          for (const entry of byId.get(id) ?? []) {
            prices.set(entry.key, Object.freeze({
              priceUsd: price,
              source: 'coingecko',
              quality: 'reference_market' as const,
              observedAtMs: null,
            }));
          }
        }
      }));
      return prices;
    },
  };
}

/** Fill only canonical instruments the primary source could not price. */
export function withPriceFallback(
  primary: PriceSource,
  fallback: PriceSource,
): PriceSource {
  const source: PriceSource = {
    name: `${primary.name}+${fallback.name}`,
    async spot(instruments) {
      const primaryPrices = await primary.spot(instruments);
      const missing = instruments.filter((instrument) =>
        !primaryPrices.has(instrumentKey(instrument)),
      );
      if (missing.length === 0) return primaryPrices;
      const fallbackPrices = await fallback.spot(missing);
      return new Map([...fallbackPrices, ...primaryPrices]);
    },
  };
  if (!primary.candles && !fallback.candles) return source;
  return {
    ...source,
    async candles(instrument, timeframe) {
      const preferred = await primary.candles?.(instrument, timeframe) ?? [];
      return preferred.length > 0
        ? preferred
        : await fallback.candles?.(instrument, timeframe) ?? [];
    },
  };
}

/** Market-cap enrichment keyed by explicit canonical venue identity. */
export async function fetchCoinGeckoMarketSnapshots(
  http: HttpClient,
  assets: readonly AssetRef[],
): Promise<ReadonlyMap<InstrumentKey, CoinGeckoMarketSnapshot>> {
  const byId = entriesByProviderId(registryEntries(assets));
  const snapshots = new Map<InstrumentKey, CoinGeckoMarketSnapshot>();
  await Promise.all(chunks([...byId.keys()]).map(async (ids) => {
    const query = new URLSearchParams({
      vs_currency: 'usd',
      ids: ids.join(','),
      per_page: String(ids.length),
      page: '1',
      sparkline: 'false',
      price_change_percentage: '24h,7d',
      precision: 'full',
    });
    const response = await http.getJson<unknown>(
      `${COINGECKO_PUBLIC_ROOT}/coins/markets?${query.toString()}`,
    );
    if (!response.ok || !Array.isArray(response.data)) return;
    for (const value of response.data) {
      if (!isRecord(value) || typeof value['id'] !== 'string') continue;
      const entries = byId.get(value['id']);
      const priceUsd = usd((value as MarketRow).current_price);
      if (!entries || priceUsd === null) continue;
      for (const entry of entries) {
        snapshots.set(entry.key, {
          instrument: entry.instrument,
          coingeckoId: entry.coingeckoId,
          priceUsd,
          marketCapUsd: usd((value as MarketRow).market_cap, true),
          volume24hUsd: usd((value as MarketRow).total_volume, true),
          marketCapRank: positiveInteger((value as MarketRow).market_cap_rank),
          change24hPct: finite((value as MarketRow).price_change_percentage_24h),
          change7dPct: finite((value as MarketRow).price_change_percentage_7d_in_currency),
          imageUrl: typeof (value as MarketRow).image === 'string'
            ? (value as MarketRow).image as string
            : null,
          providerUpdatedAtMs: timestamp((value as MarketRow).last_updated),
        });
      }
    }
  }));
  return snapshots;
}
