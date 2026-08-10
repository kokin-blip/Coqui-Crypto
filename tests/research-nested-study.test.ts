import { describe, expect, it } from 'vitest';

import {
  buildDecisionMarketDataset,
  createTrialRegistry,
  DEFAULT_TRADE_COST_CONFIG,
  expandResearchGrid,
  gridCandidateCount,
  instrumentKey,
  runNestedChronologicalStudy,
  tradeCostConfigHash,
  type DecisionMarketDataset,
  type MarketBar,
  type ResearchPreRegistration,
} from '../packages/core/src/index.js';
import {
  registerResearchPreRegistration,
  runRegisteredNestedStudy,
} from '../packages/services/src/index.js';
import {
  loadTrialRegistry,
  openDatabase,
} from '../packages/storage/src/index.js';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2020, 0, 1);
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

function dataset(holdoutMultiplier = 1): DecisionMarketDataset {
  const totalDays = 122;
  const rows = (assetId: typeof BTC, offset: number): MarketBar[] =>
    Array.from({ length: totalDays }, (_, day) => {
      const developmentPrice = 100 + offset + day * (assetId === BTC ? 0.5 : 0.35) +
        Math.sin(day / 5) * (assetId === BTC ? 3 : 5);
      const close = day < 90 ? developmentPrice : developmentPrice * holdoutMultiplier;
      return {
        assetId,
        source: 'fixture',
        interval: '1d',
        startTimeMs: START_MS + day * DAY_MS,
        endTimeMs: START_MS + (day + 1) * DAY_MS,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1_000,
        isComplete: true,
        retrievedAtMs: START_MS + totalDays * DAY_MS,
        quality: 'reported_ohlc',
      };
    });
  return buildDecisionMarketDataset({
    [BTC]: rows(BTC, 0),
    [ETH]: rows(ETH, 20),
  }, [BTC, ETH], {
    policy: 'reject-on-gap',
    nowMs: START_MS + (totalDays + 1) * DAY_MS,
  });
}

function planFor(data: DecisionMarketDataset): ResearchPreRegistration {
  const parameterSpace = {
    lookbackDays: [5, 10],
    volatilityDays: [5],
    maxRelativeTilt: [0.35],
    defensiveScale: [0.2],
    targetVolatilityPct: [55],
    targetVolPct: [40],
    volLookbackDays: [5],
    minExposure: [0.1],
    maxExposure: [1],
    trendGateDays: [10],
    belowTrendMaxExposure: [0.7],
    rebalanceEveryDays: [7],
  } as const;
  return {
    schemaVersion: 1,
    id: 'nested-trendvol-test',
    registeredAt: '2026-08-09T00:00:00.000Z',
    family: 'trendvol',
    hypothesis: 'Trend-vol produces positive excess returns on untouched data.',
    parameterSpace,
    candidateCount: gridCandidateCount(parameterSpace),
    datasetHash: data.report.datasetHash,
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision: 'nested-test-revision',
    execution: {
      baseTargets: [
        { assetId: BTC, weight: 0.5 },
        { assetId: ETH, weight: 0.5 },
      ],
      warmupBars: 10,
      cashAprPct: 0,
    },
    validation: {
      development: {
        startMs: START_MS,
        endExclusiveMs: START_MS + 90 * DAY_MS,
      },
      holdout: {
        startMs: START_MS + 90 * DAY_MS,
        endExclusiveMs: START_MS + 122 * DAY_MS,
      },
      nestedFoldCount: 3,
      embargoDays: 2,
      minimumDevelopmentBars: 90,
      minimumHoldoutBars: 30,
      cscvPartitionCount: 4,
      bootstrapResamples: 500,
      bootstrapMeanBlockLength: 5,
      bootstrapConfidenceLevel: 0.95,
      bootstrapSeed: 7,
    },
    primaryMetric: 'after-cost-excess-return-vs-hold',
    adoptionRules: {
      minimumDeflatedSharpeProbability: 0.95,
      requirePositiveExcessReturnVsHold: true,
      requirePositiveExcessReturnVsPassive: true,
      rejectIfSignificanceUnavailable: true,
      maximumDrawdownPct: 35,
      maximumProbabilityOfBacktestOverfitting: 0.05,
    },
    studyRef: 'docs/studies/cost-correct-preregistration-2026-08-09.md',
  };
}

describe('plan-driven nested chronological research', () => {
  it('expands the exact frozen grid deterministically', () => {
    const plan = planFor(dataset());
    const first = expandResearchGrid(plan);
    const second = expandResearchGrid(plan);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(new Set(first.map((candidate) => candidate.id)).size).toBe(2);
  });

  it('keeps final-holdout changes out of selection and fold results', () => {
    const originalDataset = dataset();
    const alteredDataset = dataset(0.4);
    const original = runNestedChronologicalStudy(
      planFor(originalDataset),
      originalDataset,
      DEFAULT_TRADE_COST_CONFIG,
      createTrialRegistry('known-lower-bound'),
    );
    const altered = runNestedChronologicalStudy(
      planFor(alteredDataset),
      alteredDataset,
      DEFAULT_TRADE_COST_CONFIG,
      createTrialRegistry('known-lower-bound'),
    );
    expect(altered.selectedCandidate).toEqual(original.selectedCandidate);
    expect(altered.developmentScores).toEqual(original.developmentScores);
    expect(altered.folds).toEqual(original.folds);
    expect(altered.pbo).toEqual(original.pbo);
    expect(altered.holdout.afterCostReturnPct).not.toBe(original.holdout.afterCostReturnPct);
  });

  it('records every attempted candidate and withholds adoption without exact history', () => {
    const data = dataset();
    const plan = planFor(data);
    const database = openDatabase(':memory:');
    const planHash = registerResearchPreRegistration(plan, database);
    const result = runRegisteredNestedStudy({
      preRegistrationHash: planHash,
      dataset: data,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      codeRevision: plan.codeRevision,
      completedAtMs: Date.UTC(2026, 7, 9, 1),
    }, database);
    const registry = loadTrialRegistry(database);
    expect(registry.records).toHaveLength(1);
    expect(registry.records[0]).toEqual(expect.objectContaining({
      id: `pre-registration:${plan.id}`,
      evidenceStatus: 'verified',
      trialCount: 2,
      datasetHash: plan.datasetHash,
    }));
    expect(result.holdout.dsr).toBeNull();
    expect(result.holdout.benchmarkConfidence.hold.status).toBe('available');
    expect(result.holdout.benchmarkConfidence.passive.status).toBe('available');
    expect(result.pbo).toEqual(expect.objectContaining({
      status: 'available',
      combinationCount: 6,
    }));
    expect(result.folds).toHaveLength(2);
    expect(result.developmentScores.every((item) => item.validationSegments === 3)).toBe(true);
    expect(result.holdout.checks.significanceAvailable).toBe(false);
    expect(result.holdout.adopted).toBe(false);
    expect(() => runRegisteredNestedStudy({
      preRegistrationHash: planHash,
      dataset: data,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      codeRevision: plan.codeRevision,
      completedAtMs: Date.UTC(2026, 7, 9, 2),
    }, database)).toThrow(/already been executed/u);
    database.close();
  });

  it('rejects any cost profile not frozen by the plan', () => {
    const data = dataset();
    const plan = planFor(data);
    const database = openDatabase(':memory:');
    const planHash = registerResearchPreRegistration(plan, database);
    expect(() => runRegisteredNestedStudy({
      preRegistrationHash: planHash,
      dataset: data,
      tradeCosts: { ...DEFAULT_TRADE_COST_CONFIG, feeBps: 1 },
      codeRevision: plan.codeRevision,
      completedAtMs: Date.UTC(2026, 7, 9, 1),
    }, database)).toThrow(/costs do not match/u);
    expect(loadTrialRegistry(database).records).toHaveLength(0);
    database.close();
  });
});
