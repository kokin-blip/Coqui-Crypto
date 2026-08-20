import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  momentumTargets,
  type MomentumConfig,
} from '../packages/core/src/strategies/momentum.js';
import { momentumTargetsAt } from '../packages/core/src/strategies/momentum.js';
import {
  volTargetExposure,
  volTargetExposureAt,
  type VolTargetConfig,
} from '../packages/core/src/strategies/vol-target.js';
import type { InstrumentKey } from '../packages/core/src/types/index.js';

const ASSET = 'coinbase|spot|BTC-USD' as InstrumentKey;
const momentumConfigs: readonly MomentumConfig[] = [
  { lookbackDays: 90, volatilityDays: 30, maxRelativeTilt: 0.35, defensiveScale: 0.2, targetVolatilityPct: 55 },
  { lookbackDays: 180, volatilityDays: 30, maxRelativeTilt: 0.35, defensiveScale: 0.2, targetVolatilityPct: 55 },
];
const volConfigs: readonly VolTargetConfig[] = [
  { targetVolPct: 40, volLookbackDays: 30, minExposure: 0.1, maxExposure: 1, trendGateDays: 100, belowTrendMaxExposure: 0.7 },
  { targetVolPct: 50, volLookbackDays: 30, minExposure: 0.1, maxExposure: 1, trendGateDays: 200, belowTrendMaxExposure: 0.7 },
];

describe('indexed research calculations', () => {
  it('remain exactly equal to prefix-array calculations across generated histories', () => {
    fc.assert(fc.property(
      fc.array(
        fc.double({ min: 1, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        { minLength: 220, maxLength: 420 },
      ),
      fc.integer({ min: 201, max: 420 }),
      fc.integer({ min: 0, max: momentumConfigs.length - 1 }),
      fc.integer({ min: 0, max: volConfigs.length - 1 }),
      (closes, requestedEnd, momentumIndex, volIndex) => {
        const end = Math.min(requestedEnd, closes.length);
        fc.pre(end > 200);
        const prefix = closes.slice(0, end);
        const momentumConfig = momentumConfigs[momentumIndex]!;
        const expectedMomentum = momentumTargets(
          [{ assetId: ASSET, weight: 1 }],
          { [ASSET]: prefix },
          momentumConfig,
        );
        const actualMomentum = momentumTargetsAt(
          [{ assetId: ASSET, weight: 1 }],
          new Map([[ASSET, closes]]),
          end,
          momentumConfig,
        );
        expect(actualMomentum).toEqual(expectedMomentum);
        expect(volTargetExposureAt(closes, end, volConfigs[volIndex]))
          .toEqual(volTargetExposure(prefix, volConfigs[volIndex]));
      },
    ), { seed: 2_026_080_9, numRuns: 100 });
  });
});
