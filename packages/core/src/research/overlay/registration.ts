import { canonicalJson, type CanonicalJsonValue } from '../../evidence/index.js';
import { sha256Hex } from '../../crypto/sha256.js';
import { integrityPlanHash } from '../integrity-plan.js';
import { INTEGRITY_ENGINE_VERSION } from '../../backtest/execution-timing.js';
import { DEFAULT_MOMENTUM_CONFIG, DEFAULT_VOL_TARGET_CONFIG } from '../../strategies/index.js';
import { DEFAULT_RISK_CONTROL_PROFILE } from '../../risk/risk-controls.js';
import { FEATURE_VERSION, OVERLAY_VERSION, type OverlayCandidate, type OverlayStudyPlan } from './types.js';
export function overlayHash(value: unknown): string { return sha256Hex(canonicalJson(value as CanonicalJsonValue)); }
export const OVERLAY_RISK_HASH = overlayHash({ profile: DEFAULT_RISK_CONTROL_PROFILE, maxDeviation: 0.05,
  addedTurnover: 0.10, volumeParticipation: 0.001, covarianceDays: 30, exposure: 'preserve', sizing: 'turnover-interpolation-v1' });
let frozenCandidates: readonly OverlayCandidate[] | null = null;
export function overlayCandidates(): OverlayCandidate[] {
  if (frozenCandidates) return [...frozenCandidates];
  const result: OverlayCandidate[] = [];
  const add = (value: Omit<OverlayCandidate, 'id'>) => result.push({ ...value, id: overlayHash(value) });
  for (const cadence of [1, 14] as const) {
    const base = { cadence, gate: 'none' as const, volatilityMultiple: 0, abstention: 'skip_rebalance' as const,
      model: 'none' as const, modelParameter: 0, probabilityThreshold: 0, tilt: false, maxDeviation: 0.05 as const, diagnosticOnly: false };
    add(base);
    const rules = [{ gate: 'volatility' as const, volatilityMultiple: 1.5 }, { gate: 'volatility' as const, volatilityMultiple: 2 },
      { gate: 'trend' as const, volatilityMultiple: 0 }, { gate: 'combined' as const, volatilityMultiple: 1.5 }, { gate: 'combined' as const, volatilityMultiple: 2 }];
    for (const rule of rules) for (const abstention of ['skip_rebalance', 'cash_exit'] as const) add({ ...base, ...rule, abstention });
    for (const model of ['ridge', 'tree'] as const) for (const modelParameter of model === 'ridge' ? [1, 10] : [20, 40]) {
      for (const probabilityThreshold of [0.55, 0.65]) {
        const ml = { ...base, model, modelParameter, probabilityThreshold };
        for (const abstention of ['skip_rebalance', 'cash_exit'] as const) add({ ...ml, gate: 'ml', abstention });
        for (const maxDeviation of [0.05, 0.025] as const) {
          const tilt = { ...ml, tilt: true, maxDeviation, diagnosticOnly: maxDeviation === 0.025 };
          add(tilt);
          for (const abstention of ['skip_rebalance', 'cash_exit'] as const) {
            add({ ...tilt, gate: 'ml', abstention });
            for (const rule of rules) add({ ...tilt, ...rule, abstention });
          }
        }
      }
    }
  }
  frozenCandidates = Object.freeze(result.map((c) => Object.freeze(c)));
  return [...frozenCandidates];
}
export function overlayComparisonKey(candidate: OverlayCandidate): string {
  return `${candidate.cadence}:${candidate.gate}:${candidate.model}:${candidate.tilt ? 'tilt' : 'plain'}:${candidate.abstention}`;
}
export function overlayPlanHash(plan: OverlayStudyPlan): string {
  integrityPlanHash({ ...plan, schemaVersion: 2, engineVersion: INTEGRITY_ENGINE_VERSION, candidateCount: 1, parameterSpace: { rebalanceEveryDays: [14] } });
  if (!/^[a-f0-9]{64}$/u.test(plan.developmentLiquidityHash) || plan.schemaVersion !== 3 || plan.overlayVersion !== OVERLAY_VERSION || plan.featureVersion !== FEATURE_VERSION ||
      plan.family !== 'trendvol' || plan.minimumTraining !== 120 || plan.minimumCalibration !== 60 || plan.minimumValidation !== 30 || plan.taxDragPct !== 0 ||
      plan.arms.length !== 2 || ![1, 14].every((cadence) => plan.arms.some((arm) => arm.cadence === cadence &&
        Number.isSafeInteger(arm.anchorMs) && arm.anchorMs % 86_400_000 === 0 && arm.anchorMs >= plan.validation.development.startMs)) ||
      overlayHash(plan.baseline) !== overlayHash({ momentum: DEFAULT_MOMENTUM_CONFIG, volatility: DEFAULT_VOL_TARGET_CONFIG }) ||
      overlayHash(plan.parameterSpace) !== overlayHash({ rebalanceEveryDays: [1, 14] }) || plan.candidateCount !== overlayCandidates().length) throw new TypeError('Unsupported overlay registration');
  return overlayHash(plan);
}
