import type { InstrumentKey } from '@coqui/core';

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

export const COINMARKETCAP_HOST = 'pro-api.coinmarketcap.com';
export const COINMARKETCAP_ROOT = `https://${COINMARKETCAP_HOST}`;

interface CoinMarketCapResponse {
  data?: unknown;
}

interface CoinMarketCapRow {
  id?: unknown;
  cmc_rank?: unknown;
  quote?: unknown;
}

interface CoinMarketCapQuote {
  symbol?: unknown;
  price?: unknown;
  volume_24h?: unknown;
  percent_change_24h?: unknown;
  market_cap?: unknown;
  last_updated?: unknown;
}

/** Create a CMC client whose key is added only to its production HTTPS host. */
export function createCoinMarketCapHttpClient(
  apiKey: string,
  options: HttpClientOptions = {},
): HttpClient {
  return createAuthenticatedHttpClient({
    ...options,
    hostname: COINMARKETCAP_HOST,
    headerName: 'X-CMC_PRO_API_KEY',
    apiKey,
  });
}

function usdQuote(value: unknown): CoinMarketCapQuote | null {
  if (!Array.isArray(value)) return null;
  const quote = value.find((candidate) =>
    isRecord(candidate) && candidate['symbol'] === 'USD');
  return isRecord(quote) ? quote as CoinMarketCapQuote : null;
}

/** Fetch CMC V3 quotes through explicit numeric IDs, never ticker symbols. */
export async function fetchCoinMarketCapSnapshots(
  http: HttpClient,
  mappings: readonly ProviderAssetMapping[],
): Promise<ProviderBatchResult> {
  const byId = entriesByProviderId(registryEntries(mappings, (mapping) => {
    const id = mapping.coinMarketCapId;
    return id !== null && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  }));
  const snapshots = new Map<InstrumentKey, ProviderMarketSnapshot>();
  for (const ids of chunks([...byId.keys()])) {
    const query = new URLSearchParams({
      id: ids.join(','),
      convert: 'USD',
      skip_invalid: 'true',
    });
    const response = await http.getJson<CoinMarketCapResponse>(
      `${COINMARKETCAP_ROOT}/v3/cryptocurrency/quotes/latest?${query.toString()}`,
    );
    if (!response.ok) {
      return { ok: false, code: 'request_failed', status: response.status };
    }
    if (!isRecord(response.data) || !Array.isArray(response.data['data'])) {
      return { ok: false, code: 'invalid_payload', status: response.status };
    }
    for (const value of response.data['data']) {
      if (!isRecord(value) || typeof value['id'] !== 'number') continue;
      const providerId = String(value['id']);
      const entries = byId.get(providerId);
      const quote = usdQuote((value as CoinMarketCapRow).quote);
      const priceUsd = usd(quote?.price);
      if (!entries || quote === null || priceUsd === null) continue;
      for (const entry of entries) {
        snapshots.set(entry.key, {
          provider: 'coinmarketcap',
          providerId,
          instrument: entry.instrument,
          priceUsd,
          marketCapUsd: usd(quote.market_cap, true),
          volume24hUsd: usd(quote.volume_24h, true),
          marketCapRank: positiveInteger((value as CoinMarketCapRow).cmc_rank),
          change24hPct: finite(quote.percent_change_24h),
          providerUpdatedAtMs: timestamp(quote.last_updated),
        });
      }
    }
  }
  return { ok: true, snapshots };
}

export function createCoinMarketCapMarketSource(http: HttpClient): ProviderMarketSource {
  return {
    name: 'coinmarketcap',
    fetch: (mappings) => fetchCoinMarketCapSnapshots(http, mappings),
  };
}
