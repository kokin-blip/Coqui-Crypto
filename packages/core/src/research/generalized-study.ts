import { periodSharpe } from '../significance/index.js';
import { equityReturns, type TrackResult } from '../backtest/index.js';
import { costScenarioHash } from '../costs/index.js';
import { buildDecisionMarketDataset, type DecisionMarketDataset } from '../market/index.js';
import type { TrialRegistrySnapshot } from '../trials/index.js';
import { combinatoriallySymmetricCrossValidation, type CscvPboResult } from './cscv.js';
import { analyzeHoldoutEvidence, type HoldoutAdoptionResult } from './holdout-evidence.js';
import { familyCandidates, runFamilyCandidate, type FamilyCandidate } from './family-runner.js';
import { integrityPlanHash, legacyShapeForIntegrity, type IntegrityStudyPlan } from './integrity-plan.js';

export interface ScenarioScore {
  readonly scenario: string; readonly costProfileHash: string; readonly afterCostReturnPct: number;
  readonly excessVsHoldPct: number; readonly excessVsPassivePct: number;
  readonly totalCostUsd: number; readonly turnoverUsd: number; readonly tradeEvents: number;
}
export interface DevelopmentCandidateScore {
  readonly candidate: FamilyCandidate;
  readonly segments: number;
  readonly scenarios: readonly ScenarioScore[];
  readonly sharpes: readonly number[];
}
export interface IntegrityDevelopmentResult {
  readonly planHash: string; readonly datasetHash: string;
  readonly candidates: readonly DevelopmentCandidateScore[];
  readonly selectedCandidate: FamilyCandidate;
  readonly folds: readonly { fold: number; trainingEndExclusiveMs: number; validationStartMs: number;
    validationEndExclusiveMs: number; selectedCandidateId: string; scenarios: readonly ScenarioScore[] }[];
  readonly pbo: CscvPboResult;
  readonly accountEvidenceAvailable: boolean;
  readonly finalHoldout: 'not_loaded';
}
const DAY = 86_400_000;
function slice(dataset: DecisionMarketDataset, end: number): DecisionMarketDataset {
  return buildDecisionMarketDataset(Object.fromEntries(dataset.assets.map((asset) => [asset, dataset.barsById[asset]!.slice(0, end)])),
    dataset.assets, { policy: 'reject-on-gap', nowMs: dataset.generatedAtMs });
}
function returnPct(track: TrackResult) { return (track.equity.at(-1)!.value / 10000 - 1) * 100; }
function scenariosAt(dataset: DecisionMarketDataset, start: number, plan: IntegrityStudyPlan, candidate: FamilyCandidate) {
  return plan.scenarios.map((scenario) => {
    const result = runFamilyCandidate(dataset, start, plan, candidate, scenario);
    const family = plan.family === 'signal-tilt' ? 'signal' : plan.family;
    const track = result[family];
    return { scenario: scenario.scenario, costProfileHash: costScenarioHash(scenario),
      afterCostReturnPct: returnPct(track), excessVsHoldPct: returnPct(track) - returnPct(result.hold),
      excessVsPassivePct: returnPct(track) - returnPct(result.passive), totalCostUsd: track.costs.totalCostUsd,
      turnoverUsd: track.costs.turnoverUsd, tradeEvents: track.costs.events };
  });
}
function developmentScores(dataset: DecisionMarketDataset, end: number, plan: IntegrityStudyPlan,
  candidates: readonly FamilyCandidate[]): DevelopmentCandidateScore[] {
  const remaining = end - plan.execution.warmupBars;
  if (remaining < plan.validation.nestedFoldCount * 2) throw new RangeError('Insufficient inner validation bars');
  return candidates.map((candidate) => {
    const segments = Array.from({ length: plan.validation.nestedFoldCount }, (_, index) => {
      const start = plan.execution.warmupBars + Math.floor(index * remaining / plan.validation.nestedFoldCount);
      const finish = plan.execution.warmupBars + Math.floor((index + 1) * remaining / plan.validation.nestedFoldCount);
      return scenariosAt(slice(dataset, finish), start, plan, candidate);
    });
    const scenarios = plan.scenarios.map((profile, index) => {
      const values = segments.map((segment) => segment[index]!);
      const avg = (key: 'afterCostReturnPct' | 'excessVsHoldPct' | 'excessVsPassivePct' | 'totalCostUsd' | 'turnoverUsd' | 'tradeEvents') =>
        values.reduce((sum, value) => sum + value[key], 0) / values.length;
      return { scenario: profile.scenario, costProfileHash: costScenarioHash(profile), afterCostReturnPct: avg('afterCostReturnPct'),
        excessVsHoldPct: avg('excessVsHoldPct'), excessVsPassivePct: avg('excessVsPassivePct'),
        totalCostUsd: avg('totalCostUsd'), turnoverUsd: avg('turnoverUsd'), tradeEvents: avg('tradeEvents') };
    });
    return { candidate, segments: segments.length, scenarios, sharpes: [] };
  });
}
function best(scores: readonly DevelopmentCandidateScore[]): FamilyCandidate {
  const rank = (item: DevelopmentCandidateScore) => item.scenarios.find((s) => s.scenario === 'conservative')!.excessVsHoldPct;
  return [...scores].sort((a, b) => rank(b) - rank(a) || a.candidate.id.localeCompare(b.candidate.id))[0]!.candidate;
}

/** Receives only development observations. Final data are not an argument. */
export function evaluateIntegrityDevelopment(plan: IntegrityStudyPlan, dataset: DecisionMarketDataset): IntegrityDevelopmentResult {
  const planHash = integrityPlanHash(plan);
  if (dataset.report.datasetHash !== plan.developmentDatasetHash ||
      dataset.barsById[dataset.assets[0]!]![0]!.startTimeMs !== plan.validation.development.startMs ||
      dataset.barsById[dataset.assets[0]!]!.at(-1)!.endTimeMs !== plan.validation.development.endExclusiveMs ||
      dataset.dayKeys.length < plan.validation.minimumDevelopmentBars ||
      JSON.stringify([...dataset.assets].sort()) !== JSON.stringify([...plan.universe.assets].sort())) {
    throw new TypeError('Only the registered development dataset may enter selection');
  }
  const candidates = familyCandidates(plan);
  const folds: IntegrityDevelopmentResult['folds'][number][] = [];
  const length = dataset.dayKeys.length;
  for (let fold = 1; fold < plan.validation.nestedFoldCount; fold += 1) {
    const start = Math.floor(fold * length / plan.validation.nestedFoldCount);
    const end = Math.floor((fold + 1) * length / plan.validation.nestedFoldCount);
    const trainingEnd = start - plan.validation.embargoDays;
    const selected = best(developmentScores(dataset, trainingEnd, plan, candidates));
    folds.push({ fold, trainingEndExclusiveMs: plan.validation.development.startMs + trainingEnd * DAY,
      validationStartMs: plan.validation.development.startMs + start * DAY,
      validationEndExclusiveMs: plan.validation.development.startMs + end * DAY,
      selectedCandidateId: selected.id, scenarios: scenariosAt(slice(dataset, end), start, plan, selected) });
  }
  const scores = developmentScores(dataset, length, plan, candidates);
  const conservative = plan.scenarios.find((scenario) => scenario.scenario === 'conservative')!;
  const family = plan.family === 'signal-tilt' ? 'signal' : plan.family;
  const returns = candidates.map((candidate) => equityReturns(runFamilyCandidate(dataset, plan.execution.warmupBars, plan, candidate, conservative)[family].equity));
  for (const [index, score] of scores.entries()) {
    const sharpe = periodSharpe(returns[index]!);
    scores[index] = { ...score, sharpes: sharpe === null ? [] : [sharpe] };
  }
  return { planHash, datasetHash: dataset.report.datasetHash, candidates: scores, selectedCandidate: best(scores), folds,
    pbo: combinatoriallySymmetricCrossValidation(returns, plan.validation.cscvPartitionCount),
    accountEvidenceAvailable: plan.scenarios.some((s) => s.scenario === 'account'), finalHoldout: 'not_loaded' };
}
export interface IntegrityFinalResult {
  readonly planHash: string; readonly candidateId: string; readonly datasetHash: string;
  readonly scenarios: readonly { scenario: string; costProfileHash: string; evidence: HoldoutAdoptionResult }[];
  readonly adopted: boolean; readonly limitation: string | null;
}
/** Called only after a durable service-level final claim. Context bars end before scored holdout bars. */
export function evaluateIntegrityFinal(plan: IntegrityStudyPlan, development: IntegrityDevelopmentResult,
  dataset: DecisionMarketDataset, registry: TrialRegistrySnapshot): IntegrityFinalResult {
  const planHash = integrityPlanHash(plan);
  if (development.planHash !== planHash) throw new TypeError('Frozen development identity mismatch');
  const start = dataset.dayKeys.indexOf(new Date(plan.validation.holdout.startMs).toISOString().slice(0, 10));
  const last = dataset.barsById[dataset.assets[0]!]!.at(-1);
  if (start < plan.execution.warmupBars || !last || last.endTimeMs !== plan.validation.holdout.endExclusiveMs ||
      dataset.dayKeys.length - start < plan.validation.minimumHoldoutBars ||
      JSON.stringify([...dataset.assets].sort()) !== JSON.stringify([...plan.universe.assets].sort())) {
    throw new TypeError('Holdout coverage or causal warmup missing');
  }
  const developmentBars = (plan.validation.development.endExclusiveMs - plan.validation.development.startMs) / DAY;
  if (dataset.barsById[dataset.assets[0]!]![0]!.startTimeMs !== plan.validation.development.startMs ||
      slice(dataset, developmentBars).report.datasetHash !== plan.developmentDatasetHash) throw new TypeError('Frozen warmup history changed');
  const candidate = development.selectedCandidate;
  const family = plan.family === 'signal-tilt' ? 'signal' : plan.family;
  const scenarios = plan.scenarios.map((profile) => {
    const run = runFamilyCandidate(dataset, start, plan, candidate, profile);
    if (!run.confirmatoryEligible) throw new TypeError('Observed opens required for confirmatory evidence');
    const evidence = analyzeHoldoutEvidence({
      plan: { ...legacyShapeForIntegrity(plan), candidateCount: 0 }, registry, pbo: development.pbo,
      selectedTrack: run[family], holdTrack: run.hold, passiveTrack: run.passive,
      developmentSharpes: development.candidates.flatMap((item) => item.sharpes),
    });
    return { scenario: profile.scenario, costProfileHash: costScenarioHash(profile), evidence };
  });
  const required = ['account', 'conservative'].map((name) => scenarios.find((s) => s.scenario === name));
  return { planHash, candidateId: candidate.id, datasetHash: dataset.report.datasetHash, scenarios,
    adopted: required.every((item) => item?.evidence.adopted === true),
    limitation: required.some((item) => item === undefined) ? 'account_cost_evidence_unavailable' : null };
}
