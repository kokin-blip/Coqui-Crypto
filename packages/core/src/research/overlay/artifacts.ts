import { Decimal } from 'decimal.js';
import { decisionFrameAt } from '../../backtest/execution-timing.js';
import { rebalanceResearchBook, researchBookValue, type ResearchBook } from '../../backtest/integrity-book.js';
import { sourceCompletionDelayMs, type DecisionMarketDataset } from '../../market/index.js';
import type { InstrumentKey } from '../../types/index.js';
import type { TradeCostConfig } from '../../costs/index.js';
import { dailyOverlayFeatures, maturedRows, overlayRows } from './features.js';
import { trainOverlayModel, predictOverlayModel } from './models.js';
import { fitOverlayCalibration } from './calibration.js';
import { replayOverlay } from './replay.js';
import { actionScore, boundedTilt, verifiedOverlayLiquidity } from './proposals.js';
import { FEATURE_VERSION, OVERLAY_VERSION, type OverlayArtifact, type OverlayCandidate, type OverlayStudyPlan,
  type OverlayTrace, type LiquidityObservation } from './types.js';
import { overlayHash, overlayPlanHash, OVERLAY_RISK_HASH, overlayCandidates } from './registration.js';
export function counterfactualNetPct(input: { book: ResearchBook; weights: ReadonlyMap<InstrumentKey, number>;
  referenceWeights?: ReadonlyMap<InstrumentKey, number>; prices: ReadonlyMap<InstrumentKey, number>;
  endingPrices: ReadonlyMap<InstrumentKey, number>; costs: TradeCostConfig; horizonDays: number; cashAprPct: number;
  risk?: OverlayTrace['risk']; path?: readonly { readonly observedPrices: ReadonlyMap<InstrumentKey, number>; readonly executionPrices: ReadonlyMap<InstrumentKey, number> }[] }): number {
  const next = rebalanceResearchBook(input.book, input.prices, input.weights, input.costs).book;
  const reference = input.referenceWeights ? rebalanceResearchBook(input.book, input.prices, input.referenceWeights, input.costs).book : input.book;
  const finish = (starting: ResearchBook) => {
    let book = starting, peak = input.risk?.peak ?? researchBookValue(input.book, input.prices).toNumber();
    let prior = input.risk?.priorObserved ?? peak, stopped = input.risk?.stopped ?? false;
    if (!input.path) return { ...book, cash: new Decimal(book.cash).mul(Math.pow(1 + input.cashAprPct / 100, input.horizonDays / 365)).toFixed() };
    for (const step of input.path) {
      book = { ...book, cash: new Decimal(book.cash).mul(Math.pow(1 + input.cashAprPct / 100, 1 / 365)).toFixed() };
      const observed = researchBookValue(book, step.observedPrices).toNumber(); peak = Math.max(peak, observed);
      stopped ||= observed / peak <= 0.92 || (prior > 0 && observed / prior <= 0.98); prior = observed;
      if (stopped) book = rebalanceResearchBook(book, step.executionPrices, new Map(), input.costs).book;
    }
    return book;
  };
  return researchBookValue(finish(next), input.endingPrices).sub(researchBookValue(finish(reference), input.endingPrices))
    .div(researchBookValue(input.book, input.prices)).mul(100).toNumber();
}
export function fitOverlayArtifact(dataset: DecisionMarketDataset, plan: OverlayStudyPlan, candidate: OverlayCandidate,
  costs: TradeCostConfig, boundaryMs: number, liquidity: readonly LiquidityObservation[] = []): OverlayArtifact | null {
  if (candidate.model === 'none') return null;
  const rows = maturedRows(overlayRows(dataset, plan.arms.find((arm) => arm.cadence === candidate.cadence)!),
    plan.validation.development.startMs, boundaryMs);
  const calibrationRows = rows.slice(-60); if (calibrationRows.length < 60) return null;
  const calibrationStart = calibrationRows[0]!.decisionAtMs;
  const training = maturedRows(rows, plan.validation.development.startMs, calibrationStart);
  if (training.length < 120) return null;
  const model = trainOverlayModel(training, candidate, calibrationStart);
  const baseline = overlayCandidates().find((c) => c.cadence === candidate.cadence && c.model === 'none' && c.gate === 'none')!;
  const historyEnd = dataset.dayKeys.findIndex((_, i) => dataset.barsById[dataset.assets[0]!]![i]!.startTimeMs >= boundaryMs);
  const run = replayOverlay(dataset, plan, baseline, { startIndex: plan.execution.warmupBars,
    endExclusiveIndex: historyEnd < 0 ? dataset.dayKeys.length : historyEnd, costs });
  const traces = new Map(run.traces.map((trace) => [trace.frame.executionAtMs, trace]));
  const participationScores: number[] = [], participationLabels: boolean[] = [], tiltScores: number[] = [], tiltLabels: boolean[] = [];
  for (const row of calibrationRows) {
    const trace = traces.get(row.executionAtMs); if (!trace || !trace.scheduled || trace.reason === 'hard_safety_stop') continue;
    const observed = trace.frame.observedEndExclusive;
    const history = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]!.slice(0, observed)]));
    const prices = new Map(dataset.assets.map((asset) => [asset, history.get(asset)!.at(-1)!]));
    const index = dataset.barsById[dataset.assets[0]!]!.findIndex((bar) => bar.startTimeMs === row.executionAtMs);
    const execution = new Map(dataset.assets.map((asset) => [asset, dataset.opensById[asset]![index]!]));
    const ending = new Map(dataset.assets.map((asset) => [asset, dataset.opensById[asset]![index + candidate.cadence]!]));
    const prediction = predictOverlayModel(model, row.features), weights = new Map(trace.targets.map((t) => [t.assetId, t.weight]));
    const score = actionScore(trace.bookBefore, prices, weights, prediction, dataset.assets, costs);
    participationScores.push(score.score);
    participationLabels.push(counterfactualNetPct({ book: trace.bookBefore, weights, prices: execution, endingPrices: ending,
      costs, horizonDays: candidate.cadence, cashAprPct: plan.execution.cashAprPct, risk: trace.risk, path: counterfactualPath(dataset, index, candidate.cadence) }) > 0);
    const proposal = boundedTilt({ book: trace.bookBefore, baseline: weights, prices, histories: history,
      prediction, assets: dataset.assets, candidate, costs, liquidity, observedThroughMs: trace.frame.observedThroughMs, decisionAtMs: trace.frame.decisionAtMs });
    tiltScores.push(proposal.score);
    const volumes = verifiedOverlayLiquidity(liquidity, trace.frame.observedThroughMs, trace.frame.decisionAtMs);
    const executable = proposal.changed && !rebalanceResearchBook(trace.bookBefore, execution, proposal.weights, costs).fills.some((fill) =>
      new Decimal(fill.referenceNotional).gt(new Decimal(volumes.get(fill.assetId) ?? 0).mul(0.001)));
    tiltLabels.push(executable && counterfactualNetPct({ book: trace.bookBefore, weights: proposal.weights,
      referenceWeights: weights, prices: execution, endingPrices: ending, costs, horizonDays: candidate.cadence, cashAprPct: plan.execution.cashAprPct, risk: trace.risk, path: counterfactualPath(dataset, index, candidate.cadence) }) > 0);
  }
  return { version: OVERLAY_VERSION, candidateId: candidate.id, model,
    participation: fitOverlayCalibration(participationScores, participationLabels), tilt: fitOverlayCalibration(tiltScores, tiltLabels),
    trainingWindow: { startMs: training[0]!.executionAtMs, endExclusiveMs: calibrationStart },
    calibrationWindow: { startMs: calibrationStart, endExclusiveMs: boundaryMs },
    features: FEATURE_VERSION, label: 'attainable-open-horizon-gross-return', cadence: candidate.cadence,
    assets: dataset.assets, planHash: overlayPlanHash(plan), datasetHash: dataset.report.datasetHash,
    costHash: overlayHash(costs), riskHash: OVERLAY_RISK_HASH, sourceManifestHash: plan.sourceManifestHash,
    lockfileHash: plan.lockfileHash, seed: plan.validation.bootstrapSeed, evaluationResultHash: null, liquidityHash: overlayHash(liquidity),
    updatePolicy: 'explicit', futureRefitContract: 'registered-schedule-separate-qualification' };
}
export function validateOverlayArtifact(artifact: OverlayArtifact, plan: OverlayStudyPlan, candidate: OverlayCandidate, costs: TradeCostConfig): void {
  if (!/^[a-f0-9]{64}$/u.test(artifact.datasetHash) || !/^[a-f0-9]{64}$/u.test(artifact.liquidityHash) ||
      artifact.calibrationWindow.endExclusiveMs > plan.validation.development.endExclusiveMs || artifact.version !== OVERLAY_VERSION || artifact.candidateId !== candidate.id || artifact.model.kind !== candidate.model ||
      artifact.model.parameter !== candidate.modelParameter || artifact.planHash !== overlayPlanHash(plan) || artifact.features !== FEATURE_VERSION ||
      artifact.label !== 'attainable-open-horizon-gross-return' || artifact.cadence !== candidate.cadence ||
      artifact.costHash !== overlayHash(costs) || artifact.riskHash !== OVERLAY_RISK_HASH ||
      artifact.sourceManifestHash !== plan.sourceManifestHash || artifact.lockfileHash !== plan.lockfileHash ||
      artifact.updatePolicy !== 'explicit' || artifact.futureRefitContract !== 'registered-schedule-separate-qualification' ||
      artifact.trainingWindow.startMs >= artifact.trainingWindow.endExclusiveMs ||
      artifact.trainingWindow.endExclusiveMs > artifact.calibrationWindow.startMs ||
      artifact.calibrationWindow.startMs >= artifact.calibrationWindow.endExclusiveMs ||
      artifact.model.trainedThroughMs >= artifact.calibrationWindow.startMs ||
      JSON.stringify(artifact.assets) !== JSON.stringify(plan.universe.assets)) throw new Error('overlay_artifact_provenance_invalid');
  for (const calibration of [artifact.participation, artifact.tilt]) if (calibration &&
    (![calibration.intercept, calibration.slope].every(Number.isFinite) || calibration.observations < 60)) throw new Error('overlay_calibration_invalid');
  const probe = dailyOverlayFeatures(artifact.assets.map(() => Array<number>(31).fill(100)))!;
  predictOverlayModel(artifact.model, probe);
  overlayHash(artifact);
}
export function traceActionOutcome(dataset: DecisionMarketDataset, trace: OverlayTrace, cadence: number, costs: TradeCostConfig, cashAprPct: number): number | null {
  if (trace.reason === 'liquidity_execution_baseline_fallback') return 0;
  const index = dataset.barsById[dataset.assets[0]!]!.findIndex((bar) => bar.startTimeMs === trace.frame.executionAtMs);
  if (index < 0 || index + cadence >= dataset.dayKeys.length || dataset.barsById[dataset.assets[0]!]![index + cadence]!.endTimeMs + sourceCompletionDelayMs(dataset.barsById[dataset.assets[0]!]![index + cadence]!.source) >= Math.min(dataset.generatedAtMs, dataset.barsById[dataset.assets[0]!]!.at(-1)!.endTimeMs)) return null;
  return counterfactualNetPct({ book: trace.bookBefore, weights: new Map(trace.evaluatedTargets.map((t) => [t.assetId, t.weight])),
    ...(trace.referenceTargets ? { referenceWeights: new Map(trace.referenceTargets.map((t) => [t.assetId, t.weight])) } : {}),
    prices: new Map(dataset.assets.map((asset) => [asset, dataset.opensById[asset]![index]!])),
    endingPrices: new Map(dataset.assets.map((asset) => [asset, dataset.opensById[asset]![index + cadence]!])),
    costs, horizonDays: cadence, cashAprPct, risk: trace.risk, path: counterfactualPath(dataset, index, cadence) });
}

function counterfactualPath(dataset: DecisionMarketDataset, start: number, horizon: number) {
  return Array.from({ length: horizon }, (_, i) => {
    const index = start + i + 1, observed = decisionFrameAt(dataset, index).observedEndExclusive;
    return { observedPrices: new Map(dataset.assets.map((a) => [a, dataset.closesById[a]![observed - 1]!])),
      executionPrices: new Map(dataset.assets.map((a) => [a, dataset.opensById[a]![index]!])) };
  });
}
