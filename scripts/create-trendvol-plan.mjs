import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  DEFAULT_TRADE_COST_CONFIG,
  gridCandidateCount,
  researchPreRegistrationHash,
  tradeCostConfigHash,
} from '../packages/core/dist/index.js';

const DATASET_HASH = 'd56276d736716bc8796be1c6a1c13a458933f5f5b52de262a0943b83890543f5';
const HELP = `Usage:
  pnpm research:create-trendvol-plan -- \\
    --code-revision=<git-commit> \\
    --registered-at=<canonical-ISO-8601> \\
    [--output=data/research-plans/trendvol-replacement-v1.json]

Writes the frozen 16-candidate Coinbase trend-vol replacement plan exactly once.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

try {
  const codeRevision = option('code-revision') ?? '';
  const registeredAt = option('registered-at') ?? '';
  if (!/^[a-f0-9]{40}$/u.test(codeRevision) ||
      new Date(registeredAt).toISOString() !== registeredAt) {
    throw new TypeError('A Git commit and canonical registration timestamp are required.');
  }
  const parameterSpace = {
    lookbackDays: [90, 180],
    volatilityDays: [30],
    targetVolatilityPct: [55],
    targetVolPct: [40, 50],
    volLookbackDays: [30],
    minExposure: [0.1],
    maxExposure: [1],
    trendGateDays: [100, 200],
    rebalanceEveryDays: [14, 30],
    defensiveScale: [0.2],
    maxRelativeTilt: [0.35],
    belowTrendMaxExposure: [0.7],
  };
  const plan = {
    schemaVersion: 1,
    id: 'trendvol-replacement-v1',
    registeredAt,
    family: 'trendvol',
    hypothesis: 'A deliberately small trend-vol grid produces positive after-cost excess return versus both equal-weight buy-and-hold and passive rebalancing on an untouched recent Coinbase holdout.',
    parameterSpace,
    candidateCount: gridCandidateCount(parameterSpace),
    datasetHash: DATASET_HASH,
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision,
    execution: {
      baseTargets: [
        { assetId: 'coinbase|spot|BTC-USD', weight: 1 / 3 },
        { assetId: 'coinbase|spot|ETH-USD', weight: 1 / 3 },
        { assetId: 'coinbase|spot|LTC-USD', weight: 1 / 3 },
      ],
      warmupBars: 200,
      cashAprPct: 0,
    },
    validation: {
      development: {
        startMs: Date.UTC(2016, 7, 21),
        endExclusiveMs: Date.UTC(2022, 0, 1),
      },
      holdout: {
        startMs: Date.UTC(2022, 0, 1),
        endExclusiveMs: Date.UTC(2026, 7, 9),
      },
      nestedFoldCount: 5,
      embargoDays: 10,
      minimumDevelopmentBars: 1_900,
      minimumHoldoutBars: 1_600,
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
    studyRef: 'docs/studies/trendvol-replacement-v1-2026-08-09.md',
  };
  const planHash = researchPreRegistrationHash(plan);
  const output = resolve(option('output') ?? 'data/research-plans/trendvol-replacement-v1.json');
  if (existsSync(output)) throw new Error('The immutable research plan already exists.');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    ok: true, output, planHash, candidateCount: plan.candidateCount,
    datasetHash: plan.datasetHash, costProfileHash: plan.costProfileHash, codeRevision,
  }, null, 2));
} catch {
  console.error('Trend-vol plan creation failed without exposing research data.');
  console.error(HELP);
  process.exitCode = 1;
}
