import { describe, expect, it } from 'vitest';

import type { EvidenceSnapshot, InstrumentIdentity } from '@coqui/core';
import {
  finalizeInterruptedResearchRuns,
  getResearchJob,
  latestDailyCloseTime,
  latestProviderHistoryDay,
  listDailyCloses,
  listEvidenceSnapshots,
  listMarketBars,
  listProviderHistory,
  listResearchRuns,
  openDatabase,
  recoverInterruptedResearchJobs,
  saveEvidenceSnapshot,
  saveResearchJob,
  saveResearchRun,
  upsertDailyCloses,
  upsertMarketBars,
  upsertProviderHistory,
  type MarketBarRecord,
  type StoredResearchJob,
} from '../packages/storage/src/index.js';

const btc: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};
const wbtc: InstrumentIdentity = {
  venue: 'coinbase', productId: 'WBTC-USD', productType: 'spot',
};

function bar(instrument = btc, close = '101.123456789123456789'): MarketBarRecord {
  return {
    source: 'coinbase', instrument, providerAssetId: instrument.productId, interval: '1d',
    startTimeMs: 0, endTimeMs: 86_400_000, open: '100', high: '102', low: '99', close,
    volume: '123.000000000000000001', isComplete: true, quality: 'reported_ohlc',
    retrievedAtMs: 86_400_001,
  };
}

function job(id: string, snapshotJson: string | null): StoredResearchJob {
  return {
    id, kind: 'matrix', status: 'running', createdAt: 1, startedAt: 2,
    completedAt: null, requestJson: '{"trial":"registered"}', snapshotJson,
    progressJson: '{"percent":10}', resultJson: null, error: null,
  };
}

describe('canonical market-data persistence', () => {
  it('keeps colliding symbols separate and preserves decimal bar text', () => {
    const database = openDatabase(':memory:');
    upsertDailyCloses(btc, [{ timeS: 100, close: 10 }], database);
    upsertDailyCloses(wbtc, [{ timeS: 100, close: 20 }], database);
    expect(listDailyCloses(btc, database)[0]?.close).toBe(10);
    expect(listDailyCloses(wbtc, database)[0]?.close).toBe(20);
    expect(latestDailyCloseTime(btc, database)).toBe(100);

    upsertMarketBars([bar(), bar(wbtc, '202')], database);
    expect(listMarketBars(btc, database)).toEqual([bar()]);
    expect(listMarketBars(wbtc, database)[0]?.close).toBe('202');
    database.close();
  });

  it('rolls back an invalid market-bar batch', () => {
    const database = openDatabase(':memory:');
    expect(() => upsertMarketBars([bar(), bar(btc, 'not-a-decimal')], database))
      .toThrow('non-negative decimal');
    expect(listMarketBars(btc, database)).toEqual([]);
    database.close();
  });

  it('round-trips provider history without using it as a venue identity', () => {
    const database = openDatabase(':memory:');
    const point = {
      source: 'coinmarketcap', providerAssetId: '1', dayS: 86_400,
      open: 100, high: 110, low: 90, close: 105, marketCapUsd: 1_000_000,
      volume24hUsd: 10_000, fetchedAt: 90_000,
    };
    upsertProviderHistory([point], database);
    expect(listProviderHistory('coinmarketcap', '1', database)).toEqual([point]);
    expect(latestProviderHistoryDay('coinmarketcap', '1', database)).toBe(86_400);
    database.close();
  });
});

describe('registered research persistence', () => {
  it('keeps manifests immutable and detects result tampering', () => {
    const database = openDatabase(':memory:');
    saveResearchRun({
      id: 'run-1', status: 'running', createdAt: 1, completedAt: null,
      manifestJson: '{"seed":7}', resultJson: null, error: null,
    }, database);
    expect(() => saveResearchRun({
      id: 'run-1', status: 'completed', createdAt: 1, completedAt: 2,
      manifestJson: '{"seed":8}', resultJson: '{}', error: null,
    }, database)).toThrow('registered manifest');
    expect(finalizeInterruptedResearchRuns(3, database)).toBe(1);
    expect(listResearchRuns(database)[0]?.status).toBe('failed');

    saveResearchJob({ ...job('job-1', '{"bars":365}'), status: 'completed',
      completedAt: 4, resultJson: '{"edge":false}' }, database);
    database.prepare("UPDATE research_jobs SET result_json = '{\"edge\":true}' WHERE id = 'job-1'").run();
    expect(getResearchJob('job-1', database)).toEqual(expect.objectContaining({
      status: 'failed', errorCode: 'integrity_mismatch', resultJson: null,
    }));
    database.close();
  });

  it('requeues only interrupted jobs with prepared snapshots', () => {
    const database = openDatabase(':memory:');
    saveResearchJob(job('prepared', '{"bars":365}'), database);
    saveResearchJob(job('unprepared', null), database);
    expect(recoverInterruptedResearchJobs(10, database)).toEqual({ requeued: 1, failed: 1 });
    expect(getResearchJob('prepared', database)?.status).toBe('queued');
    expect(getResearchJob('unprepared', database)?.status).toBe('failed');
    database.close();
  });
});

describe('evidence archive', () => {
  it('upserts one reproducible observation per day', () => {
    const database = openDatabase(':memory:');
    const snapshot: EvidenceSnapshot = {
      dayMs: 0, leader: 'passive', dsr: 0.5, psr: 0.6,
      sigVerdict: 'inconclusive', wfVerdict: 'matches_passive',
      leaderSortino: 1, holdSortino: 0.9, passiveSortino: 1, sampleDays: 100,
    };
    saveEvidenceSnapshot(snapshot, database);
    saveEvidenceSnapshot({ ...snapshot, sampleDays: 101 }, database);
    expect(listEvidenceSnapshots(database)).toEqual([{ ...snapshot, sampleDays: 101 }]);
    database.close();
  });
});
