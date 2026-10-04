import { buildDecisionMarketDataset, instrumentKey, DEFAULT_MOMENTUM_CONFIG, DEFAULT_VOL_TARGET_CONFIG,
  INTEGRITY_ADOPTION_DEFAULTS, coinbaseResearchScenarios, OVERLAY_VERSION, FEATURE_VERSION, overlayCandidates,
  overlayHash, type OverlayStudyPlan, type MarketBar } from '../packages/core/src/index.js';
export const OVERLAY_DAY = 86_400_000, OVERLAY_START = Date.UTC(2020, 0, 1);
export const OVERLAY_ASSETS = ['BTC', 'ETH', 'LTC'].map((symbol) => instrumentKey({ venue: 'coinbase', productId: `${symbol}-USD`, productType: 'spot' }));
export function overlayDataset(count = 200, scrambleAt = Infinity) {
  return buildDecisionMarketDataset(Object.fromEntries(OVERLAY_ASSETS.map((asset, a) => [asset,
    Array.from({ length: count }, (_, index): MarketBar => {
      const price = 100 + index * 0.1 + Math.sin(index * 0.3 + a) * 0.5, changed = index >= scrambleAt ? 3 : 1;
      return { assetId: asset, source: 'coinbase', interval: '1d', startTimeMs: OVERLAY_START + index * OVERLAY_DAY,
        endTimeMs: OVERLAY_START + (index + 1) * OVERLAY_DAY, open: price * changed, close: price * changed,
        high: price * changed + 1, low: price * changed - 1, volume: 100000, isComplete: true,
        retrievedAtMs: OVERLAY_START + 1000 * OVERLAY_DAY, quality: 'reported_ohlc' };
    })])), OVERLAY_ASSETS, { policy: 'reject-on-gap', nowMs: OVERLAY_START + (count + 1) * OVERLAY_DAY });
}
export function overlayFixturePlan(count = 200): OverlayStudyPlan {
  return { schemaVersion: 3, overlayVersion: OVERLAY_VERSION, featureVersion: FEATURE_VERSION,
    id: 'overlay-mechanics', registeredAt: new Date(OVERLAY_START).toISOString(), family: 'trendvol', hypothesis: 'Synthetic mechanics only',
    parameterSpace: { rebalanceEveryDays: [1, 14] }, candidateCount: overlayCandidates().length,
    benchmarkRebalanceEveryDays: 14, developmentDatasetHash: overlayDataset(count).report.datasetHash,
    dataLineage: 'synthetic-overlay', sourceManifestHash: 'a'.repeat(64), lockfileHash: 'b'.repeat(64), codeRevision: 'fixture',
    universe: { kind: 'conditional_fixed_universe', assets: OVERLAY_ASSETS }, scenarios: coinbaseResearchScenarios(),
    arms: [{ cadence: 1, anchorMs: OVERLAY_START + 130 * OVERLAY_DAY }, { cadence: 14, anchorMs: OVERLAY_START + 130 * OVERLAY_DAY }],
    baseline: { momentum: DEFAULT_MOMENTUM_CONFIG, volatility: DEFAULT_VOL_TARGET_CONFIG },
    developmentLiquidityHash: overlayHash([]), minimumTraining: 120, minimumCalibration: 60, minimumValidation: 30, taxDragPct: 0,
    execution: { warmupBars: 121, cashAprPct: 0, baseTargets: OVERLAY_ASSETS.map((assetId) => ({ assetId, weight: 1 / 3 })) },
    validation: { development: { startMs: OVERLAY_START, endExclusiveMs: OVERLAY_START + count * OVERLAY_DAY },
      holdout: { startMs: OVERLAY_START + (count + 20) * OVERLAY_DAY, endExclusiveMs: OVERLAY_START + (count + 400) * OVERLAY_DAY },
      nestedFoldCount: 3, embargoDays: 2, minimumDevelopmentBars: 90, minimumHoldoutBars: 365,
      cscvPartitionCount: 4, bootstrapResamples: 500, bootstrapMeanBlockLength: 7, bootstrapConfidenceLevel: 0.95, bootstrapSeed: 86 },
    primaryMetric: 'after-cost-excess-return-vs-hold', adoptionRules: INTEGRITY_ADOPTION_DEFAULTS, studyRef: 'docs/studies/selective-participation.md' };
}
