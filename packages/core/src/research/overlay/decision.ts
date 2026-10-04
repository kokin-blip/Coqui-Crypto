import { DEFAULT_RISK_CONTROL_PROFILE } from '../../risk/risk-controls.js';
import { Decimal } from 'decimal.js';
import { researchBookValue, type ResearchBook } from '../../backtest/integrity-book.js';
import type { InstrumentKey } from '../../types/index.js';
import type { TradeCostConfig } from '../../costs/index.js';
import { momentumTargetsAt } from '../../strategies/momentum.js';
import { volTargetExposureAt } from '../../strategies/vol-target.js';
import { composeTrendVolTargets } from '../../strategies/trend-vol.js';
import { sourceCompletionDelayMs, type DecisionMarketDataset } from '../../market/index.js';
import { validateDecisionDataset } from '../../backtest/execution-timing.js';
import { dailyOverlayFeatures, scheduledOverlay } from './features.js';
import { ruleParticipation } from './rules.js';
import { actionScore, boundedTilt, portfolioVariance, verifiedOverlayLiquidity } from './proposals.js';
import { predictOverlayModel } from './models.js';
import { calibratedProbability } from './calibration.js';
import { validateOverlayArtifact } from './artifacts.js';
import type { OverlayCandidate, OverlayStudyPlan, OverlayArtifact, LiquidityObservation } from './types.js';
export interface OverlayRiskState { readonly peak: number; readonly priorObserved: number; readonly stopped: boolean }
export function constrainedOverlayTargets(book: ResearchBook, prices: ReadonlyMap<InstrumentKey, number>,
  desired: ReadonlyMap<InstrumentKey, number>, histories: ReadonlyMap<InstrumentKey, readonly number[]>) {
  let weights = new Map(desired), capped = false;
  const variance = portfolioVariance(weights, histories);
  if (variance !== null && variance > 0.4 ** 2) { const scale = 0.4 / Math.sqrt(variance); weights = new Map([...weights].map(([a, w]) => [a, w * scale])); capped = true; }
  const equity = researchBookValue(book, prices);
  const current = new Map([...prices].map(([asset, price]) => [asset, new Decimal(book.units.get(asset) ?? 0).mul(price).div(equity).toNumber()]));
  const turnover = [...prices.keys()].reduce((sum, asset) => sum + Math.abs((weights.get(asset) ?? 0) - (current.get(asset) ?? 0)), 0);
  const fraction = turnover > 0.35 + 1e-12 ? 0.35 / turnover : 1;
  if (fraction < 1) { weights = new Map([...prices.keys()].map((asset) => [asset, (current.get(asset) ?? 0) + fraction * ((weights.get(asset) ?? 0) - (current.get(asset) ?? 0))])); capped = true; }
  const changedAssets = [...prices.keys()].filter((asset) => Math.abs((weights.get(asset) ?? 0) - (current.get(asset) ?? 0)) > 1e-10).length;
  const refused = changedAssets > 8 || [...weights.values()].some((w) => !Number.isFinite(w) || w < 0 || w > 0.45 + 1e-12) || [...weights.values()].reduce((s, w) => s + w, 0) > 1 + 1e-12;
  return { weights, capped, refused };
}
/** Live/shadow decision context contains completed observations only, never a future fill price. */
export function decideOverlayShadow(input: { dataset: DecisionMarketDataset; plan: OverlayStudyPlan; candidate: OverlayCandidate;
  book: ResearchBook; decisionAtMs: number; executionAtMs: number; costs: TradeCostConfig;
  artifact?: OverlayArtifact | null; liquidity?: readonly LiquidityObservation[]; risk: OverlayRiskState }) {
  const { dataset, plan, candidate, book } = input; validateDecisionDataset(dataset);
  const last = dataset.barsById[dataset.assets[0]!]!.at(-1)!;
  const availability = Math.max(...dataset.assets.map((asset) => { const bar = dataset.barsById[asset]!.at(-1)!; return bar.endTimeMs + sourceCompletionDelayMs(bar.source); }));
  if (input.decisionAtMs - availability > DEFAULT_RISK_CONTROL_PROFILE.staleDataTimeoutMs || dataset.generatedAtMs > input.decisionAtMs || input.decisionAtMs - last.endTimeMs > 2 * 86_400_000 || availability > input.decisionAtMs || input.executionAtMs <= input.decisionAtMs || JSON.stringify(dataset.assets) !== JSON.stringify(plan.universe.assets)) throw new Error('shadow_noncausal_frame');
  const history = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]!]));
  const prices = new Map([...history].map(([asset, rows]) => [asset, rows.at(-1)!]));
  const observed = researchBookValue(book, prices).toNumber(), peak = Math.max(input.risk.peak, observed);
  const stopped = input.risk.stopped || observed / peak <= 0.92 || (input.risk.priorObserved > 0 && observed / input.risk.priorObserved <= 0.98);
  const risk = { peak, priorObserved: observed, stopped };
  const arm = plan.arms.find((a) => a.cadence === candidate.cadence)!;
  const scheduled = scheduledOverlay(input.executionAtMs, arm);
  const base = plan.execution.baseTargets.map((t) => ({ ...t, assetId: t.assetId as InstrumentKey })), end = dataset.dayKeys.length;
  const mix = Array.from({ length: end }, (_, day) => base.reduce((s, t) => s + t.weight * history.get(t.assetId)![day]! / history.get(t.assetId)![0]!, 0));
  const target = composeTrendVolTargets(base, momentumTargetsAt(base, history, end, plan.baseline.momentum),
    volTargetExposureAt(mix, end, plan.baseline.volatility), 1, end, plan.baseline.momentum, plan.baseline.volatility);
  let weights = constrainedOverlayTargets(book, prices, new Map(target.targets.map((t) => [t.assetId, t.weight])), history).weights;
  const baselineTargets = [...weights].map(([assetId, weight]) => ({ assetId, weight }));
  let reason = 'baseline', probability: number | null = null, prediction: number[] | null = null, fallback = false;
  let act = scheduled && target.historyStatus === 'complete' && end >= plan.execution.warmupBars;
  const gate = ruleParticipation(candidate, mix, plan.baseline.volatility.targetVolPct); let permitted = gate.permitted;
  if (!act) reason = scheduled ? 'insufficient_history' : 'not_scheduled';
  else if (candidate.model !== 'none') {
    const features = dailyOverlayFeatures([...history.values()]);
    if (!input.artifact || !features) { fallback = true; reason = 'model_unavailable_baseline_fallback'; }
    else {
      validateOverlayArtifact(input.artifact, plan, candidate, input.costs);
      if (input.artifact.calibrationWindow.endExclusiveMs > input.decisionAtMs) throw new Error('shadow_future_artifact');
      prediction = predictOverlayModel(input.artifact.model, features);
      if (candidate.gate === 'ml') {
        const score = actionScore(book, prices, weights, prediction, dataset.assets, input.costs);
        if (!input.artifact.participation) { fallback = true; reason = 'calibration_unavailable_baseline_fallback'; }
        else { probability = calibratedProbability(input.artifact.participation, score.score); permitted = probability >= candidate.probabilityThreshold && score.score > 0; reason = permitted ? 'ml_permitted' : 'ml_rejected'; }
      }
      if (permitted && candidate.tilt) {
        const tilt = boundedTilt({ book, prices, baseline: weights, histories: history, prediction, assets: dataset.assets,
          candidate, costs: input.costs, liquidity: input.liquidity ?? [], observedThroughMs: last.endTimeMs, decisionAtMs: input.decisionAtMs });
        probability = input.artifact.tilt ? calibratedProbability(input.artifact.tilt, tilt.score) : null;
        if (tilt.changed && probability !== null && probability >= candidate.probabilityThreshold) { weights = tilt.weights; reason = 'bounded_tilt'; }
        else { fallback = true; reason = tilt.reason; }
      }
    }
  }
  if (act && !permitted) { act = candidate.abstention === 'cash_exit'; weights = new Map(); reason = gate.reason === 'no_gate' ? reason : gate.reason; }
  if (stopped) { act = true; weights = new Map(); reason = 'hard_safety_stop'; }
  const constrained = stopped ? { weights, refused: false, capped: false } : constrainedOverlayTargets(book, prices, weights, history);
  if (constrained.refused) { act = false; reason = 'position_risk_refusal'; }
  return { observedThroughMs: last.endTimeMs, availableAtMs: availability, decisionAtMs: input.decisionAtMs,
    executionAtMs: input.executionAtMs, scheduled, act, reason, permitted, fallback, probability, prediction,
    baselineTargets, liquidityCaps: [...verifiedOverlayLiquidity(input.liquidity ?? [], last.endTimeMs, input.decisionAtMs)].map(([assetId, volume]) => ({ assetId, maxUsd: new Decimal(volume).mul(0.001).toFixed() })),
    targets: [...constrained.weights].map(([assetId, weight]) => ({ assetId, weight })), risk,
    qualified: false as const, observedEquity: observed };
}
