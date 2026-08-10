import {
  createTrialRegistry,
  instrumentKey,
  registerTrials,
  type TrialRegistrySnapshot,
  type TrialRegistryCompleteness,
  type TradeCostConfig,
} from '../packages/core/src/index.js';

export const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
export const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

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
