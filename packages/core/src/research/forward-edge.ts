import { Decimal } from 'decimal.js';

import { sha256Hex } from '../crypto/sha256.js';
import { deflatedSharpeForTrials, mean, moments, stddev } from '../significance/index.js';
import { benchmarkRelativeConfidence } from './benchmark-confidence.js';

export const FORWARD_EDGE_TRIAL_UPPER_BOUND = 215 as const;

export interface ForwardEdgeStudyPlan {
  readonly formatVersion: 1;
  readonly strategyId: string;
  readonly universe: readonly ['BTC-USD', 'ETH-USD', 'LTC-USD'];
  readonly observation: 'completed_daily_forward_only';
  readonly registeredAtMs: number;
  readonly firstEligibleDayUtcMs: number;
  readonly minimumCompletedDays: 365;
  readonly minimumCostBearingRebalances: 30;
  readonly trialUpperBound: 215;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly noParameterSearch: true;
  readonly noHistoricalBackfill: true;
}

export interface ForwardEdgeEvent {
  readonly atMs: number;
  readonly turnoverUsd: string;
  readonly actualEndingEquityUsd: string;
  readonly noTradeEndingEquityUsd: string;
  readonly recordedCostUsd: string;
  readonly valuationComplete: boolean;
  readonly stateHash: string;
}

export interface ForwardEdgeEventScore {
  readonly grossEdgePct: string;
  readonly costPct: string;
  readonly netEdgePct: string;
}

export interface ForwardCounterfactualInput {
  readonly preDecisionBalances: readonly { readonly assetId: string; readonly quantity: string }[];
  readonly valuedPositions: readonly {
    readonly productId: string; readonly quantity: string; readonly valueUsd: string | null;
  }[];
  readonly fills: readonly {
    readonly notionalUsd: string; readonly venueFeeUsd: string; readonly spreadUsd: string;
    readonly slippageUsd: string; readonly impactUsd: string;
  }[];
}

export interface ForwardCounterfactualResult {
  readonly noTradeEndingEquityUsd: string | null;
  readonly turnoverUsd: string;
  readonly recordedCostUsd: string;
}

function canonicalDecimal(value: Decimal): string {
  return value.toDecimalPlaces(16, Decimal.ROUND_HALF_UP).toFixed().replace(/\.0+$/u, '')
    .replace(/(\.\d*?)0+$/u, '$1');
}

/** Value the exact pre-decision paper balances on the post-decision valuation basis. */
export function deriveForwardCounterfactual(
  input: ForwardCounterfactualInput,
): ForwardCounterfactualResult {
  const prices = new Map<string, Decimal>();
  for (const position of input.valuedPositions) {
    if (position.valueUsd === null) continue;
    const quantity = new Decimal(position.quantity);
    if (!quantity.isZero()) prices.set(position.productId, new Decimal(position.valueUsd).div(quantity));
  }
  let noTrade = new Decimal(0);
  let complete = true;
  for (const balance of input.preDecisionBalances) {
    const quantity = new Decimal(balance.quantity);
    if (balance.assetId === 'USD') noTrade = noTrade.add(quantity);
    else if (!quantity.isZero()) {
      const productId = balance.assetId.split('|')[2];
      const price = productId === undefined ? undefined : prices.get(productId);
      if (price === undefined) complete = false;
      else noTrade = noTrade.add(quantity.mul(price));
    }
  }
  const totals = input.fills.reduce((value, fill) => ({
    turnover: value.turnover.add(fill.notionalUsd),
    costs: value.costs.add(fill.venueFeeUsd).add(fill.spreadUsd)
      .add(fill.slippageUsd).add(fill.impactUsd),
  }), { turnover: new Decimal(0), costs: new Decimal(0) });
  return Object.freeze({
    noTradeEndingEquityUsd: complete ? canonicalDecimal(noTrade) : null,
    turnoverUsd: canonicalDecimal(totals.turnover),
    recordedCostUsd: canonicalDecimal(totals.costs),
  });
}

export interface ForwardEdgeStudyResult {
  readonly planHash: string;
  readonly completedDays: number;
  readonly costBearingRebalances: number;
  readonly completeValuations: boolean;
  readonly grossEdgeLowerConfidenceBoundPct: number | null;
  readonly netEdgeLowerConfidenceBoundPct: number | null;
  readonly excessVsHoldPct: number | null;
  readonly excessVsPassivePct: number | null;
  readonly deflatedSharpeProbability: number | null;
  readonly maximumDrawdownPct: number | null;
  readonly sourceHashes: readonly string[];
  readonly outcome: 'incomplete' | 'passed' | 'failed';
}

export interface ProfitabilityEstimateEvidence {
  readonly grossEdgeLowerBoundPct: number;
  readonly resultHash: string;
  readonly sourceHashes: readonly string[];
  readonly integrityVerified: true;
}

export interface ForwardEdgeObservationInput {
  readonly dayUtc: number;
  readonly actualEquityUsd: string | null;
  readonly holdEquityUsd: string | null;
  readonly noTradeEquityUsd: string | null;
  readonly turnoverUsd: string;
  readonly recordedCostUsd: string;
  readonly marketPrices: Readonly<Record<string, string | null>>;
  readonly valuationComplete: boolean;
  readonly evidenceHash: string;
}

export function canonicalForwardEdgePlan(plan: ForwardEdgeStudyPlan): string {
  return JSON.stringify({
    formatVersion: plan.formatVersion, strategyId: plan.strategyId, universe: plan.universe,
    observation: plan.observation, registeredAtMs: plan.registeredAtMs,
    firstEligibleDayUtcMs: plan.firstEligibleDayUtcMs,
    minimumCompletedDays: plan.minimumCompletedDays,
    minimumCostBearingRebalances: plan.minimumCostBearingRebalances,
    trialUpperBound: plan.trialUpperBound, costProfileHash: plan.costProfileHash,
    codeRevision: plan.codeRevision, noParameterSearch: plan.noParameterSearch,
    noHistoricalBackfill: plan.noHistoricalBackfill,
  });
}

export function hashForwardEdgePlan(plan: ForwardEdgeStudyPlan): string {
  return sha256Hex(canonicalForwardEdgePlan(plan));
}

/** Score one next-interval replay. Recorded costs are subtracted exactly once. */
export function scoreForwardEdgeEvent(event: ForwardEdgeEvent): ForwardEdgeEventScore | null {
  if (!event.valuationComplete) return null;
  const turnover = new Decimal(event.turnoverUsd);
  if (!turnover.isPositive()) return null;
  const grossPnl = new Decimal(event.actualEndingEquityUsd)
    .plus(event.recordedCostUsd)
    .minus(event.noTradeEndingEquityUsd);
  const costPct = new Decimal(event.recordedCostUsd).div(turnover).mul(100);
  const grossEdgePct = grossPnl.div(turnover).mul(100);
  return Object.freeze({
    grossEdgePct: grossEdgePct.toString(),
    costPct: costPct.toString(),
    netEdgePct: grossEdgePct.minus(costPct).toString(),
  });
}

/** Fixed bootstrap configuration makes the confirmatory interval reproducible. */
export function forwardEdgeLowerConfidenceBoundPct(
  netEdgePct: readonly number[],
  seed: number,
): number | null {
  const confidence = benchmarkRelativeConfidence(
    netEdgePct.map((value) => value / 100),
    netEdgePct.map(() => 0),
    { resamples: 2_000, meanBlockLength: 7, confidenceLevel: 0.95, seed },
  );
  return confidence.lowerMeanDailyExcess === null ? null : confidence.lowerMeanDailyExcess * 100;
}

export function forwardEdgeDeflatedSharpeProbability(
  dailyReturns: readonly number[],
  observedTrialSharpes: readonly number[],
): number | null {
  const deviation = stddev([...dailyReturns]);
  if (dailyReturns.length < 2 || deviation === 0) return null;
  const candidateSharpe = mean([...dailyReturns]) / deviation;
  const shape = moments([...dailyReturns]);
  return deflatedSharpeForTrials(candidateSharpe, dailyReturns.length, shape.skew, shape.kurt,
    [...observedTrialSharpes], FORWARD_EDGE_TRIAL_UPPER_BOUND);
}

export function evaluateForwardEdgeResult(
  result: Omit<ForwardEdgeStudyResult, 'outcome'>,
): ForwardEdgeStudyResult {
  const sampleComplete = result.completedDays >= 365 && result.costBearingRebalances >= 30 &&
    result.completeValuations && result.sourceHashes.length > 0;
  const passed = sampleComplete && result.grossEdgeLowerConfidenceBoundPct !== null &&
    result.netEdgeLowerConfidenceBoundPct !== null && result.excessVsHoldPct !== null &&
    result.excessVsPassivePct !== null && result.deflatedSharpeProbability !== null &&
    result.maximumDrawdownPct !== null && result.netEdgeLowerConfidenceBoundPct > 0 &&
    result.excessVsHoldPct! > 0 && result.excessVsPassivePct! > 0 &&
    result.deflatedSharpeProbability! >= 0.95 && result.maximumDrawdownPct! <= 35;
  return Object.freeze({
    ...result,
    outcome: !sampleComplete ? 'incomplete' : passed ? 'passed' : 'failed',
  });
}

function seriesReturnPct(first: string | null, last: string | null): number | null {
  if (first === null || last === null || new Decimal(first).isZero()) return null;
  return new Decimal(last).div(first).minus(1).mul(100).toNumber();
}

/** Materialize only from actually persisted prospective observations. */
export function materializeForwardEdgeResult(input: {
  readonly planHash: string;
  readonly observations: readonly ForwardEdgeObservationInput[];
  readonly observedTrialSharpes: readonly number[];
  readonly bootstrapSeed: number;
}): ForwardEdgeStudyResult {
  const ordered = [...input.observations].sort((left, right) => left.dayUtc - right.dayUtc);
  const complete = ordered.filter((item) => item.valuationComplete);
  const scores = complete.flatMap((item) => {
    const score = scoreForwardEdgeEvent({
      atMs: item.dayUtc, turnoverUsd: item.turnoverUsd,
      actualEndingEquityUsd: item.actualEquityUsd ?? '0',
      noTradeEndingEquityUsd: item.noTradeEquityUsd ?? '0',
      recordedCostUsd: item.recordedCostUsd, valuationComplete: item.valuationComplete,
      stateHash: item.evidenceHash,
    });
    return score === null ? [] : [score];
  });
  const actualReturns: number[] = [];
  for (let index = 1; index < complete.length; index += 1) {
    const prior = complete[index - 1]!.actualEquityUsd;
    const current = complete[index]!.actualEquityUsd;
    const value = seriesReturnPct(prior, current);
    if (value !== null) actualReturns.push(value / 100);
  }
  const first = complete[0] ?? null;
  const last = complete.at(-1) ?? null;
  const actualReturn = seriesReturnPct(first?.actualEquityUsd ?? null, last?.actualEquityUsd ?? null);
  const holdReturn = seriesReturnPct(first?.holdEquityUsd ?? null, last?.holdEquityUsd ?? null);
  const products = ['BTC-USD', 'ETH-USD', 'LTC-USD'] as const;
  const passiveGrowth = first === null || last === null ? null : products.reduce<Decimal | null>(
    (sum, product) => {
      if (sum === null) return null;
      const start = first.marketPrices[product];
      const end = last.marketPrices[product];
      return start === null || start === undefined || end === null || end === undefined ||
        new Decimal(start).isZero() ? null : sum.add(new Decimal(end).div(start).div(3));
    }, new Decimal(0));
  const passiveReturn = passiveGrowth === null ? null : passiveGrowth.minus(1).mul(100).toNumber();
  let peak: Decimal | null = null;
  let maximumDrawdownPct: number | null = complete.length === 0 ? null : 0;
  for (const observation of complete) {
    const equity = new Decimal(observation.actualEquityUsd!);
    if (peak === null || equity.gt(peak)) peak = equity;
    if (peak.isPositive()) {
      const drawdown = peak.minus(equity).div(peak).mul(100).toNumber();
      maximumDrawdownPct = Math.max(maximumDrawdownPct ?? 0, drawdown);
    }
  }
  const gross = scores.map((score) => Number(score.grossEdgePct));
  const net = scores.map((score) => Number(score.netEdgePct));
  return evaluateForwardEdgeResult({
    planHash: input.planHash,
    completedDays: complete.length,
    costBearingRebalances: scores.length,
    completeValuations: complete.length === ordered.length && ordered.length > 0,
    grossEdgeLowerConfidenceBoundPct: forwardEdgeLowerConfidenceBoundPct(gross, input.bootstrapSeed),
    netEdgeLowerConfidenceBoundPct: forwardEdgeLowerConfidenceBoundPct(net, input.bootstrapSeed),
    excessVsHoldPct: actualReturn === null || holdReturn === null ? null : actualReturn - holdReturn,
    excessVsPassivePct: actualReturn === null || passiveReturn === null ? null : actualReturn - passiveReturn,
    deflatedSharpeProbability: forwardEdgeDeflatedSharpeProbability(
      actualReturns,
      input.observedTrialSharpes,
    ),
    maximumDrawdownPct,
    sourceHashes: ordered.map((item) => item.evidenceHash),
  });
}
