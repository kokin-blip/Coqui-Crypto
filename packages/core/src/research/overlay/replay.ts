import type { InstrumentKey } from '../../types/index.js';
import { Decimal } from 'decimal.js';
import { validateDecisionDataset, decisionFrameAt } from '../../backtest/execution-timing.js';
import { rebalanceResearchBook, researchBookValue, type ResearchBook } from '../../backtest/integrity-book.js';
import { metricsFrom } from '../../backtest/analytics.js';
import type { EquityPoint } from '../../backtest/types.js';
import type { DecisionMarketDataset } from '../../market/index.js';
import type { TradeCostConfig } from '../../costs/index.js';
import { momentumTargetsAt } from '../../strategies/momentum.js';
import { volTargetExposureAt } from '../../strategies/vol-target.js';
import { composeTrendVolTargets } from '../../strategies/trend-vol.js';
import { dailyOverlayFeatures, scheduledOverlay } from './features.js';
import { ruleParticipation } from './rules.js';
import { constrainedOverlayTargets } from './decision.js';
import { actionScore, boundedTilt, verifiedOverlayLiquidity } from './proposals.js';
import { calibratedProbability } from './calibration.js';
import { validateOverlayArtifact } from './artifacts.js';
import { predictOverlayModel } from './models.js';
import type { LiquidityObservation, OverlayArtifact, OverlayCandidate, OverlayReplay, OverlayStudyPlan, OverlayTrace } from './types.js';
import { overlayPlanHash } from './registration.js';
export interface OverlayReplayOptions {
  readonly startIndex: number; readonly endExclusiveIndex?: number; readonly costs: TradeCostConfig;
  readonly artifact?: OverlayArtifact | null;
  readonly liquidity?: readonly LiquidityObservation[];
  readonly onDecision?: (trace: OverlayTrace) => void;
  readonly initialBook?: ResearchBook;
  readonly initialRisk?: { readonly peak: number; readonly priorObserved: number; readonly stopped: boolean };
}
export function replayOverlay(dataset: DecisionMarketDataset, plan: OverlayStudyPlan,
  candidate: OverlayCandidate, options: OverlayReplayOptions): OverlayReplay {
  validateDecisionDataset(dataset); overlayPlanHash(plan);
  if (JSON.stringify(dataset.assets) !== JSON.stringify(plan.universe.assets)) throw new Error('overlay_replay_universe_mismatch');
  if (dataset.assets.some((asset) => dataset.barsById[asset]!.some((bar) => (bar.quality ?? 'reported_ohlc') !== 'reported_ohlc'))) throw new Error('overlay_observed_opens_required');
  const arm = plan.arms.find((value) => value.cadence === candidate.cadence)!;
  if (!arm || !Number.isSafeInteger(options.startIndex) || options.startIndex < 2 || options.startIndex >= dataset.dayKeys.length ||
      (options.endExclusiveIndex !== undefined && (!Number.isSafeInteger(options.endExclusiveIndex) || options.endExclusiveIndex <= options.startIndex || options.endExclusiveIndex > dataset.dayKeys.length))) throw new Error('overlay_replay_bounds');
  const artifact = options.artifact;
  if (artifact) {
    validateOverlayArtifact(artifact, plan, candidate, options.costs);
    if (artifact.calibrationWindow.endExclusiveMs > decisionFrameAt(dataset, options.startIndex).decisionAtMs) {
      throw new Error('overlay_artifact_incompatible');
    }
  }
  const base = plan.execution.baseTargets.map((t) => ({ ...t, assetId: t.assetId as InstrumentKey }));
  let book: ResearchBook = options.initialBook ?? { cash: '10000', units: new Map() };
  const equity: EquityPoint[] = [{ t: -1, value: researchBookValue(book, new Map(dataset.assets.map((asset) => [asset, dataset.opensById[asset]![options.startIndex]!]))).toNumber() }];
  const traces: OverlayTrace[] = []; let peak = options.initialRisk?.peak ?? new Decimal(book.cash).toNumber(); let stopped = options.initialRisk?.stopped ?? false; let priorObserved = options.initialRisk?.priorObserved ?? peak;
  let fee = new Decimal(0), spread = new Decimal(0), slip = new Decimal(0), impact = new Decimal(0), turnover = new Decimal(0), events = 0;
  const coverage = { eligible: 0, selected: 0, rejected: 0, fallback: 0 }, overlap = { belowTrend: 0, rejectedBelowTrend: 0 };
  for (let index = options.startIndex; index < (options.endExclusiveIndex ?? dataset.dayKeys.length); index++) {
    const frame = decisionFrameAt(dataset, index), end = frame.observedEndExclusive;
    const history = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]!.slice(0, end)]));
    const observedPrices = new Map(dataset.assets.map((asset) => [asset, history.get(asset)?.at(-1) ?? dataset.opensById[asset]![0]!]));
    const executionPrices = new Map(dataset.assets.map((asset) => [asset, dataset.opensById[asset]![index]!]));
    const marks = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]![index]!]));
    if (index > options.startIndex && plan.execution.cashAprPct > 0) book = { ...book, cash: new Decimal(book.cash).mul(Math.pow(1 + plan.execution.cashAprPct / 100, 1 / 365)).toFixed() };
    const bookBefore = book;
    const mix = Array.from({ length: end }, (_, day) => base.reduce((sum, target) => sum + target.weight * history.get(target.assetId)![day]! / history.get(target.assetId)![0]!, 0));
    const mom = momentumTargetsAt(base, history, end, plan.baseline.momentum), vol = volTargetExposureAt(mix, end, plan.baseline.volatility);
    const target = composeTrendVolTargets(base, mom, vol, 1, end, plan.baseline.momentum, plan.baseline.volatility);
    const baselineConstraint = constrainedOverlayTargets(book, observedPrices, new Map(target.targets.map((t) => [t.assetId, t.weight])), history);
    let weights = baselineConstraint.weights;
    const baselineTargets = [...weights].map(([assetId, weight]) => ({ assetId, weight }));
    let evaluatedTargets = baselineTargets; let referenceTargets: typeof target.targets | null = null;
    const scheduled = scheduledOverlay(frame.executionAtMs, arm);
    const enough = target.historyStatus === 'complete' && end >= plan.execution.warmupBars;
    let reason = scheduled ? 'baseline' : 'not_scheduled', permitted: boolean | null = null, fallback = false;
    let probability: number | null = null, prediction: number[] | null = null, execute = scheduled && enough;
    const observedValue = researchBookValue(book, observedPrices).toNumber(); peak = Math.max(peak, observedValue);
    const safety: boolean = stopped || (peak > 0 && observedValue / peak <= 0.92) || (priorObserved > 0 && observedValue / priorObserved <= 0.98);
    stopped ||= safety; priorObserved = observedValue;
    if (safety) { weights = new Map(); execute = true; reason = 'hard_safety_stop'; }
    else if (!enough) { execute = false; reason = 'insufficient_history'; }
    else if (scheduled) {
      coverage.eligible++; if (vol.belowTrend) overlap.belowTrend++;
      const rule = ruleParticipation(candidate, mix, plan.baseline.volatility.targetVolPct);
      permitted = rule.permitted; reason = rule.reason;
      if (candidate.model !== 'none') {
        const features = artifact ? dailyOverlayFeatures([...history.values()]) : null;
        if (!artifact || !features) { fallback = true; reason = 'model_unavailable_baseline_fallback'; }
        else {
          prediction = predictOverlayModel(artifact.model, features);
          if (candidate.gate === 'ml') {
            const score = actionScore(book, observedPrices, weights, prediction, dataset.assets, options.costs);
            if (!artifact.participation) { fallback = true; reason = 'calibration_unavailable_baseline_fallback'; }
            else { probability = calibratedProbability(artifact.participation, score.score);
              permitted = Number.isFinite(probability) && probability >= candidate.probabilityThreshold && score.score > 0;
              reason = permitted ? 'ml_permitted' : 'ml_rejected'; }
          }
          if (permitted && candidate.tilt) {
            const tilt = boundedTilt({ book, prices: observedPrices, baseline: weights, histories: history, prediction,
              assets: dataset.assets, candidate, costs: options.costs, liquidity: options.liquidity ?? [], observedThroughMs: frame.observedThroughMs, decisionAtMs: frame.decisionAtMs });
            const confidence = artifact.tilt ? calibratedProbability(artifact.tilt, tilt.score) : NaN;
            if (tilt.changed && Number.isFinite(confidence)) { probability = confidence; evaluatedTargets = [...tilt.weights].map(([assetId, weight]) => ({ assetId, weight })); referenceTargets = baselineTargets; }
            if (tilt.changed && Number.isFinite(confidence) && confidence >= candidate.probabilityThreshold) { weights = tilt.weights; probability = confidence; reason = 'bounded_tilt'; }
            else { fallback = true; reason = tilt.changed ? 'tilt_confidence_baseline_fallback' : tilt.reason; }
          }
        }
      }
      if (fallback) coverage.fallback++;
      if (!permitted) { coverage.rejected++; if (vol.belowTrend) overlap.rejectedBelowTrend++;
        execute = candidate.abstention === 'cash_exit'; weights = new Map(); }
      else coverage.selected++;
      // Shared constraints interpolate toward the authoritative baseline/overlay;
      // safety liquidation has priority over voluntary turnover limits.
      if (execute) {
        const constraint = constrainedOverlayTargets(book, observedPrices, weights, history);
        weights = constraint.weights;
        if (constraint.capped || baselineConstraint.capped) reason += ':risk_capped';
        if (constraint.refused) { execute = false; reason = 'position_risk_refusal'; }
      }
    }
    let transition = execute ? rebalanceResearchBook(book, executionPrices, weights, options.costs) : { book, fills: [] };
    if (execute && reason.startsWith('bounded_tilt')) {
      const volumes = verifiedOverlayLiquidity(options.liquidity ?? [], frame.observedThroughMs, frame.decisionAtMs);
      if (transition.fills.some((fill) => new Decimal(fill.referenceNotional).gt(new Decimal(volumes.get(fill.assetId) ?? 0).mul(0.001)))) {
        weights = new Map(baselineTargets.map((t) => [t.assetId, t.weight]));
        transition = rebalanceResearchBook(book, executionPrices, weights, options.costs);
        if (!fallback) coverage.fallback++; fallback = true; reason = 'liquidity_execution_baseline_fallback';
      }
    }
    book = transition.book;
    if (transition.fills.length) events++;
    for (const fill of transition.fills) { fee = fee.add(fill.venueFee); spread = spread.add(fill.spreadCost); slip = slip.add(fill.slippageCost); impact = impact.add(fill.impactCost); turnover = turnover.add(fill.referenceNotional); }
    const trace: OverlayTrace = { frame, scheduled, reason, permitted, fallback, baselineBelowTrend: vol.belowTrend,
      baselineExposure: target.exposure, probability, prediction, targets: [...weights].map(([assetId, weight]) => ({ assetId, weight })),
      evaluatedTargets, referenceTargets, risk: { peak, priorObserved, stopped }, fills: transition.fills, bookBefore, book };
    traces.push(trace); options.onDecision?.(trace);
    equity.push({ t: index - options.startIndex, value: researchBookValue(book, marks).toNumber() });
  }
  const total = fee.add(spread).add(slip).add(impact);
  return { equity, metrics: metricsFrom(equity), traces, coverage, overlap,
    costs: { totalCostUsd: total.toNumber(), turnoverUsd: turnover.toNumber(), costPctOfStart: total.div(equity[0]!.value).mul(100).toNumber(), events },
    componentCosts: { fee: fee.toFixed(), spread: spread.toFixed(), slippage: slip.toFixed(), impact: impact.toFixed() } };
}
