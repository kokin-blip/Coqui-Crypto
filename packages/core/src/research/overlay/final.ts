import type { DecisionMarketDataset } from '../../market/index.js';
import type { TradeCostConfig } from '../../costs/index.js';
import { costScenarioHash } from '../../costs/index.js';
import { backtestIntegrityDataset } from '../../backtest/integrity-engine.js';
import { equityReturns } from '../../backtest/analytics.js';
import type { InstrumentKey } from '../../types/index.js';
import type { TrialRegistrySnapshot } from '../../trials/index.js';
import { analyzeHoldoutEvidence } from '../holdout-evidence.js';
import { benchmarkRelativeConfidence } from '../benchmark-confidence.js';
import { overlayCandidates, overlayPlanHash, overlayHash, overlayComparisonKey } from './registration.js';
import { overlayPrefix, artifactFitter, overlayDevelopmentSharpes, type OverlayDevelopment } from './development.js';
import { calibrationDiagnostics } from './calibration.js';
import { traceActionOutcome, validateOverlayArtifact } from './artifacts.js';
import { replayOverlay } from './replay.js';
import type { LiquidityObservation, OverlayArtifact, OverlayStudyPlan } from './types.js';
export interface OverlayFreeze {
  readonly planHash: string; readonly developmentHash: string; readonly selected: readonly string[];
  readonly artifacts: Readonly<Record<string, OverlayArtifact | null>>;
  readonly simpleControls: Readonly<Record<string, string>>; readonly comparisonCount: number;
}
export function freezeOverlayArtifacts(plan: OverlayStudyPlan, development: OverlayDevelopment, dataset: DecisionMarketDataset,
  liquidity: readonly LiquidityObservation[] = []): OverlayFreeze {
  if (development.planHash !== overlayPlanHash(plan) || dataset.report.datasetHash !== plan.developmentDatasetHash) throw new Error('overlay_freeze_identity');
  const fit = artifactFitter(dataset, plan, plan.validation.development.endExclusiveMs, liquidity);
  const artifacts: Record<string, OverlayArtifact | null> = {};
  for (const id of development.selected) {
    const candidate = overlayCandidates().find((c) => c.id === id)!;
    if (!candidate || candidate.diagnosticOnly) throw new Error('overlay_freeze_candidate');
    for (const scenario of plan.scenarios) {
      const artifact = fit(candidate, scenario.config);
      artifacts[`${id}:${costScenarioHash(scenario)}`] = artifact ? { ...artifact, evaluationResultHash: overlayHash(development) } : null;
    }
  }
  // Freeze baseline/hold/passive, ML/simple and tree/ridge comparisons across
  // the two qualification scenarios before any final observations are read.
  return { planHash: development.planHash, developmentHash: overlayHash(development), selected: development.selected,
    artifacts, simpleControls: development.simpleControls, comparisonCount: overlayComparisonCount(development.selected) };
}
export function overlayComparisonCount(ids: readonly string[]): number {
  const candidates = overlayCandidates();
  return Math.max(1, ids.reduce((sum, id) => { const c = candidates.find((v) => v.id === id);
    if (!c) throw new Error('overlay_unknown_candidate'); return sum + 2 * (3 + Number(c.model !== 'none') + Number(c.model === 'tree')); }, 0));
}
export function simultaneousOverlayOptions(plan: OverlayStudyPlan, comparisonCount: number, cadence: number) {
  if (!Number.isSafeInteger(comparisonCount) || comparisonCount < 1) throw new Error('overlay_comparison_count');
  const alpha = 0.05 / comparisonCount;
  return { resamples: Math.max(10000, Math.ceil(20 / (alpha / 2))), meanBlockLength: Math.max(plan.validation.bootstrapMeanBlockLength, cadence + 2),
    confidenceLevel: 1 - alpha, seed: plan.validation.bootstrapSeed };
}
export function evaluateOverlayFinal(plan: OverlayStudyPlan, development: OverlayDevelopment, frozen: OverlayFreeze,
  dataset: DecisionMarketDataset, registry: TrialRegistrySnapshot, liquidity: readonly LiquidityObservation[] = []) {
  if (overlayHash(liquidity.filter((row) => row.availableAtMs < plan.validation.development.endExclusiveMs)) !== plan.developmentLiquidityHash) throw new Error('overlay_liquidity_lineage_changed');
  const planHash = overlayPlanHash(plan), developmentBars = (plan.validation.development.endExclusiveMs - plan.validation.development.startMs) / 86_400_000;
  if (frozen.planHash !== planHash || development.planHash !== planHash || frozen.developmentHash !== overlayHash(development) ||
      JSON.stringify(frozen.selected) !== JSON.stringify(development.selected) ||
      frozen.comparisonCount !== overlayComparisonCount(frozen.selected) ||
      overlayPrefix(dataset, developmentBars).report.datasetHash !== plan.developmentDatasetHash ||
      dataset.barsById[dataset.assets[0]!]!.at(-1)!.endTimeMs !== plan.validation.holdout.endExclusiveMs ||
      JSON.stringify(dataset.assets) !== JSON.stringify(plan.universe.assets)) throw new Error('overlay_final_identity');
  const start = dataset.dayKeys.indexOf(new Date(plan.validation.holdout.startMs).toISOString().slice(0, 10));
  if (start < plan.execution.warmupBars) throw new Error('overlay_final_context');
  const candidates = overlayCandidates(), required = new Set([...frozen.selected, ...Object.values(frozen.simpleControls)]);
  const reports = plan.scenarios.map((scenario) => {
    const runs = new Map<string, ReturnType<typeof replayOverlay>>();
    const run = (id: string) => {
      if (runs.has(id)) return runs.get(id)!;
      const candidate = candidates.find((c) => c.id === id); if (!candidate) throw new Error('overlay_unknown_candidate');
      const artifact = frozen.artifacts[`${id}:${costScenarioHash(scenario)}`] ?? null;
      if (artifact) validateOverlayArtifact(artifact, plan, candidate, scenario.config);
      const value = replayOverlay(dataset, plan, candidate, { startIndex: start, costs: scenario.config, artifact, liquidity });
      runs.set(id, value); return value;
    };
    const controls = backtestIntegrityDataset(dataset, plan.execution.baseTargets.map((t) => ({ ...t, assetId: t.assetId as InstrumentKey })), {
      warmup: start, minimumHistoryBars: plan.execution.warmupBars, clock: { nowMs: () => dataset.generatedAtMs }, rebalanceEveryDays: plan.benchmarkRebalanceEveryDays,
      benchmarkRebalanceEveryDays: plan.benchmarkRebalanceEveryDays, tradeCosts: scenario.config, evalSignal: () => null,
      cashAprPct: plan.execution.cashAprPct, ...plan.baseline, volTarget: plan.baseline.volatility });
    for (const id of required) run(id);
    const policies = frozen.selected.map((id) => {
      const candidate = candidates.find((c) => c.id === id)!, selected = run(id);
      const baseline = run(candidates.find((c) => c.cadence === candidate.cadence && c.model === 'none' && c.gate === 'none')!.id);
      const bootstrap = simultaneousOverlayOptions(plan, frozen.comparisonCount, candidate.cadence);
      const confidence = benchmarkRelativeConfidence(equityReturns(selected.equity), equityReturns(baseline.equity), bootstrap);
      const simpleId = frozen.simpleControls[String(candidate.cadence)], simple = simpleId ? run(simpleId) : baseline;
      const simpleConfidence = candidate.model !== 'none' ? benchmarkRelativeConfidence(equityReturns(selected.equity), equityReturns(simple.equity), bootstrap) : null;
      const ridgeId = frozen.selected.find((otherId) => {
        const other = candidates.find((c) => c.id === otherId)!;
        return other.model === 'ridge' && overlayComparisonKey({ ...other, model: candidate.model }) === overlayComparisonKey(candidate);
      });
      const ridgeConfidence = candidate.model === 'tree' && ridgeId ? benchmarkRelativeConfidence(equityReturns(selected.equity), equityReturns(run(ridgeId).equity), bootstrap) : null;
      const evidence = analyzeHoldoutEvidence({ plan: { ...plan, schemaVersion: 1,
        datasetHash: plan.developmentDatasetHash, costProfileHash: costScenarioHash(scenario), candidateCount: 0,
        validation: { ...plan.validation, bootstrapResamples: bootstrap.resamples, bootstrapConfidenceLevel: bootstrap.confidenceLevel,
          bootstrapMeanBlockLength: bootstrap.meanBlockLength } }, registry, pbo: development.pbo, selectedTrack: selected,
        holdTrack: controls.hold, passiveTrack: controls.passive, developmentSharpes: overlayDevelopmentSharpes(development) });
      const pairs = selected.traces.flatMap((trace) => { if (trace.probability === null) return [];
        const outcome = traceActionOutcome(dataset, trace, candidate.cadence, scenario.config, plan.execution.cashAprPct);
        return outcome === null ? [] : [{ probability: trace.probability, positive: outcome > 0 }]; });
      const diagnostics = calibrationDiagnostics(pairs.map((p) => p.probability), pairs.map((p) => p.positive));
      const costBearingEligibleActions = selected.traces.filter((t) => t.scheduled && t.permitted !== null && t.fills.length > 0 && !t.reason.startsWith('hard_safety_stop')).length;
      const enough = selected.equity.length - 1 >= 365 && costBearingEligibleActions >= 30;
      const usableModel = candidate.model === 'none' || (selected.traces.filter((t) => t.probability !== null).length >= 30 &&
        selected.coverage.fallback === 0);
      const positive = (value: ReturnType<typeof benchmarkRelativeConfidence> | null) => value?.status === 'available' && value.lowerMeanDailyExcess !== null && value.lowerMeanDailyExcess > 0;
      return { candidateId: id, cadence: candidate.cadence, model: candidate.model, gate: candidate.gate, abstention: candidate.abstention,
        costBearingEligibleActions, enough, usableModel, adopted: evidence.adopted && enough && usableModel && positive(confidence) &&
          (candidate.model === 'none' || positive(simpleConfidence)) && (candidate.model !== 'tree' || positive(ridgeConfidence)),
        evidence, diagnostics, baselineConfidence: confidence, simpleConfidence, ridgeConfidence, coverage: selected.coverage,
        netReturnPct: selected.metrics.totalReturnPct, turnoverUsd: selected.costs.turnoverUsd, costUsd: selected.costs.totalCostUsd,
        componentCosts: selected.componentCosts, trendOverlap: selected.overlap, cashExitResearchOnly: candidate.abstention === 'cash_exit' };
    });
    return { qualificationScenario: ['account', 'conservative'].includes(scenario.scenario), scenario: scenario.scenario, costHash: costScenarioHash(scenario), policies, controls: {
      hold: { metrics: controls.hold.metrics, costs: controls.hold.costs }, passive: { metrics: controls.passive.metrics, costs: controls.passive.costs },
      cash: { metrics: controls.cash.metrics, costs: controls.cash.costs } } };
  });
  const adopted = frozen.selected.filter((id) => ['account', 'conservative'].every((name) => reports.find((r) => r.scenario === name)?.policies.find((p) => p.candidateId === id)?.adopted === true));
  return { planHash, datasetHash: dataset.report.datasetHash, comparisonCount: frozen.comparisonCount, reports,
    adopted, accountEvidenceAvailable: plan.scenarios.some((s) => s.scenario === 'account'), universeAssumption: 'conditional_fixed_universe' as const, activation: 'none' as const, liveExecution: false as const };
}
export type OverlayFinalResult = ReturnType<typeof evaluateOverlayFinal>;
export function frozenArtifactKey(candidateId: string, costs: TradeCostConfig) { return `${candidateId}:${overlayHash(costs)}`; }
