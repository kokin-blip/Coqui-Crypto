import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRADE_COST_CONFIG,
  gridCandidateCount,
  researchPreRegistrationHash,
  tradeCostConfigHash,
  type ResearchPreRegistration,
} from '../packages/core/src/index.js';
import {
  registerResearchPreRegistration,
  verifiedResearchPreRegistrations,
} from '../packages/services/src/index.js';
import { openDatabase } from '../packages/storage/src/index.js';

function plan(overrides: Partial<ResearchPreRegistration> = {}): ResearchPreRegistration {
  const parameterSpace = overrides.parameterSpace ?? {
    lookbackDays: [90, 180],
    targetVolPct: [40, 50],
  };
  return {
    schemaVersion: 1,
    id: 'trendvol-replacement-v1',
    registeredAt: '2026-08-09T00:00:00.000Z',
    family: 'trendvol',
    hypothesis: 'The composed strategy produces positive after-cost excess return.',
    parameterSpace,
    candidateCount: gridCandidateCount(parameterSpace),
    datasetHash: 'a'.repeat(64),
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision: 'abc123',
    execution: {
      baseTargets: [
        { assetId: 'coinbase|spot|BTC-USD', weight: 0.5 },
        { assetId: 'coinbase|spot|ETH-USD', weight: 0.5 },
      ],
      warmupBars: 200,
      cashAprPct: 0,
    },
    validation: {
      development: {
        startMs: Date.UTC(2021, 0, 1),
        endExclusiveMs: Date.UTC(2025, 0, 1),
      },
      holdout: {
        startMs: Date.UTC(2025, 0, 1),
        endExclusiveMs: Date.UTC(2026, 0, 1),
      },
      nestedFoldCount: 5,
      embargoDays: 10,
      minimumDevelopmentBars: 1_000,
      minimumHoldoutBars: 300,
      cscvPartitionCount: 16,
      bootstrapResamples: 5_000,
      bootstrapMeanBlockLength: 20,
      bootstrapConfidenceLevel: 0.95,
      bootstrapSeed: 20_260_809,
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
    ...overrides,
  };
}

describe('research pre-registration', () => {
  it('hashes equivalent parameter-key order identically', () => {
    const left = plan({ parameterSpace: { lookbackDays: [90, 180], targetVolPct: [40, 50] } });
    const right = plan({ parameterSpace: { targetVolPct: [40, 50], lookbackDays: [90, 180] } });
    expect(researchPreRegistrationHash(left)).toBe(researchPreRegistrationHash(right));
  });

  it('rejects undeclared candidate freedom and overlapping holdout windows', () => {
    expect(() => researchPreRegistrationHash(plan({ candidateCount: 3 })))
      .toThrow(/candidate count/u);
    const invalid = plan();
    expect(() => researchPreRegistrationHash({
      ...invalid,
      validation: {
        ...invalid.validation,
        holdout: {
          startMs: Date.UTC(2024, 11, 31),
          endExclusiveMs: Date.UTC(2026, 0, 1),
        },
      },
    })).toThrow(/non-overlapping/u);
    expect(() => gridCandidateCount({ lookbackDays: [90, 90] }))
      .toThrow(/duplicate values/u);
  });

  it('rejects non-day-aligned boundaries and optional benchmark gates', () => {
    const invalid = plan();
    expect(() => researchPreRegistrationHash({
      ...invalid,
      validation: {
        ...invalid.validation,
        holdout: { ...invalid.validation.holdout, startMs: Date.UTC(2025, 0, 1, 1) },
      },
    })).toThrow(/UTC midnight/u);
    expect(() => researchPreRegistrationHash({
      ...invalid,
      adoptionRules: {
        ...invalid.adoptionRules,
        requirePositiveExcessReturnVsHold: false as true,
      },
    })).toThrow(/cannot be disabled/u);
  });

  it('persists immutable plans and verifies their content hash', () => {
    const database = openDatabase(':memory:');
    const registered = plan();
    const hash = registerResearchPreRegistration(registered, database);
    expect(hash).toBe(researchPreRegistrationHash(registered));
    expect(verifiedResearchPreRegistrations(database)).toEqual([registered]);
    expect(() => database.prepare(
      "UPDATE research_preregistrations SET plan_json = '{}' WHERE id = ?",
    ).run(registered.id)).toThrow(/immutable/u);
    expect(() => database.prepare(
      'DELETE FROM research_preregistrations WHERE id = ?',
    ).run(registered.id)).toThrow(/immutable/u);
    expect(() => registerResearchPreRegistration(registered, database)).toThrow();
    database.close();
  });
});
