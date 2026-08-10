import { describe, expect, it } from 'vitest';

import {
  buildDecisionMarketDataset,
  instrumentKey,
  type InstrumentIdentity,
  type MarketBar,
  type UniverseProductObservation,
} from '@coqui/core';
import {
  bindPointInTimeUniverse,
  captureCoinbaseUniverseSnapshot,
} from '../packages/services/src/index.js';
import {
  getUniverseSnapshot,
  listUniverseSnapshots,
  openDatabase,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);
const BTC: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};
const ETH: InstrumentIdentity = {
  venue: 'coinbase', productId: 'ETH-USD', productType: 'spot',
};

function product(instrument: InstrumentIdentity, status = 'online'): UniverseProductObservation {
  return {
    instrument, baseAsset: instrument.productId.split('-')[0]!, quoteAsset: 'USD', status,
    tradingDisabled: false, cancelOnly: false, limitOnly: false, postOnly: false,
    baseIncrement: '0.00000001', quoteIncrement: '0.01', minMarketFunds: '1',
  };
}

function bar(instrument: InstrumentIdentity, day: number): MarketBar {
  const startTimeMs = START + day * DAY;
  return {
    assetId: instrumentKey(instrument), source: 'fixture', interval: '1d',
    startTimeMs, endTimeMs: startTimeMs + DAY, open: 100 + day,
    high: 102 + day, low: 99 + day, close: 101 + day, volume: 10,
    isComplete: true, retrievedAtMs: START + 10 * DAY, quality: 'reported_ohlc',
  };
}

describe('universe storage and service', () => {
  it('captures immutable snapshots and treats exact retries idempotently', async () => {
    const database = openDatabase(':memory:');
    const options = {
      database,
      observedAtMs: START + 12 * 60 * 60_000,
      fetchProducts: async () => ({
        ok: true as const, status: 200, data: [product(ETH), product(BTC)],
      }),
    };
    const first = await captureCoinbaseUniverseSnapshot(options);
    const retry = await captureCoinbaseUniverseSnapshot(options);
    expect(first.ok && first.created).toBe(true);
    expect(retry.ok && retry.created).toBe(false);
    expect(listUniverseSnapshots(database)).toHaveLength(1);
    if (first.ok) expect(getUniverseSnapshot(first.snapshot.id, database)).toEqual(first.snapshot);
    database.close();
  });

  it('detects stored membership tampering', async () => {
    const database = openDatabase(':memory:');
    const result = await captureCoinbaseUniverseSnapshot({
      database, observedAtMs: START + 1,
      fetchProducts: async () => ({ ok: true, status: 200, data: [product(BTC)] }),
    });
    expect(result.ok).toBe(true);
    database.prepare("UPDATE universe_product_observations SET status = 'delisted'").run();
    expect(() => listUniverseSnapshots(database)).toThrow('integrity');
    database.close();
  });

  it('binds contemporaneous eligibility and fails when any dataset day is uncovered', async () => {
    const database = openDatabase(':memory:');
    await captureCoinbaseUniverseSnapshot({
      database, observedAtMs: START + 12 * 60 * 60_000,
      fetchProducts: async () => ({
        ok: true, status: 200, data: [product(BTC), product(ETH)],
      }),
    });
    await captureCoinbaseUniverseSnapshot({
      database, observedAtMs: START + DAY + 12 * 60 * 60_000,
      fetchProducts: async () => ({
        ok: true, status: 200, data: [product(BTC), product(ETH, 'delisted')],
      }),
    });
    const dataset = buildDecisionMarketDataset({
      [instrumentKey(BTC)]: [bar(BTC, 1), bar(BTC, 2)],
      [instrumentKey(ETH)]: [bar(ETH, 1), bar(ETH, 2)],
    }, [instrumentKey(BTC), instrumentKey(ETH)], { nowMs: START + 10 * DAY });
    const bound = bindPointInTimeUniverse(dataset, database);
    expect(bound.ok).toBe(true);
    if (bound.ok) {
      expect(bound.value.eligibleDatasetAssetsByDay).toEqual({
        '2025-01-02': [instrumentKey(BTC), instrumentKey(ETH)],
        '2025-01-03': [instrumentKey(BTC)],
      });
      expect(bound.value.decisionContextHash).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(bound.value)).toBe(true);
    }

    const longer = buildDecisionMarketDataset({
      [instrumentKey(BTC)]: [bar(BTC, 1), bar(BTC, 2), bar(BTC, 3)],
    }, [instrumentKey(BTC)], { nowMs: START + 10 * DAY });
    expect(bindPointInTimeUniverse(longer, database)).toEqual(expect.objectContaining({
      ok: false, code: 'uncovered_universe_days', uncoveredDayKeys: ['2025-01-04'],
    }));
    database.close();
  });

  it('does not persist a failed capture', async () => {
    const database = openDatabase(':memory:');
    const result = await captureCoinbaseUniverseSnapshot({
      database, observedAtMs: START,
      fetchProducts: async () => ({
        ok: false, status: 503, reason: 'http', retried: 3,
      }),
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'fetch_failed' }));
    expect(listUniverseSnapshots(database)).toEqual([]);
    database.close();
  });
});
