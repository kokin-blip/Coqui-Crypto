import { Decimal } from 'decimal.js';
import type { ExecutionIntent } from '../types/index.js';
import { estimateTradeCost, type TradeCostConfig } from '../costs/index.js';

export type RiskControlStage = 'normal' | 'caution' | 'defense' | 'hard_stop';
export type ExecutionPolicy = 'maker_first' | 'sliced_twap' | 'market_emergency';
export type StressScenarioKind =
  | 'volatility_cluster'
  | 'heavy_tail_jump'
  | 'spread_slippage_widening'
  | 'stale_data_delay'
  | 'correlation_spike'
  | 'funding_carry_drag';

export interface RiskControlProfile {
  targetVolatilityPct: number;
  maxGrossExposurePct: number;
  maxPositionPct: number;
  maxDailyDrawdownPct: number;
  maxRollingDrawdownPct: number;
  maxExpectedShortfallPct: number;
  maxTurnoverPct: number;
  maxTradeCount: number;
  staleDataTimeoutMs: number;
  slippageBreachBps: number;
  cautionDrawdownPct: number;
  defenseDrawdownPct: number;
  hardStopDrawdownPct: number;
  cautionVolatilityRatio: number;
  defenseVolatilityRatio: number;
}

export interface RiskControlInput {
  equityValues?: number[];
  latestVolatilityPct?: number | null;
  forecastVolatilityPct?: number | null;
  marketDataAgeMs?: number | null;
  currentGrossExposurePct?: number | null;
  profile?: Partial<RiskControlProfile> | null;
}

export interface RiskControlState {
  profile: RiskControlProfile;
  stage: RiskControlStage;
  exposureScale: number;
  maxGrossExposurePct: number;
  maxTurnoverPct: number;
  maxTradeCount: number;
  drawdownPct: number;
  expectedShortfallPct: number;
  realizedVolatilityPct: number | null;
  forecastVolatilityPct: number | null;
  volatilityRatio: number | null;
  staleMarketData: boolean;
  blockReason: string | null;
  warnings: string[];
}

export interface MarketQualitySnapshot {
  asOf: number;
  feedAgeMs: number;
  stale: boolean;
  spreadBps: number;
  slippageBps: number;
  impactBps: number;
  depthUsd: number | null;
  liquidityScore: number;
}

export interface ExecutionPolicySimulation {
  policy: ExecutionPolicy;
  estimatedCostUsd: number;
  estimatedCostBps: number;
  marketableCostUsd: number;
  makerFirstCostUsd: number;
  slicedTwapCostUsd: number;
  implementationShortfallUsd: number;
  blocked: boolean;
  reason: string | null;
}

export interface StressScenarioResult {
  kind: StressScenarioKind;
  status: 'pass' | 'warn' | 'fail';
  returnShockPct: number;
  drawdownShockPct: number;
  costShockUsd: number;
  note: string;
}

export interface VolatilityForecastReport {
  status: 'ok' | 'insufficient_data';
  realizedVolatilityPct: number;
  forecastVolatilityPct: number;
  realizedToForecastRatio: number;
  rmsePct: number;
  rmspe: number;
  missedVolShockCount: number;
  note: string;
}

export interface NaturalMarketLossAudit {
  status: 'pass' | 'warn' | 'fail' | 'insufficient_data';
  volatilityDeciles: { decile: number; sampleDays: number; avgReturnPct: number; lossRatePct: number }[];
  regime: {
    bullDays: number;
    bearDays: number;
    highVolChopDays: number;
    crashDays: number;
    correlationSpikeWindows: number;
  };
  risk: {
    maxDrawdownPct: number;
    expectedShortfallPct: number;
    drawdownState: RiskControlStage;
  };
  execution: {
    turnoverUsd: number;
    costUsd: number;
    annualCostDragPct: number;
    implementationShortfallUsd: number;
  };
  notes: string[];
}

export const DEFAULT_RISK_CONTROL_PROFILE: RiskControlProfile = {
  targetVolatilityPct: 40,
  maxGrossExposurePct: 100,
  maxPositionPct: 45,
  maxDailyDrawdownPct: 2,
  maxRollingDrawdownPct: 8,
  maxExpectedShortfallPct: 3,
  maxTurnoverPct: 35,
  maxTradeCount: 8,
  staleDataTimeoutMs: 2 * 60 * 60_000,
  slippageBreachBps: 125,
  cautionDrawdownPct: 2,
  defenseDrawdownPct: 5,
  hardStopDrawdownPct: 8,
  cautionVolatilityRatio: 1.5,
  defenseVolatilityRatio: 2,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export function resolveRiskControlProfile(profile?: Partial<RiskControlProfile> | null): RiskControlProfile {
  const base = DEFAULT_RISK_CONTROL_PROFILE;
  return {
    targetVolatilityPct: finite(profile?.targetVolatilityPct, base.targetVolatilityPct, 1, 300),
    maxGrossExposurePct: finite(profile?.maxGrossExposurePct, base.maxGrossExposurePct, 0, 100),
    maxPositionPct: finite(profile?.maxPositionPct, base.maxPositionPct, 0, 100),
    maxDailyDrawdownPct: finite(profile?.maxDailyDrawdownPct, base.maxDailyDrawdownPct, 0.1, 100),
    maxRollingDrawdownPct: finite(profile?.maxRollingDrawdownPct, base.maxRollingDrawdownPct, 0.1, 100),
    maxExpectedShortfallPct: finite(profile?.maxExpectedShortfallPct, base.maxExpectedShortfallPct, 0.1, 100),
    maxTurnoverPct: finite(profile?.maxTurnoverPct, base.maxTurnoverPct, 0, 100),
    maxTradeCount: Math.floor(finite(profile?.maxTradeCount, base.maxTradeCount, 0, 100)),
    staleDataTimeoutMs: finite(profile?.staleDataTimeoutMs, base.staleDataTimeoutMs, 1_000, 24 * 60 * 60_000),
    slippageBreachBps: finite(profile?.slippageBreachBps, base.slippageBreachBps, 1, 5_000),
    cautionDrawdownPct: finite(profile?.cautionDrawdownPct, base.cautionDrawdownPct, 0.1, 100),
    defenseDrawdownPct: finite(profile?.defenseDrawdownPct, base.defenseDrawdownPct, 0.1, 100),
    hardStopDrawdownPct: finite(profile?.hardStopDrawdownPct, base.hardStopDrawdownPct, 0.1, 100),
    cautionVolatilityRatio: finite(profile?.cautionVolatilityRatio, base.cautionVolatilityRatio, 1, 20),
    defenseVolatilityRatio: finite(profile?.defenseVolatilityRatio, base.defenseVolatilityRatio, 1, 20),
  };
}

export function returnsFromValues(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const next = values[i]!;
    if (prev > 0 && next > 0) returns.push(next / prev - 1);
  }
  return returns;
}

export function maxDrawdownPct(values: number[]): number {
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    if (!(value > 0)) continue;
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, (value / peak - 1) * 100);
  }
  return drawdown;
}

export function expectedShortfallPct(valuesOrReturns: number[], alpha = 0.95, input: 'values' | 'returns' = 'values'): number {
  const returns = input === 'returns' ? valuesOrReturns : returnsFromValues(valuesOrReturns);
  if (returns.length === 0) return 0;
  const losses = returns.map((r) => -r * 100).filter((loss) => Number.isFinite(loss) && loss > 0).sort((a, b) => b - a);
  if (losses.length === 0) return 0;
  const tailCount = Math.max(1, Math.ceil(losses.length * (1 - alpha)));
  return losses.slice(0, tailCount).reduce((sum, loss) => sum + loss, 0) / tailCount;
}

function realizedVolatilityPct(values: number[]): number | null {
  const returns = returnsFromValues(values);
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(365) * 100;
}

export function resolveRiskControlState(input: RiskControlInput): RiskControlState {
  const profile = resolveRiskControlProfile(input.profile);
  const equity = (input.equityValues ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const drawdownPct = maxDrawdownPct(equity);
  const expectedShortfall = expectedShortfallPct(equity);
  const realizedVol = input.latestVolatilityPct ?? realizedVolatilityPct(equity);
  const forecastVol = input.forecastVolatilityPct ?? profile.targetVolatilityPct;
  const volatilityRatio = realizedVol !== null && forecastVol > 0 ? realizedVol / forecastVol : null;
  const stale = (input.marketDataAgeMs ?? 0) > profile.staleDataTimeoutMs;

  let stage: RiskControlStage = 'normal';
  const warnings: string[] = [];
  if (stale) {
    stage = 'hard_stop';
    warnings.push('market data is stale');
  } else if (drawdownPct <= -profile.hardStopDrawdownPct) {
    stage = 'hard_stop';
    warnings.push(`rolling drawdown ${drawdownPct.toFixed(1)}% breached hard stop`);
  } else if (drawdownPct <= -profile.defenseDrawdownPct || (volatilityRatio !== null && volatilityRatio >= profile.defenseVolatilityRatio)) {
    stage = 'defense';
    warnings.push('defense de-risking active from drawdown or volatility shock');
  } else if (drawdownPct <= -profile.cautionDrawdownPct || (volatilityRatio !== null && volatilityRatio >= profile.cautionVolatilityRatio)) {
    stage = 'caution';
    warnings.push('caution de-risking active from drawdown or volatility shock');
  }
  if (expectedShortfall > profile.maxExpectedShortfallPct) warnings.push(`expected shortfall ${expectedShortfall.toFixed(1)}% exceeds limit`);

  const exposureScale = stage === 'hard_stop' ? 0 : stage === 'defense' ? 0.25 : stage === 'caution' ? 0.5 : 1;
  const blockReason = stage === 'hard_stop' ? warnings[0] ?? 'hard risk stop active' : null;
  return {
    profile,
    stage,
    exposureScale,
    maxGrossExposurePct: profile.maxGrossExposurePct * exposureScale,
    maxTurnoverPct: profile.maxTurnoverPct * exposureScale,
    maxTradeCount: stage === 'hard_stop' ? 0 : Math.max(1, Math.floor(profile.maxTradeCount * exposureScale)),
    drawdownPct,
    expectedShortfallPct: expectedShortfall,
    realizedVolatilityPct: realizedVol,
    forecastVolatilityPct: forecastVol,
    volatilityRatio,
    staleMarketData: stale,
    blockReason,
    warnings,
  };
}

export function marketQualityFromCosts(args: {
  asOf: number;
  feedAgeMs?: number | null;
  spreadBps: number;
  slippageBps: number;
  impactBps?: number;
  depthUsd?: number | null;
  profile?: Partial<RiskControlProfile> | null;
}): MarketQualitySnapshot {
  const profile = resolveRiskControlProfile(args.profile);
  const feedAgeMs = Math.max(0, args.feedAgeMs ?? 0);
  const totalBps = Math.max(0, args.spreadBps) + Math.max(0, args.slippageBps) + Math.max(0, args.impactBps ?? 0);
  const stale = feedAgeMs > profile.staleDataTimeoutMs;
  return {
    asOf: args.asOf,
    feedAgeMs,
    stale,
    spreadBps: Math.max(0, args.spreadBps),
    slippageBps: Math.max(0, args.slippageBps),
    impactBps: Math.max(0, args.impactBps ?? 0),
    depthUsd: args.depthUsd ?? null,
    liquidityScore: clamp(1 - totalBps / profile.slippageBreachBps, 0, 1),
  };
}

export function simulateExecutionPolicy(
  intent: ExecutionIntent,
  costConfig: TradeCostConfig,
  marketQuality: MarketQualitySnapshot,
  profile: RiskControlProfile = DEFAULT_RISK_CONTROL_PROFILE,
): ExecutionPolicySimulation {
  const amountUsd = new Decimal(intent.amountUsd);
  const marketable = estimateTradeCost(intent, {
    ...costConfig,
    spreadBps: marketQuality.spreadBps,
    slippageBps: marketQuality.slippageBps + marketQuality.impactBps,
  });
  const maker = estimateTradeCost(intent, {
    ...costConfig,
    feeBps: Math.max(0, costConfig.feeBps * 0.66),
    spreadBps: Math.max(0, marketQuality.spreadBps * 0.25),
    slippageBps: Math.max(0, marketQuality.slippageBps * 0.35 + marketQuality.impactBps * 0.25),
  });
  const sliced = estimateTradeCost(intent, {
    ...costConfig,
    spreadBps: Math.max(0, marketQuality.spreadBps * 0.6),
    slippageBps: Math.max(0, marketQuality.slippageBps * 0.55 + marketQuality.impactBps * 0.45),
  });
  const largeVsDepth =
    marketQuality.depthUsd !== null &&
    marketQuality.depthUsd > 0 &&
    amountUsd.gt(new Decimal(marketQuality.depthUsd).mul(0.1));
  const policy: ExecutionPolicy =
    intent.urgency === 'fast'
      ? 'market_emergency'
      : largeVsDepth || amountUsd.gte(5_000)
        ? 'sliced_twap'
        : 'maker_first';
  const chosen = policy === 'market_emergency' ? marketable : policy === 'sliced_twap' ? sliced : maker;
  const bps = amountUsd.gt(0)
    ? new Decimal(chosen.totalCostUsd).div(amountUsd).mul(10_000).toNumber()
    : 0;
  const blocked = marketQuality.stale || bps > profile.slippageBreachBps;
  return {
    policy,
    estimatedCostUsd: chosen.totalCostUsd,
    estimatedCostBps: bps,
    marketableCostUsd: marketable.totalCostUsd,
    makerFirstCostUsd: maker.totalCostUsd,
    slicedTwapCostUsd: sliced.totalCostUsd,
    implementationShortfallUsd: Math.max(0, marketable.totalCostUsd - chosen.totalCostUsd),
    blocked,
    reason: marketQuality.stale
      ? 'blocked by stale market data'
      : bps > profile.slippageBreachBps
        ? `blocked by execution shortfall: estimated ${bps.toFixed(0)} bps exceeds ${profile.slippageBreachBps.toFixed(0)} bps`
        : null,
  };
}
