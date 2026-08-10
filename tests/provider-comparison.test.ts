import { describe, expect, it } from 'vitest';

import {
  type MarketProviderName,
  type ProviderAssetMapping,
  type ProviderBatchResult,
  type ProviderMarketSnapshot,
  type ProviderMarketSource,
} from '../packages/adapters/src/index.js';
import type { InstrumentIdentity } from '../packages/core/src/index.js';
import { compareMarketProviders } from '../packages/services/src/index.js';

const BTC: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'BTC-USD',
  productType: 'spot',
};

const mapping: ProviderAssetMapping = {
  instrument: BTC,
  coingeckoId: 'bitcoin',
  coinMarketCapId: 1,
  coinPaprikaId: 'btc-bitcoin',
};

type ProviderKey = Extract<ProviderBatchResult, { ok: true }>['snapshots'] extends
  ReadonlyMap<infer Key, unknown> ? Key : never;
const BTC_KEY = 'coinbase|spot|BTC-USD' as ProviderKey;

function source(provider: MarketProviderName, priceUsd: string): ProviderMarketSource {
  const snapshot: ProviderMarketSnapshot = {
    provider,
    providerId: provider,
    instrument: BTC,
    priceUsd: priceUsd as ProviderMarketSnapshot['priceUsd'],
    marketCapUsd: null,
    volume24hUsd: null,
    marketCapRank: null,
    change24hPct: null,
    providerUpdatedAtMs: null,
  };
  return {
    name: provider,
    async fetch() {
      return {
        ok: true,
        snapshots: new Map<ProviderKey, ProviderMarketSnapshot>([[BTC_KEY, snapshot]]),
      };
    },
  };
}

describe('compareMarketProviders', () => {
  it('reports latency, explicit-ID coverage, and symmetric price deviations', async () => {
    const times = [0, 0, 0, 1, 2, 3];
    const report = await compareMarketProviders({
      sources: [
        source('coingecko', '100'),
        source('coinmarketcap', '101'),
        source('coinpaprika', '99'),
      ],
      mappings: [mapping],
      now: () => times.shift()!,
    });

    expect(report.providers.map((provider) => ({
      provider: provider.provider,
      latencyMs: provider.latencyMs,
      coveragePct: provider.coveragePct,
    }))).toEqual([
      { provider: 'coingecko', latencyMs: 1, coveragePct: 100 },
      { provider: 'coinmarketcap', latencyMs: 2, coveragePct: 100 },
      { provider: 'coinpaprika', latencyMs: 3, coveragePct: 100 },
    ]);
    expect(report.priceDeviations).toHaveLength(3);
    expect(report.priceDeviations[0]).toMatchObject({
      left: 'coingecko',
      right: 'coinmarketcap',
      midpointDeviationBps: 99.5,
    });
  });

  it('reports request failure without provider response text', async () => {
    const secret = 'not-in-report';
    const failed: ProviderMarketSource = {
      name: 'coinmarketcap',
      fetch: async () => ({ ok: false, code: 'request_failed', status: 401 }),
    };
    const report = await compareMarketProviders({
      sources: [failed],
      mappings: [mapping],
      now: () => 1,
    });
    expect(report.providers[0]).toMatchObject({
      ok: false,
      status: 401,
      coveragePct: 0,
    });
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
