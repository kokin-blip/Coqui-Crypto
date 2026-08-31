import { describe, expect, it } from 'vitest';

import type { AssetCatalog } from '../packages/core/src/index.js';
import { CoinbaseDisplayDataService, type DisplayBarSource } from '../packages/services/src/index.js';
import { listDisplayBars, openDatabase } from '../packages/storage/src/index.js';

const BTC = Object.freeze({
  instrument: Object.freeze({ venue: 'coinbase' as const, productId: 'BTC-USD', productType: 'spot' as const }),
  symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: null,
});

function catalog(): AssetCatalog {
  return {
    name: 'fixture',
    search: async (query, limit) => query.toLowerCase().includes('btc') ? [BTC].slice(0, limit) : [],
    page: async (_offset, limit) => [BTC].slice(0, limit),
  };
}

describe('Coinbase display-data workstation boundary', () => {
  it('persists completed bars in the profile display cache only', async () => {
    const database = openDatabase(':memory:');
    let calls = 0;
    const source: DisplayBarSource = {
      async fetch(input) {
        calls += 1;
        return { ok: true, bars: [{
          productId: input.instrument.productId, interval: input.interval,
          startTimeMs: input.startTimeMs, endTimeMs: input.startTimeMs + 60_000,
          open: '100.10', high: '101.20', low: '99.90', close: '100.80',
          volume: '2.125', isComplete: true, retrievedAtMs: input.nowMs,
        }] };
      },
    };
    const nowMs = 2_000_000_000_000;
    const service = new CoinbaseDisplayDataService({
      profileId: 'main', database, catalog: catalog(), source, nowMs: () => nowMs,
    });
    const result = await service.bars({
      productId: 'BTC-USD', interval: '1m',
      startTimeMs: nowMs - 120_000, endTimeMs: nowMs - 60_000,
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
    expect(listDisplayBars({
      profileId: 'main', productId: 'BTC-USD', interval: '1m',
      startTimeMs: nowMs - 120_000, endTimeMs: nowMs,
    }, database)).toMatchObject([{ close: '100.80' }]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM market_bars_v2").get())
      .toEqual({ count: 0 });
    database.close();
  });

  it('enforces retention and keeps profile caches isolated', async () => {
    const database = openDatabase(':memory:');
    const nowMs = 2_000_000_000_000;
    const source: DisplayBarSource = { fetch: async () => ({ ok: true, bars: [] }) };
    const main = new CoinbaseDisplayDataService({
      profileId: 'main', database, catalog: catalog(), source, nowMs: () => nowMs,
    });
    const outside = await main.bars({
      productId: 'BTC-USD', interval: '1m',
      startTimeMs: nowMs - 3 * 86_400_000, endTimeMs: nowMs - 2 * 86_400_000,
    });
    expect(outside).toMatchObject({ ok: false, issues: [{ code: 'outside_retention' }] });
    expect(await main.products('btc', 20)).toMatchObject({
      ok: true, value: { products: [{ symbol: 'BTC' }] },
    });
    database.close();
  });
});
