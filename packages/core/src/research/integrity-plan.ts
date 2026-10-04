import { canonicalJson } from '../evidence/index.js';
import { sha256Hex } from '../crypto/sha256.js';
import { costScenarioHash, tradeCostConfigHash, type VersionedCostScenario } from '../costs/index.js';
import { INTEGRITY_ENGINE_VERSION } from '../backtest/execution-timing.js';
import { canonicalResearchPreRegistration, type ResearchPreRegistration } from '../validation/pre-registration.js';

export interface IntegrityStudyPlan extends Omit<ResearchPreRegistration, 'schemaVersion' | 'datasetHash' | 'costProfileHash'> {
  readonly schemaVersion: 2;
  readonly benchmarkRebalanceEveryDays: number;
  readonly engineVersion: typeof INTEGRITY_ENGINE_VERSION;
  readonly developmentDatasetHash: string;
  readonly dataLineage: string;
  readonly sourceManifestHash: string;
  readonly lockfileHash: string;
  readonly scenarios: readonly VersionedCostScenario[];
  readonly universe: { readonly kind: 'conditional_fixed_universe'; readonly assets: readonly string[] };
}
export const INTEGRITY_ADOPTION_DEFAULTS = Object.freeze({ minimumDeflatedSharpeProbability: 0.95,
  requirePositiveExcessReturnVsHold: true, requirePositiveExcessReturnVsPassive: true,
  rejectIfSignificanceUnavailable: true, maximumDrawdownPct: 35,
  maximumProbabilityOfBacktestOverfitting: 0.10 } as const);

export function legacyShapeForIntegrity(plan: IntegrityStudyPlan): ResearchPreRegistration {
  const conservative = plan.scenarios.find((scenario) => scenario.scenario === 'conservative');
  if (!conservative) throw new TypeError('Conservative cost scenario is required');
  return { ...plan, schemaVersion: 1, datasetHash: plan.developmentDatasetHash,
    costProfileHash: tradeCostConfigHash(conservative.config) };
}
export function integrityPlanHash(plan: IntegrityStudyPlan): string {
  canonicalResearchPreRegistration(legacyShapeForIntegrity(plan));
  if (new Date(plan.registeredAt).valueOf() >= plan.validation.holdout.startMs ||
      !Number.isSafeInteger(plan.benchmarkRebalanceEveryDays) || plan.benchmarkRebalanceEveryDays < 1 || plan.schemaVersion !== 2 || plan.engineVersion !== INTEGRITY_ENGINE_VERSION ||
      !['momentum', 'voltarget', 'trendvol', 'rotation'].includes(plan.family) ||
      !/^[a-zA-Z0-9._:/-]{1,200}$/u.test(plan.dataLineage) ||
      [plan.sourceManifestHash, plan.lockfileHash].some((hash) => !/^[a-f0-9]{64}$/u.test(hash)) ||
      plan.universe.kind !== 'conditional_fixed_universe' ||
      JSON.stringify([...plan.universe.assets].sort()) !== JSON.stringify(plan.execution.baseTargets.map((t) => t.assetId).sort()) ||
      new Set(plan.scenarios.map((scenario) => scenario.scenario)).size !== plan.scenarios.length ||
      !['optimistic', 'conservative', 'stress'].every((name) => plan.scenarios.some((s) => s.scenario === name)) ||
      plan.scenarios.some((s) => s.liquidityRole !== 'taker') ||
      plan.adoptionRules.minimumDeflatedSharpeProbability < 0.95 ||
      plan.adoptionRules.maximumProbabilityOfBacktestOverfitting > 0.10) {
    throw new TypeError('Incomplete or unsupported integrity registration');
  }
  for (const scenario of plan.scenarios) costScenarioHash(scenario);
  // The public cost schedule cannot be backdated as observed historical account evidence.
  return sha256Hex(canonicalJson(plan as unknown as Parameters<typeof canonicalJson>[0]));
}
