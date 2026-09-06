import {
  createTrialRegistry,
  buildDecisionMarketDataset,
  instrumentKey,
  registerTrials,
  type TrialRegistrySnapshot,
  type TrialRegistryCompleteness,
  type TradeCostConfig,
  type InstrumentIdentity,
  type Holding,
} from '../packages/core/src/index.js';
import type { PaperDecisionPreparation } from '../packages/services/src/index.js';
import { initializePaperBook, type Db } from '../packages/storage/src/index.js';

export const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
export const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

export function paperPreparation(
  instruments: readonly InstrumentIdentity[],
  latestStartMs: number,
): Extract<PaperDecisionPreparation, { ok: true }> {
  const day = 86_400_000;
  const input = Object.fromEntries(instruments.map((instrument) => {
    const assetId = instrumentKey(instrument);
    return [assetId, Array.from({ length: 121 }, (_, index) => {
      const startTimeMs = latestStartMs - (120 - index) * day;
      const price = 100 + index;
      return {
        assetId, source: 'coinbase' as const, interval: '1d' as const,
        startTimeMs, endTimeMs: startTimeMs + day, open: price, high: price + 1,
        low: price - 1, close: price, volume: 100, isComplete: true,
        retrievedAtMs: latestStartMs + day + 10 * 60_000, quality: 'reported_ohlc' as const,
      };
    })];
  }));
  const dataset = buildDecisionMarketDataset(input, instruments.map(instrumentKey), {
    policy: 'reject-on-gap',
    nowMs: latestStartMs + day + 10 * 60_000,
    expectedSource: 'coinbase',
  });
  return {
    ok: true,
    datasetHash: dataset.report.datasetHash,
    dataset,
    latestCompletedStartMs: latestStartMs,
    expectedCompletedStartMs: latestStartMs,
    ruleSnapshotHash: 'e'.repeat(64),
  };
}

export function seedPaperOrigin(
  database: Db,
  profileId: string,
  holdings: readonly Holding[],
  at: number,
): void {
  initializePaperBook({
    schemaVersion: 1,
    profileId,
    source: 'tracked_holdings_opening',
    balances: holdings.map((holding) => ({
      assetId: instrumentKey(holding.asset.instrument),
      quantity: holding.quantity,
      priceUsd: holding.priceUsd!,
      valueUsd: holding.valueUsd!,
    })).sort((left, right) => left.assetId < right.assetId ? -1 : 1),
    cashUsd: '0',
    asOfMs: at,
  }, database);
}

/** Explicit frictionless profile for tests that isolate strategy mechanics. */
export const NO_TRADE_COSTS: TradeCostConfig = {
  modelVersion: 'test-frictionless-v1',
  feeBps: 0,
  spreadBps: 0,
  slippageBps: 0,
  minUsefulTradeUsd: 25,
};

export function trialRegistry(
  trialCount: number,
  completeness: TrialRegistryCompleteness = 'complete',
): TrialRegistrySnapshot {
  return registerTrials(createTrialRegistry(completeness), {
    id: `test-study-${trialCount}`,
    family: 'trendvol',
    searchKind: 'grid',
    evidenceStatus: 'verified',
    parameterSpace: { trial: Array.from({ length: trialCount }, (_, index) => index) },
    trialCount,
    searchedAt: '2026-08-01T00:00:00.000Z',
    datasetHash: 'a'.repeat(64),
    costProfileHash: 'b'.repeat(64),
    codeRevision: 'test-revision',
    producedDefaults: {},
    studyRef: 'docs/studies/test-fixture.md',
  });
}
