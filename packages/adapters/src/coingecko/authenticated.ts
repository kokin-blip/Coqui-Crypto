import { instrumentKey, type InstrumentKey } from '@coqui/core';

import {
  createAuthenticatedHttpClient,
  type HttpClient,
  type HttpClientOptions,
} from '../http/index.js';
import {
  chunks,
  entriesByProviderId,
  finite,
  isRecord,
  positiveInteger,
  registryEntries,
  timestamp,
  usd,
} from '../market-data/normalize.js';
import type {
  ProviderAssetMapping,
  ProviderBatchResult,
  ProviderMarketSnapshot,
  ProviderMarketSource,
} from '../market-data/types.js';
import { COINGECKO_PUBLIC_HOST, COINGECKO_PUBLIC_ROOT } from './public.js';

interface CoinGeckoRow {
  id?: unknown;
  current_price?: unknown;
  market_cap?: unknown;
  market_cap_rank?: unknown;
  total_volume?: unknown;
  price_change_percentage_24h?: unknown;
  last_updated?: unknown;
}

/** Create a Demo client whose key is added only to CoinGecko HTTPS attempts. */
export function createCoinGeckoDemoHttpClient(
  apiKey: string,
  options: HttpClientOptions = {},
): HttpClient {
  return createAuthenticatedHttpClient({
    ...options,
    hostname: COINGECKO_PUBLIC_HOST,
    headerName: 'x-cg-demo-api-key',
    apiKey,
  });
}

/** Fetch authenticated Demo snapshots joined only by explicit CoinGecko IDs. */
export async function fetchCoinGeckoDemoSnapshots(
  http: HttpClient,
  mappings: readonly ProviderAssetMapping[],
): Promise<ProviderBatchResult> {
  const byId = entriesByProviderId(registryEntries(mappings, (mapping) =>
    mapping.coingeckoId));
  const snapshots = new Map<InstrumentKey, ProviderMarketSnapshot>();
  for (const ids of chunks([...byId.keys()])) {
    const query = new URLSearchParams({
      vs_currency: 'usd',
      ids: ids.join(','),
      per_page: String(ids.length),
      page: '1',
      sparkline: 'false',
      price_change_percentage: '24h',
      precision: 'full',
    });
    const response = await http.getJson<unknown>(
      `${COINGECKO_PUBLIC_ROOT}/coins/markets?${query.toString()}`,
    );
    if (!response.ok) {
      return { ok: false, code: 'request_failed', status: response.status };
    }
    if (!Array.isArray(response.data)) {
      return { ok: false, code: 'invalid_payload', status: response.status };
    }
    for (const value of response.data) {
      if (!isRecord(value) || typeof value['id'] !== 'string') continue;
      const entries = byId.get(value['id']);
      const priceUsd = usd((value as CoinGeckoRow).current_price);
      if (!entries || priceUsd === null) continue;
      for (const entry of entries) {
        snapshots.set(instrumentKey(entry.instrument), {
          provider: 'coingecko',
          providerId: entry.providerId,
          instrument: entry.instrument,
          priceUsd,
          marketCapUsd: usd((value as CoinGeckoRow).market_cap, true),
          volume24hUsd: usd((value as CoinGeckoRow).total_volume, true),
          marketCapRank: positiveInteger((value as CoinGeckoRow).market_cap_rank),
          change24hPct: finite((value as CoinGeckoRow).price_change_percentage_24h),
          providerUpdatedAtMs: timestamp((value as CoinGeckoRow).last_updated),
        });
      }
    }
  }
  return { ok: true, snapshots };
}

export function createCoinGeckoDemoMarketSource(http: HttpClient): ProviderMarketSource {
  return {
    name: 'coingecko',
    fetch: (mappings) => fetchCoinGeckoDemoSnapshots(http, mappings),
  };
}
