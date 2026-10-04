import { Decimal } from 'decimal.js';
import { researchBookValue } from '../../backtest/integrity-book.js';
import { buildDecisionMarketDataset, type DecisionMarketDataset } from '../../market/index.js';
import { equityReturns } from '../../backtest/analytics.js';
import type { TradeCostConfig } from '../../costs/index.js';
import { costScenarioHash } from '../../costs/index.js';
import { periodSharpe } from '../../significance/index.js';
import { combinatoriallySymmetricCrossValidation, type CscvPboResult } from '../cscv.js';
import { overlayCandidates, overlayComparisonKey, overlayPlanHash, overlayHash } from './registration.js';
import { replayOverlay } from './replay.js';
import { fitOverlayArtifact, traceActionOutcome } from './artifacts.js';
import { calibrationDiagnostics } from './calibration.js';
import { decisionFrameAt } from '../../backtest/execution-timing.js';
import type { LiquidityObservation, OverlayCandidate, OverlayStudyPlan, OverlayArtifact } from './types.js';
export interface OverlayScore {
  readonly candidate: OverlayCandidate; readonly scenario: string; readonly costHash: string;
  readonly netReturnPct: number; readonly excessVsBaselinePct: number; readonly returns: readonly number[];
  readonly eligible: number; readonly selectedOpportunities: number; readonly rejectedOpportunities: number;
  readonly componentCosts: { readonly fee: string; readonly spread: string; readonly slippage: string; readonly impact: string };
  readonly exposureDifference: number; readonly rejectionAgreement: { readonly count: number; readonly agreed: number };
  readonly costBearingActions: number; readonly predictions: number; readonly fallbacks: number;
  readonly turnoverUsd: number; readonly costUsd: number; readonly maximumDrawdownPct: number;
  readonly calibrationPairs: readonly { readonly probability: number; readonly positive: boolean }[];
  readonly diagnostics: ReturnType<typeof calibrationDiagnostics>;
  readonly intervalAttribution: readonly { readonly startMs: number; readonly endMs: number; readonly selected: boolean; readonly complete: boolean; readonly baselineNetReturn: number | null }[];
  readonly trendOverlap: { readonly belowTrend: number; readonly rejectedBelowTrend: number };
}
export interface OverlayDevelopment {
  readonly planHash: string; readonly datasetHash: string; readonly holdout: 'not_loaded';
  readonly scores: readonly OverlayScore[];
  readonly folds: readonly { readonly trainingEndMs: number; readonly validationStartMs: number; readonly validationEndMs: number;
    readonly selected: readonly string[]; readonly reason: string | null }[];
  readonly selected: readonly string[]; readonly simpleControls: Readonly<Record<string, string>>;
  readonly foldScores: readonly OverlayScore[]; readonly pbo: CscvPboResult;
}
export function overlayPrefix(dataset: DecisionMarketDataset, end: number): DecisionMarketDataset {
  return buildDecisionMarketDataset(Object.fromEntries(dataset.assets.map((asset) => [asset, dataset.barsById[asset]!.slice(0, end)])),
    dataset.assets, { policy: 'reject-on-gap', nowMs: dataset.generatedAtMs });
}
export function artifactFitter(dataset: DecisionMarketDataset, plan: OverlayStudyPlan, boundaryMs: number, liquidity: readonly LiquidityObservation[]) {
  const cache = new Map<string, OverlayArtifact | null>();
  return (candidate: OverlayCandidate, costs: TradeCostConfig) => {
    const key = JSON.stringify([candidate.cadence, candidate.model, candidate.modelParameter, candidate.maxDeviation, costs]);
    if (!cache.has(key)) {
      const arm = plan.arms.find((a) => a.cadence === candidate.cadence)!;
      const possible = dataset.barsById[dataset.assets[0]!]!.filter((bar, i) => i >= 31 && bar.startTimeMs >= arm.anchorMs &&
        (bar.startTimeMs - arm.anchorMs) % (arm.cadence * 86400000) === 0 && bar.startTimeMs + (arm.cadence + 1) * 86400000 + 300000 < boundaryMs).length;
      cache.set(key, possible < 180 ? null : fitOverlayArtifact(dataset, plan, candidate, costs, boundaryMs, liquidity));
    }
    const artifact = cache.get(key); return artifact ? { ...artifact, candidateId: candidate.id } : null;
  };
}
export function selectOverlayScores(scores: readonly OverlayScore[]) {
  const selected: string[] = [], simpleControls: Record<string, string> = {};
  for (const cadence of [1, 14]) {
    const valid = scores.filter((s) => s.scenario === 'conservative' && s.candidate.cadence === cadence && !s.candidate.diagnosticOnly &&
      s.excessVsBaselinePct > 0 && s.eligible >= 30 && (s.candidate.model === 'none' || (s.predictions >= 30 && s.diagnostics !== null)));
    const simple = valid.filter((s) => s.candidate.model === 'none' && s.candidate.gate !== 'none')
      .sort((a, b) => b.excessVsBaselinePct - a.excessVsBaselinePct || a.candidate.id.localeCompare(b.candidate.id))[0];
    if (simple) simpleControls[String(cadence)] = simple.candidate.id;
    const groups = new Map<string, OverlayScore[]>();
    for (const score of valid) { const key = overlayComparisonKey(score.candidate); groups.set(key, [...(groups.get(key) ?? []), score]); }
    for (const values of groups.values()) {
      values.sort((a, b) => b.excessVsBaselinePct - a.excessVsBaselinePct || a.candidate.id.localeCompare(b.candidate.id)); selected.push(values[0]!.candidate.id);
    }
  }
  return { selected: selected.sort(), simpleControls };
}
export function evaluateOverlayDevelopment(plan: OverlayStudyPlan, dataset: DecisionMarketDataset,
  liquidity: readonly LiquidityObservation[] = []): OverlayDevelopment {
  const planHash = overlayPlanHash(plan);
  if (liquidity.some((row) => row.availableAtMs >= plan.validation.development.endExclusiveMs) || overlayHash(liquidity) !== plan.developmentLiquidityHash || dataset.report.datasetHash !== plan.developmentDatasetHash || dataset.barsById[dataset.assets[0]!]![0]!.startTimeMs !== plan.validation.development.startMs ||
      dataset.barsById[dataset.assets[0]!]!.at(-1)!.endTimeMs !== plan.validation.development.endExclusiveMs ||
      JSON.stringify(dataset.assets) !== JSON.stringify(plan.universe.assets)) throw new Error('overlay_development_only');
  const candidates = overlayCandidates(), accumulated = new Map<string, OverlayScore>(), folds: OverlayDevelopment['folds'][number][] = [], allFoldScores: OverlayScore[] = [];
  for (let fold = 1; fold < plan.validation.nestedFoldCount; fold++) {
    const start = Math.floor(fold * dataset.dayKeys.length / plan.validation.nestedFoldCount), finish = Math.floor((fold + 1) * dataset.dayKeys.length / plan.validation.nestedFoldCount);
    const startMs = dataset.barsById[dataset.assets[0]!]![start]!.startTimeMs;
    const boundaryMs = decisionFrameAt(dataset, start).decisionAtMs - plan.validation.embargoDays * 86_400_000;
    if (start < plan.execution.warmupBars || finish - start < 30) {
      folds.push({ trainingEndMs: boundaryMs, validationStartMs: startMs, validationEndMs: dataset.barsById[dataset.assets[0]!]![finish - 1]!.endTimeMs, selected: [], reason: 'insufficient_fold_history' }); continue;
    }
    const prefix = overlayPrefix(dataset, finish), fit = artifactFitter(prefix, plan, boundaryMs, liquidity), foldScores: OverlayScore[] = [];
    for (const scenario of plan.scenarios) {
      const replayCache = new Map<string, ReturnType<typeof replayOverlay>>();
      const baselines = new Map([1, 14].map((cadence) => [cadence, replayOverlay(prefix, plan, candidates.find((c) => c.cadence === cadence && c.gate === 'none' && c.model === 'none')!, { startIndex: start, costs: scenario.config })]));
      for (const candidate of candidates) {
        const artifact = fit(candidate, scenario.config);
        const keyBehavior = artifact ? candidate.id : JSON.stringify([candidate.cadence, candidate.gate === 'ml' ? 'none' : candidate.gate, candidate.volatilityMultiple, candidate.abstention]);
        let run = replayCache.get(keyBehavior);
        if (!run) { run = replayOverlay(prefix, plan, candidate, { startIndex: start, costs: scenario.config, artifact, liquidity }); replayCache.set(keyBehavior, run); }
        if (!artifact) run = { ...run, coverage: { ...run.coverage, fallback: candidate.model === 'none' ? 0 : run.coverage.eligible } };
        const baseline = baselines.get(candidate.cadence)!, returns = equityReturns(run.equity), baselineReturns = equityReturns(baseline.equity);
        const probabilities: number[] = [], labels: boolean[] = [];
        for (const trace of run.traces) if (trace.probability !== null) {
          const outcome = traceActionOutcome(prefix, trace, candidate.cadence, scenario.config, plan.execution.cashAprPct);
          if (outcome !== null) { probabilities.push(trace.probability); labels.push(outcome > 0); }
        }
        const score: OverlayScore = { candidate, scenario: scenario.scenario, costHash: costScenarioHash(scenario),
          netReturnPct: run.metrics.totalReturnPct, excessVsBaselinePct: run.metrics.totalReturnPct - baseline.metrics.totalReturnPct,
          returns, eligible: run.coverage.eligible, selectedOpportunities: run.coverage.selected, rejectedOpportunities: run.coverage.rejected,
          componentCosts: run.componentCosts, exposureDifference: exposureDifference(prefix, run, baseline),
          rejectionAgreement: { count: run.traces.filter((t) => t.scheduled && t.permitted !== null && t.baselineBelowTrend !== null).length,
            agreed: run.traces.filter((t) => t.scheduled && t.permitted !== null && t.baselineBelowTrend !== null && !t.permitted === t.baselineBelowTrend).length }, costBearingActions: run.costs.events, predictions: probabilities.length,
          fallbacks: run.coverage.fallback, turnoverUsd: run.costs.turnoverUsd, costUsd: run.costs.totalCostUsd,
          maximumDrawdownPct: run.metrics.maxDrawdownPct, calibrationPairs: probabilities.map((probability, i) => ({ probability, positive: labels[i]! })), diagnostics: calibrationDiagnostics(probabilities, labels), trendOverlap: run.overlap,
          intervalAttribution: run.traces.flatMap((trace, index) => !trace.scheduled ? [] : [{ startMs: trace.frame.executionAtMs,
            endMs: trace.frame.executionAtMs + candidate.cadence * 86_400_000, selected: trace.permitted === true,
            complete: index + candidate.cadence <= baselineReturns.length,
            baselineNetReturn: index + candidate.cadence <= baselineReturns.length ? baselineReturns.slice(index, index + candidate.cadence).reduce((growth, r) => growth * (1 + r), 1) - 1 : null }]) };
        foldScores.push(score); allFoldScores.push(score);
        const key = `${candidate.id}:${scenario.scenario}`, previous = accumulated.get(key);
        accumulated.set(key, previous ? { ...score, returns: [...previous.returns, ...score.returns],
          netReturnPct: ((1 + previous.netReturnPct / 100) * (1 + score.netReturnPct / 100) - 1) * 100,
          excessVsBaselinePct: ((1 + previous.netReturnPct / 100) * (1 + score.netReturnPct / 100) - (1 + (previous.netReturnPct - previous.excessVsBaselinePct) / 100) * (1 + (score.netReturnPct - score.excessVsBaselinePct) / 100)) * 100,
          maximumDrawdownPct: Math.max(previous.maximumDrawdownPct, score.maximumDrawdownPct),
          calibrationPairs: [...previous.calibrationPairs, ...score.calibrationPairs],
          diagnostics: calibrationDiagnostics([...previous.calibrationPairs, ...score.calibrationPairs].map((p) => p.probability), [...previous.calibrationPairs, ...score.calibrationPairs].map((p) => p.positive)),
          trendOverlap: { belowTrend: previous.trendOverlap.belowTrend + score.trendOverlap.belowTrend, rejectedBelowTrend: previous.trendOverlap.rejectedBelowTrend + score.trendOverlap.rejectedBelowTrend },
          eligible: previous.eligible + score.eligible, selectedOpportunities: previous.selectedOpportunities + score.selectedOpportunities, rejectedOpportunities: previous.rejectedOpportunities + score.rejectedOpportunities,
          componentCosts: { fee: new Decimal(previous.componentCosts.fee).add(score.componentCosts.fee).toFixed(), spread: new Decimal(previous.componentCosts.spread).add(score.componentCosts.spread).toFixed(),
            slippage: new Decimal(previous.componentCosts.slippage).add(score.componentCosts.slippage).toFixed(), impact: new Decimal(previous.componentCosts.impact).add(score.componentCosts.impact).toFixed() },
          exposureDifference: (previous.exposureDifference * previous.returns.length + score.exposureDifference * score.returns.length) / (previous.returns.length + score.returns.length),
          rejectionAgreement: { count: previous.rejectionAgreement.count + score.rejectionAgreement.count, agreed: previous.rejectionAgreement.agreed + score.rejectionAgreement.agreed }, costBearingActions: previous.costBearingActions + score.costBearingActions,
          predictions: previous.predictions + score.predictions, fallbacks: previous.fallbacks + score.fallbacks,
          costUsd: previous.costUsd + score.costUsd, turnoverUsd: previous.turnoverUsd + score.turnoverUsd,
          intervalAttribution: [...previous.intervalAttribution, ...score.intervalAttribution] } : score);
      }
    }
    folds.push({ trainingEndMs: boundaryMs, validationStartMs: startMs, validationEndMs: prefix.barsById[prefix.assets[0]!]!.at(-1)!.endTimeMs,
      selected: innerSelection(plan, dataset, start, liquidity), reason: null });
  }
  const scores = [...accumulated.values()];
  const selected = selectOverlayScores(scores);
  const conservative = scores.filter((s) => s.scenario === 'conservative');
  // PBO uses only chronologically produced out-of-sample policy returns.
  return { planHash, datasetHash: dataset.report.datasetHash, holdout: 'not_loaded', scores, folds, foldScores: allFoldScores, ...selected,
    pbo: combinatoriallySymmetricCrossValidation(conservative.map((s) => [...s.returns]), plan.validation.cscvPartitionCount) };
}
function innerSelection(plan: OverlayStudyPlan, dataset: DecisionMarketDataset, outerStart: number, liquidity: readonly LiquidityObservation[]): readonly string[] {
  const boundary = decisionFrameAt(dataset, outerStart).decisionAtMs - plan.validation.embargoDays * 86_400_000;
  const end = dataset.barsById[dataset.assets[0]!]!.findIndex((bar) => bar.endTimeMs > boundary);
  if (end < plan.execution.warmupBars * 2 || plan.validation.nestedFoldCount === 2) return [];
  const prefix = overlayPrefix(dataset, end);
  const innerLiquidity = liquidity.filter((row) => row.availableAtMs < prefix.barsById[prefix.assets[0]!]!.at(-1)!.endTimeMs);
  const innerPlan = { ...plan, developmentLiquidityHash: overlayHash(innerLiquidity), developmentDatasetHash: prefix.report.datasetHash, validation: { ...plan.validation, nestedFoldCount: 2,
    development: { ...plan.validation.development, endExclusiveMs: prefix.barsById[prefix.assets[0]!]!.at(-1)!.endTimeMs } } };
  return evaluateOverlayDevelopment(innerPlan, prefix, innerLiquidity).selected;
}
export function overlayDevelopmentSharpes(development: OverlayDevelopment): number[] {
  return development.scores.filter((s) => s.scenario === 'conservative').flatMap((s) => { const sharpe = periodSharpe([...s.returns]); return sharpe === null ? [] : [sharpe]; });
}

function exposureDifference(dataset: DecisionMarketDataset, treatment: ReturnType<typeof replayOverlay>, baseline: ReturnType<typeof replayOverlay>): number {
  const exposure = (trace: typeof treatment.traces[number]) => {
    const marks = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]![trace.frame.executionIndex]!]));
    return 1 - new Decimal(trace.book.cash).div(researchBookValue(trace.book, marks)).toNumber();
  };
  return treatment.traces.reduce((sum, trace, i) => sum + exposure(trace) - exposure(baseline.traces[i]!), 0) / treatment.traces.length;
}
