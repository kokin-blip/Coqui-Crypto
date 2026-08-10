import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  type InstrumentIdentity,
  type MarketBar,
} from '@coqui/core';
import { syncCoinbaseDecisionDataset } from '../packages/services/src/index.js';
import { listMarketBars, openDatabase } from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);
const NOW = START + 5 * DAY + 10 * 60_000;
const BTC: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};
const ETH: InstrumentIdentity = {
  venue: 'coinbase', productId: 'ETH-USD', productType: 'spot',
};

function bar(instrument: InstrumentIdentity, day: number, close: number): MarketBar {
  const startTimeMs = START + day * DAY;
  return {
    assetId: instrumentKey(instrument), source: 'coinbase', interval: '1d',
    startTimeMs, endTimeMs: startTimeMs + DAY, open: close - 1,
    high: close + 1, low: close - 2, close, volume: 100,
    isComplete: startTimeMs + DAY + 5 * 60_000 <= NOW,
    retrievedAtMs: NOW, quality: 'reported_ohlc',
  };
}

function history(instrument: InstrumentIdentity, firstDay = 2): MarketBar[] {
  const rows = [
    bar(instrument, firstDay, 100 + firstDay),
    bar(instrument, firstDay + 1, 101 + firstDay),
    bar(instrument, firstDay + 2, 102 + firstDay),
  ];
  if (firstDay + 2 !== 5) rows.push(bar(instrument, 5, 105));
  return rows;
}

function fetcher(histories: ReadonlyMap<string, MarketBar[]>) {
  return async (instrument: InstrumentIdentity) => ({
    ok: true as const,
    status: 200,
    data: histories.get(instrument.productId) ?? [],
  });
}

describe('Coinbase decision dataset service', () => {
  it('fetches, caches, aligns, freshness-checks, and hashes completed bars', async () => {
    const database = openDatabase(':memory:');
    const result = await syncCoinbaseDecisionDataset({
      database, instruments: [ETH, BTC], maxDays: 10, minAlignedDays: 3, nowMs: NOW,
      fetchDailyBars: fetcher(new Map([
        [BTC.productId, history(BTC)], [ETH.productId, history(ETH)],
      ])),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.assets).toEqual([instrumentKey(BTC), instrumentKey(ETH)]);
    expect(result.dataset.dayKeys).toEqual(['2025-01-03', '2025-01-04', '2025-01-05']);
    expect(result.provenance).toEqual(expect.objectContaining({
      source: 'coinbase', interval: '1d', requestedMaxDays: 10,
      datasetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      excludedIncompleteBarsByAsset: {
        [instrumentKey(BTC)]: 1,
        [instrumentKey(ETH)]: 1,
      },
    }));
    expect(listMarketBars(BTC, database)).toHaveLength(4);
    expect(Object.isFrozen(result.dataset.report)).toBe(true);

    const repeated = await syncCoinbaseDecisionDataset({
      database, instruments: [BTC, ETH], maxDays: 10, minAlignedDays: 3, nowMs: NOW,
      fetchDailyBars: fetcher(new Map([
        [BTC.productId, history(BTC)], [ETH.productId, history(ETH)],
      ])),
    });
    expect(repeated.ok && repeated.dataset.report.datasetHash)
      .toBe(result.dataset.report.datasetHash);
    database.close();
  });

  it('persists nothing when any requested provider fetch fails', async () => {
    const database = openDatabase(':memory:');
    const result = await syncCoinbaseDecisionDataset({
      database, instruments: [BTC, ETH], maxDays: 10, nowMs: NOW,
      fetchDailyBars: async (instrument) => instrument.productId === BTC.productId
        ? { ok: true, status: 200, data: history(BTC) }
        : { ok: false, status: 503, reason: 'http', retried: 3 },
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'fetch_failed' }));
    expect(listMarketBars(BTC, database)).toEqual([]);
    database.close();
  });

  it('rejects wrong canonical identities and discontinuous provider rows before storage', async () => {
    const database = openDatabase(':memory:');
    const wrong = await syncCoinbaseDecisionDataset({
      database, instruments: [BTC], maxDays: 10, nowMs: NOW,
      fetchDailyBars: async () => ({ ok: true, status: 200, data: [bar(ETH, 4, 100)] }),
    });
    expect(wrong).toEqual(expect.objectContaining({ ok: false, code: 'invalid_provider_data' }));
    expect(listMarketBars(BTC, database)).toEqual([]);

    const gap = await syncCoinbaseDecisionDataset({
      database, instruments: [BTC], maxDays: 10, nowMs: NOW,
      fetchDailyBars: async () => ({
        ok: true, status: 200, data: [bar(BTC, 2, 100), bar(BTC, 4, 102)],
      }),
    });
    expect(gap).toEqual(expect.objectContaining({ ok: false, code: 'invalid_provider_data' }));
    expect(listMarketBars(BTC, database)).toEqual([]);
    database.close();
  });

  it('supports explicit intersection but defaults research alignment to reject-on-gap', async () => {
    const histories = new Map([
      [BTC.productId, history(BTC, 2)],
      [ETH.productId, history(ETH, 3)],
    ]);
    const strictDatabase = openDatabase(':memory:');
    const strict = await syncCoinbaseDecisionDataset({
      database: strictDatabase, instruments: [BTC, ETH], maxDays: 10,
      minAlignedDays: 2, nowMs: NOW, fetchDailyBars: fetcher(histories),
    });
    expect(strict).toEqual(expect.objectContaining({ ok: false, code: 'alignment_failed' }));
    strictDatabase.close();

    const intersectionDatabase = openDatabase(':memory:');
    const intersection = await syncCoinbaseDecisionDataset({
      database: intersectionDatabase, instruments: [BTC, ETH], maxDays: 10,
      minAlignedDays: 2, policy: 'intersection', nowMs: NOW,
      fetchDailyBars: fetcher(histories),
    });
    expect(intersection.ok).toBe(true);
    if (intersection.ok) expect(intersection.dataset.dayKeys)
      .toEqual(['2025-01-04', '2025-01-05']);
    intersectionDatabase.close();
  });

  it('fails closed when the latest completed UTC bar is stale', async () => {
    const database = openDatabase(':memory:');
    const result = await syncCoinbaseDecisionDataset({
      database, instruments: [BTC], maxDays: 10, minAlignedDays: 2, nowMs: NOW,
      fetchDailyBars: async () => ({
        ok: true, status: 200, data: [bar(BTC, 2, 100), bar(BTC, 3, 101)],
      }),
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'stale_data' }));
    database.close();
  });

  it('stores small provider numbers without exponent notation', async () => {
    const database = openDatabase(':memory:');
    const tiny = { ...bar(BTC, 4, 1), open: 1e-8, low: 1e-8, close: 1e-8, high: 2e-8 };
    const result = await syncCoinbaseDecisionDataset({
      database, instruments: [BTC], maxDays: 1, nowMs: NOW,
      fetchDailyBars: async () => ({ ok: true, status: 200, data: [tiny] }),
    });
    expect(result.ok).toBe(true);
    expect(listMarketBars(BTC, database)[0]?.open).toBe('0.00000001');
    database.close();
  });
});
