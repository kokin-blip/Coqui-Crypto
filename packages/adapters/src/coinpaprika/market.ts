import type { InstrumentKey } from '@coqui/core';

import type { HttpClient } from '../http/index.js';
import {
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

export const COINPAPRIKA_HOST = 'api.coinpaprika.com';
export const COINPAPRIKA_ROOT = `https://${COINPAPRIKA_HOST}/v1`;

interface CoinPaprikaRow {
  id?: unknown;
  rank?: unknown;
  last_updated?: unknown;
  quotes?: unknown;
}

interface CoinPaprikaQuote {
  price?: unknown;
  volume_24h?: unknown;
  market_cap?: unknown;
  percent_change_24h?: unknown;
}

/** Fetch the free all-tickers batch and join only through explicit Paprika IDs. */
export async function fetchCoinPaprikaSnapshots(
  http: HttpClient,
  mappings: readonly ProviderAssetMapping[],
): Promise<ProviderBatchResult> {
  const byId = entriesByProviderId(registryEntries(mappings, (mapping) =>
    mapping.coinPaprikaId));
  if (byId.size === 0) return { ok: true, snapshots: new Map() };
  const response = await http.getJson<unknown>(`${COINPAPRIKA_ROOT}/tickers?quotes=USD`);
  if (!response.ok) {
    return { ok: false, code: 'request_failed', status: response.status };
  }
  if (!Array.isArray(response.data)) {
    return { ok: false, code: 'invalid_payload', status: response.status };
  }
  const snapshots = new Map<InstrumentKey, ProviderMarketSnapshot>();
  for (const value of response.data) {
    if (!isRecord(value) || typeof value['id'] !== 'string') continue;
    const entries = byId.get(value['id']);
    const quotes = (value as CoinPaprikaRow).quotes;
    const quote = isRecord(quotes) && isRecord(quotes['USD'])
      ? quotes['USD'] as CoinPaprikaQuote
      : null;
    const priceUsd = usd(quote?.price);
    if (!entries || quote === null || priceUsd === null) continue;
    for (const entry of entries) {
      snapshots.set(entry.key, {
        provider: 'coinpaprika',
        providerId: entry.providerId,
        instrument: entry.instrument,
        priceUsd,
        marketCapUsd: usd(quote.market_cap, true),
        volume24hUsd: usd(quote.volume_24h, true),
        marketCapRank: positiveInteger((value as CoinPaprikaRow).rank),
        change24hPct: finite(quote.percent_change_24h),
        providerUpdatedAtMs: timestamp((value as CoinPaprikaRow).last_updated),
      });
    }
  }
  return { ok: true, snapshots };
}

export function createCoinPaprikaMarketSource(http: HttpClient): ProviderMarketSource {
  return {
    name: 'coinpaprika',
    fetch: (mappings) => fetchCoinPaprikaSnapshots(http, mappings),
  };
}
