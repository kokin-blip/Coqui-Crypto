import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  type InstrumentIdentity,
  type MarketBar,
} from '@coqui/core';
import {
  createStructuredLogger,
  createOperationalMetrics,
  type MetricObservation,
  type StructuredLogEntry,
} from '@coqui/observability';
import {
  captureCoinbaseUniverseSnapshot,
  syncCoinbaseDecisionDataset,
} from '../packages/services/src/index.js';
import { openDatabase } from '@coqui/storage';

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);
const NOW = START + 5 * DAY + 10 * 60_000;
const BTC: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};

function completedBar(): MarketBar {
  return {
    assetId: instrumentKey(BTC), source: 'coinbase', interval: '1d',
    startTimeMs: START + 4 * DAY, endTimeMs: START + 5 * DAY,
    open: 99, high: 102, low: 98, close: 101, volume: 10,
    isComplete: true, retrievedAtMs: NOW, quality: 'reported_ohlc',
  };
}

describe('market-data observability', () => {
  it('correlates dataset lifecycle events without logging market payloads', async () => {
    const database = openDatabase(':memory:');
    const entries: StructuredLogEntry[] = [];
    const observations: MetricObservation[] = [];
    let metricTime = 100;
    const logger = createStructuredLogger({
      sink: (entry) => entries.push(entry),
      minimumLevel: 'debug',
      timestamp: () => 'fixed',
    });
    const metrics = createOperationalMetrics({
      sink: (observation) => observations.push(observation),
      clock: () => { metricTime += 10; return metricTime; },
    });
    const result = await syncCoinbaseDecisionDataset({
      database,
      instruments: [BTC],
      maxDays: 1,
      nowMs: NOW,
      correlationId: 'dataset-run-7',
      logger,
      metrics,
      fetchDailyBars: async () => ({ ok: true, status: 200, data: [completedBar()] }),
    });

    expect(result.ok).toBe(true);
    expect(entries.map((entry) => entry.event)).toEqual([
      'market_dataset.sync_started',
      'market_dataset.bars_persisted',
      'market_dataset.sync_succeeded',
    ]);
    expect(entries.every((entry) => entry.context['correlationId'] === 'dataset-run-7')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('"open"');
    expect(JSON.stringify(entries)).not.toContain('"close"');
    expect(observations.map((observation) => observation.name)).toEqual([
      'market_data_provider_requests_total',
      'market_data_cached_bars',
      'market_data_freshness_ms',
      'market_data_aligned_days',
      'market_data_job_outcomes_total',
      'market_data_job_duration_ms',
    ]);
    expect(observations.find((observation) =>
      observation.name === 'market_data_job_outcomes_total')).toEqual(expect.objectContaining({
      kind: 'counter', value: 1,
      labels: expect.objectContaining({ operation: 'dataset_sync', outcome: 'success' }),
    }));
    expect(JSON.stringify(observations)).not.toContain('BTC-USD');
    database.close();
  });

  it('does not leak a thrown provider secret through failure logs', async () => {
    const database = openDatabase(':memory:');
    const entries: StructuredLogEntry[] = [];
    const logger = createStructuredLogger({ sink: (entry) => entries.push(entry) });
    const canary = 'provider-private-key-canary';

    const result = await captureCoinbaseUniverseSnapshot({
      database,
      observedAtMs: NOW,
      logger,
      correlationId: 'universe-run-3',
      fetchProducts: () => { throw new Error(`request failed with ${canary}`); },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'fetch_failed' }));
    expect(entries.map((entry) => entry.event)).toEqual([
      'market_universe.capture_started', 'market_universe.fetch_failed',
    ]);
    expect(JSON.stringify(entries)).not.toContain(canary);
    expect(entries[1]?.context).toEqual(expect.objectContaining({
      correlationId: 'universe-run-3', status: 0, reason: 'exception',
    }));
    database.close();
  });
});
