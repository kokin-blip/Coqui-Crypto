import { backtestIntegrityDataset, type IntegrityBacktestResult } from '../backtest/integrity-engine.js';
import type { DecisionMarketDataset } from '../market/index.js';
import type { JsonValue } from '../trials/index.js';
import { DEFAULT_MOMENTUM_CONFIG, DEFAULT_VOL_TARGET_CONFIG, DEFAULT_ROTATION_CONFIG } from '../strategies/index.js';
import type { IntegrityStudyPlan } from './integrity-plan.js';
import type { VersionedCostScenario } from '../costs/index.js';
import { sha256Hex } from '../crypto/sha256.js';
import { canonicalJson } from '../evidence/index.js';
import type { InstrumentKey } from '../types/index.js';

export interface FamilyCandidate { readonly id: string; readonly parameters: Readonly<Record<string, JsonValue>> }
const MOMENTUM = ['lookbackDays', 'volatilityDays', 'maxRelativeTilt', 'relativeScoreSpreadFloor', 'defensiveScale', 'targetVolatilityPct'];
const VOL = ['targetVolPct', 'volLookbackDays', 'minExposure', 'maxExposure', 'trendGateDays', 'belowTrendMaxExposure'];
const ROTATION = ['topN', 'lookbackDays', 'volatilityDays', 'absoluteFilter', 'weighting', 'holdBufferMultiple'];
export function familyCandidates(plan: IntegrityStudyPlan): readonly FamilyCandidate[] {
  const allowed = ['rebalanceEveryDays', ...(plan.family === 'momentum' ? MOMENTUM : plan.family === 'voltarget' ? VOL :
    plan.family === 'trendvol' ? [...MOMENTUM, ...VOL] : ROTATION)];
  const entries = Object.entries(plan.parameterSpace).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([key]) => !allowed.includes(key))) throw new TypeError('Unsupported family parameter');
  const candidates: FamilyCandidate[] = [];
  const visit = (index: number, params: Record<string, JsonValue>) => {
    if (index === entries.length) {
      const parameters = Object.freeze({ ...params });
      candidates.push({ id: sha256Hex(canonicalJson({ family: plan.family, parameters })), parameters });
      return;
    }
    const [key, values] = entries[index]!;
    for (const value of values) visit(index + 1, { ...params, [key]: value });
  };
  visit(0, {});
  if (candidates.length !== plan.candidateCount) throw new TypeError('Candidate count mismatch');
  for (const candidate of candidates) familyOptions(candidate);
  return Object.freeze(candidates);
}
function familyOptions(candidate: FamilyCandidate) {
  const p = candidate.parameters;
  const num = (key: string, fallback: number, integer = false, fraction = false) => {
    const value = p[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        (integer && (!Number.isSafeInteger(value) || value < 1)) || (fraction && value > 1)) throw new TypeError(`Invalid parameter ${key}`);
    return value;
  };
  const momentum = { ...DEFAULT_MOMENTUM_CONFIG,
    lookbackDays: num('lookbackDays', DEFAULT_MOMENTUM_CONFIG.lookbackDays, true),
    volatilityDays: num('volatilityDays', DEFAULT_MOMENTUM_CONFIG.volatilityDays, true),
    maxRelativeTilt: num('maxRelativeTilt', DEFAULT_MOMENTUM_CONFIG.maxRelativeTilt, false, true),
    ...(p['relativeScoreSpreadFloor'] === undefined ? {} : {
      relativeScoreSpreadFloor: num('relativeScoreSpreadFloor', 0),
    }),
    defensiveScale: num('defensiveScale', DEFAULT_MOMENTUM_CONFIG.defensiveScale, false, true),
    targetVolatilityPct: num('targetVolatilityPct', DEFAULT_MOMENTUM_CONFIG.targetVolatilityPct) };
  const volTarget = { ...DEFAULT_VOL_TARGET_CONFIG,
    targetVolPct: num('targetVolPct', DEFAULT_VOL_TARGET_CONFIG.targetVolPct),
    volLookbackDays: num('volLookbackDays', DEFAULT_VOL_TARGET_CONFIG.volLookbackDays, true),
    minExposure: num('minExposure', DEFAULT_VOL_TARGET_CONFIG.minExposure, false, true),
    maxExposure: num('maxExposure', DEFAULT_VOL_TARGET_CONFIG.maxExposure, false, true),
    trendGateDays: num('trendGateDays', DEFAULT_VOL_TARGET_CONFIG.trendGateDays, true),
    belowTrendMaxExposure: num('belowTrendMaxExposure', DEFAULT_VOL_TARGET_CONFIG.belowTrendMaxExposure, false, true) };
  if (momentum.targetVolatilityPct <= 0 || volTarget.targetVolPct <= 0 || volTarget.minExposure > volTarget.maxExposure) throw new TypeError('Invalid volatility parameters');
  if (p['absoluteFilter'] !== undefined && typeof p['absoluteFilter'] !== 'boolean') throw new TypeError('Invalid absolute filter');
  if (p['weighting'] !== undefined && !['equal', 'inverse_vol'].includes(String(p['weighting']))) throw new TypeError('Invalid rotation weighting');
  const rotation = { ...DEFAULT_ROTATION_CONFIG,
    lookbackDays: num('lookbackDays', DEFAULT_ROTATION_CONFIG.lookbackDays, true),
    volatilityDays: num('volatilityDays', DEFAULT_ROTATION_CONFIG.volatilityDays, true),
    topN: num('topN', DEFAULT_ROTATION_CONFIG.topN, true),
    holdBufferMultiple: num('holdBufferMultiple', DEFAULT_ROTATION_CONFIG.holdBufferMultiple, true),
    absoluteFilter: (p['absoluteFilter'] ?? DEFAULT_ROTATION_CONFIG.absoluteFilter) as boolean,
    weighting: (p['weighting'] ?? DEFAULT_ROTATION_CONFIG.weighting) as 'equal' | 'inverse_vol' };
  return { rebalanceEveryDays: num('rebalanceEveryDays', 14, true), momentum, volTarget, rotation };
}
export function runFamilyCandidate(dataset: DecisionMarketDataset, start: number, plan: IntegrityStudyPlan,
  candidate: FamilyCandidate, scenario: VersionedCostScenario): IntegrityBacktestResult {
  return backtestIntegrityDataset(dataset, plan.execution.baseTargets.map((t) => ({ assetId: t.assetId as InstrumentKey, weight: t.weight })), {
    ...familyOptions(candidate), clock: { nowMs: () => dataset.generatedAtMs },
    warmup: start, minimumHistoryBars: plan.execution.warmupBars, benchmarkRebalanceEveryDays: plan.benchmarkRebalanceEveryDays, cashAprPct: plan.execution.cashAprPct, tradeCosts: scenario.config, evalSignal: () => null,
  });
}
