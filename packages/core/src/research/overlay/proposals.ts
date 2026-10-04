import { Decimal } from 'decimal.js';
import { rebalanceResearchBook, researchBookValue, type ResearchBook } from '../../backtest/integrity-book.js';
import type { TradeCostConfig } from '../../costs/index.js';
import type { InstrumentKey } from '../../types/index.js';
import type { LiquidityObservation, OverlayCandidate } from './types.js';
export function actionScore(book: ResearchBook, prices: ReadonlyMap<InstrumentKey, number>, weights: ReadonlyMap<InstrumentKey, number>,
  prediction: readonly number[], assets: readonly InstrumentKey[], costs: TradeCostConfig) {
  const transition = rebalanceResearchBook(book, prices, weights, costs), equity = researchBookValue(book, prices);
  const gross = assets.reduce((value, asset, i) => value.add(new Decimal(transition.book.units.get(asset) ?? 0)
    .sub(book.units.get(asset) ?? 0).mul(prices.get(asset)!).mul(prediction[i]!)), new Decimal(0));
  const cost = transition.fills.reduce((sum, fill) => sum.add(fill.totalCost), new Decimal(0));
  return { grossPct: gross.div(equity).mul(100).toNumber(), costPct: cost.div(equity).mul(100).toNumber(),
    score: gross.sub(cost.mul(2)).div(equity).mul(100).toNumber(), transition };
}
export function portfolioVariance(weights: ReadonlyMap<InstrumentKey, number>, histories: ReadonlyMap<InstrumentKey, readonly number[]>): number | null {
  if ([...weights].some(([asset]) => (histories.get(asset)?.length ?? 0) < 31)) return null;
  const mix = Array.from({ length: 30 }, (_, day) => [...weights].reduce((sum, [asset, weight]) => {
    const values = histories.get(asset)!.slice(-31); return sum + weight * (values[day + 1]! / values[day]! - 1);
  }, 0));
  const mean = mix.reduce((s, v) => s + v, 0) / 30;
  return mix.reduce((s, v) => s + (v - mean) ** 2, 0) / 30 * 365;
}
export function boundedTilt(input: { book: ResearchBook; prices: ReadonlyMap<InstrumentKey, number>;
  baseline: ReadonlyMap<InstrumentKey, number>; histories: ReadonlyMap<InstrumentKey, readonly number[]>;
  prediction: readonly number[]; assets: readonly InstrumentKey[]; candidate: OverlayCandidate; costs: TradeCostConfig;
  liquidity: readonly LiquidityObservation[]; observedThroughMs: number; decisionAtMs: number }) {
  const { baseline, book, prices, candidate, assets, prediction, costs } = input;
  const reference = actionScore(book, prices, baseline, prediction, assets, costs), equity = researchBookValue(book, prices);
  const baseVariance = portfolioVariance(baseline, input.histories);
  let best = { weights: new Map(baseline), score: 0, grossPct: 0, costPct: 0, changed: false, reason: 'no_incremental_tilt' };
  const eligible = [...baseline].filter(([, weight]) => weight > 0).map(([asset]) => asset).sort();
  if (baseVariance === null || eligible.length < 2) return { ...best, reason: 'tilt_inputs_unavailable' };
  const volumes = verifiedOverlayLiquidity(input.liquidity, input.observedThroughMs, input.decisionAtMs);
  if (eligible.some((asset) => !volumes.has(asset))) return { ...best, reason: 'liquidity_unavailable' };
  for (const donor of eligible) for (const receiver of eligible) if (donor !== receiver) {
    for (const shift of [0.025, 0.05]) {
      if (shift > candidate.maxDeviation || baseline.get(donor)! < shift) continue;
      const weights = new Map(baseline); weights.set(donor, weights.get(donor)! - shift); weights.set(receiver, weights.get(receiver)! + shift);
      if ([...weights.values()].some((weight) => weight > 0.45 + 1e-12) || portfolioVariance(weights, input.histories)! > baseVariance + 1e-12) continue;
      const totalTurnover = assets.reduce((s, asset) => s + Math.abs((weights.get(asset) ?? 0) - new Decimal(book.units.get(asset) ?? 0).mul(prices.get(asset)!).div(equity).toNumber()), 0);
      if (totalTurnover > 0.35 + 1e-12) continue;
      const proposed = actionScore(book, prices, weights, prediction, assets, costs);
      if (proposed.transition.fills.length > 8 || proposed.transition.fills.some((fill) =>
        new Decimal(fill.referenceNotional).gt(new Decimal(volumes.get(fill.assetId) ?? 0).mul(0.001)))) continue;
      // Cost the added redistribution independently, rather than treating saved baseline costs as free edge.
      const redistribution = rebalanceResearchBook(reference.transition.book, prices, weights, costs);
      const addedCost = redistribution.fills.reduce((sum, fill) => sum.add(fill.totalCost), new Decimal(0));
      const grossPct = proposed.grossPct - reference.grossPct, costPct = addedCost.div(equity).mul(100).toNumber();
      const score = grossPct - 2 * costPct;
      if (Number.isFinite(score) && score > best.score + 1e-12) best = { weights, score, grossPct, costPct, changed: true, reason: 'bounded_tilt' };
    }
  }
  return best;
}

export function verifiedOverlayLiquidity(rows: readonly LiquidityObservation[], observedThroughMs: number, decisionAtMs: number) {
  return new Map(rows.filter((row) => row.volumeUnit === 'USD' &&
    /^[a-f0-9]{64}$/u.test(row.sourceHash) && Number.isSafeInteger(row.availableAtMs) &&
    Number.isSafeInteger(row.observedThroughMs) && row.observedThroughMs === observedThroughMs && row.observedThroughMs <= row.availableAtMs &&
    row.availableAtMs <= decisionAtMs && row.observedThroughMs >= decisionAtMs - 2 * 86_400_000 &&
    typeof row.usdVolume === 'string' && /^\d+(?:\.\d+)?$/u.test(row.usdVolume) && new Decimal(row.usdVolume).isFinite() && new Decimal(row.usdVolume).isPositive()).map((row) => [row.assetId, row.usdVolume]));
}
