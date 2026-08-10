import { Decimal } from 'decimal.js';
import { instrumentKey, type ExecutionIntent } from '../types/index.js';
import type { SkippedAutoTrade } from '../execution/index.js';
import type { ConcreteAutoStrategy, StrategyBacktestResult, TrackResult } from '../backtest/index.js';
import { estimateTradeCost, type TradeCostConfig } from '../costs/index.js';
import {
  DEFAULT_RISK_CONTROL_PROFILE,
  expectedShortfallPct,
  marketQualityFromCosts,
  simulateExecutionPolicy,
  type ExecutionPolicySimulation,
  type MarketQualitySnapshot,
  type RiskControlState,
} from '../risk/index.js';

export type CostProfilePreset = 'conservative' | 'custom';
export type LiquidityPreference = 'taker' | 'maker';
export type StrategyReadinessStatus = 'not_ready' | 'watching' | 'clears_paper_gate';

export interface VenueCostProfile {
  preset: CostProfilePreset;
  makerFeeBps: number;
  takerFeeBps: number;
  spreadBps: number;
  slippageBps: number;
  minUsefulTradeUsd: number;
  profitBufferMultiple: number;
  preferredLiquidity: LiquidityPreference;
}

export interface NetProfitabilityReport {
  strategy: ConcreteAutoStrategy;
  status: StrategyReadinessStatus;
  netReturnPct: number;
  excessVsHoldPct: number;
  excessVsPassivePct: number;
  netEdgeAfterCostsPct: number;
  maxDrawdownPct: number;
  sortino: number | null;
  walkForwardVerdict: StrategyBacktestResult['walkForward']['verdict'];
  dsr: number | null;
  turnoverUsd: number;
  costUsd: number;
  annualCostDragPct: number;
  expectedShortfallPct: number;
  drawdownState: RiskControlState['stage'];
  volatilityShockCount: number;
  executionShortfallUsd: number;
  forwardPaperDays: number;
  forwardPaperDecisions: number;
  forwardPaperFills: number;
  blockedTrades: number;
  summary: string;
}

export interface TradeProfitabilityCheck {
  ok: boolean;
  symbol: string;
  side: 'buy' | 'sell';
  amountUsd: number;
  historicalNetEdgeEstimateUsd: number;
  estimatedCostUsd: number;
  requiredEdgeUsd: number;
  taxDragUsd: number;
  netEdgeUsd: number;
  riskStage: RiskControlState['stage'] | null;
  expectedShortfallPct: number | null;
  executionPolicy: ExecutionPolicySimulation | null;
  executionShortfallUsd: number;
  blockReasons: string[];
  reason: string | null;
}

export interface ProfitabilityGateResult {
  intents: ExecutionIntent[];
  skippedTrades: SkippedAutoTrade[];
  checks: TradeProfitabilityCheck[];
}

export interface ProfitabilityGateOptions {
  asOfMs: number;
  riskState?: RiskControlState | null;
  marketQuality?: MarketQualitySnapshot | null;
}

export const MIN_FORWARD_PAPER_DAYS = 90;
export const MIN_FORWARD_PAPER_DECISIONS = 50;
export const MIN_FORWARD_PAPER_FILLS = 30;

export interface ForwardPaperEvidence {
  days: number;
  decisions: number;
  fills: number;
}

export const DEFAULT_VENUE_COST_PROFILE: VenueCostProfile = {
  preset: 'conservative',
  makerFeeBps: 40,
  takerFeeBps: 60,
  spreadBps: 10,
  slippageBps: 15,
  minUsefulTradeUsd: 25,
  profitBufferMultiple: 2,
  preferredLiquidity: 'taker',
};

const STRATEGIES: ConcreteAutoStrategy[] = ['passive', 'signal', 'momentum', 'voltarget', 'trendvol', 'rotation'];
const ACTIVE: ConcreteAutoStrategy[] = ['signal', 'momentum', 'voltarget', 'trendvol', 'rotation'];

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function resolveVenueCostProfile(profile?: Partial<VenueCostProfile> | null): VenueCostProfile {
  const preset = profile?.preset === 'custom' ? 'custom' : 'conservative';
  const base = DEFAULT_VENUE_COST_PROFILE;
  if (preset === 'conservative') return { ...base };
  return {
    preset,
    makerFeeBps: finiteNumber(profile?.makerFeeBps, base.makerFeeBps, 0, 300),
    takerFeeBps: finiteNumber(profile?.takerFeeBps, base.takerFeeBps, 0, 300),
    spreadBps: finiteNumber(profile?.spreadBps, base.spreadBps, 0, 500),
    slippageBps: finiteNumber(profile?.slippageBps, base.slippageBps, 0, 500),
    minUsefulTradeUsd: finiteNumber(profile?.minUsefulTradeUsd, base.minUsefulTradeUsd, 1, 10_000),
    profitBufferMultiple: finiteNumber(profile?.profitBufferMultiple, base.profitBufferMultiple, 1, 10),
    preferredLiquidity: profile?.preferredLiquidity === 'maker' ? 'maker' : 'taker',
  };
}

export function tradeCostConfigFromVenue(profile?: Partial<VenueCostProfile> | null): TradeCostConfig {
  const resolved = resolveVenueCostProfile(profile);
  return {
    modelVersion: 'coinbase-venue-v2',
    feeBps: resolved.preferredLiquidity === 'maker' ? resolved.makerFeeBps : resolved.takerFeeBps,
    spreadBps: resolved.spreadBps,
    slippageBps: resolved.slippageBps,
    minUsefulTradeUsd: resolved.minUsefulTradeUsd,
  };
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function annualCostDrag(track: TrackResult, days: number): number {
  if (days <= 0) return track.costs.costPctOfStart;
  return track.costs.costPctOfStart * (365 / days);
}

function drawdownStage(maxDrawdownPct: number): RiskControlState['stage'] {
  const p = DEFAULT_RISK_CONTROL_PROFILE;
  if (maxDrawdownPct <= -p.hardStopDrawdownPct) return 'hard_stop';
  if (maxDrawdownPct <= -p.defenseDrawdownPct) return 'defense';
  if (maxDrawdownPct <= -p.cautionDrawdownPct) return 'caution';
  return 'normal';
}

function volatilityShockCount(track: TrackResult): number {
  const returns: number[] = [];
  for (let i = 1; i < track.equity.length; i++) {
    const a = track.equity[i - 1]!.value;
    const b = track.equity[i]!.value;
    if (a > 0 && b > 0) returns.push(b / a - 1);
  }
  if (returns.length < 30) return 0;
  const abs = returns.map((r) => Math.abs(r)).sort((a, b) => a - b);
  const threshold = abs[Math.max(0, Math.floor(abs.length * 0.9) - 1)] ?? 0;
  return returns.filter((r) => Math.abs(r) >= threshold && r < 0).length;
}

function track(bt: StrategyBacktestResult, strategy: ConcreteAutoStrategy): TrackResult {
  return bt[strategy];
}

function reportForStrategy(
  bt: StrategyBacktestResult,
  strategy: ConcreteAutoStrategy,
  evidence: ForwardPaperEvidence,
  blockedTrades = 0,
): NetProfitabilityReport {
  const t = track(bt, strategy);
  const hold = bt.hold.metrics.totalReturnPct;
  const passive = bt.passive.metrics.totalReturnPct;
  const netReturnPct = t.metrics.totalReturnPct;
  const excessVsHoldPct = netReturnPct - hold;
  const excessVsPassivePct = strategy === 'passive' ? 0 : netReturnPct - passive;
  const netEdgeAfterCostsPct = Math.min(excessVsHoldPct, strategy === 'passive' ? excessVsHoldPct : excessVsPassivePct);
  const dsr = bt.significance.leader === strategy ? bt.significance.dsr : null;

  const historicalPass =
    strategy === 'passive'
      ? netReturnPct > 0
      : netReturnPct > 0 &&
        excessVsHoldPct > 0 &&
        excessVsPassivePct > 0 &&
        bt.walkForward.verdict === 'adds_value' &&
        (dsr === null || dsr >= 0.5);

  const status: StrategyReadinessStatus = !historicalPass
    ? 'not_ready'
    : evidence.days >= MIN_FORWARD_PAPER_DAYS &&
        evidence.decisions >= MIN_FORWARD_PAPER_DECISIONS &&
        evidence.fills >= MIN_FORWARD_PAPER_FILLS
      ? 'clears_paper_gate'
      : 'watching';

  const summary =
    status === 'not_ready'
      ? strategy === 'passive'
        ? `Passive is not net-positive in this window (${fmtPct(netReturnPct)} after costs).`
        : `${strategy} stands down: net ${fmtPct(netReturnPct)}, excess vs hold ${fmtPct(excessVsHoldPct)}, vs passive ${fmtPct(excessVsPassivePct)}, walk-forward ${bt.walkForward.verdict}.`
      : status === 'watching'
        ? `${strategy} clears historical cost checks, but needs ${MIN_FORWARD_PAPER_DAYS} observed days, ${MIN_FORWARD_PAPER_DECISIONS} decisions, and ${MIN_FORWARD_PAPER_FILLS} fills (now ${evidence.days}/${evidence.decisions}/${evidence.fills}).`
        : `${strategy} clears the forward paper activity gate (${evidence.days} days, ${evidence.decisions} decisions, ${evidence.fills} fills).`;

  return {
    strategy,
    status,
    netReturnPct,
    excessVsHoldPct,
    excessVsPassivePct,
    netEdgeAfterCostsPct,
    maxDrawdownPct: t.metrics.maxDrawdownPct,
    sortino: t.metrics.sortino,
    walkForwardVerdict: bt.walkForward.verdict,
    dsr,
    turnoverUsd: t.costs.turnoverUsd,
    costUsd: t.costs.totalCostUsd,
    annualCostDragPct: annualCostDrag(t, bt.days),
    expectedShortfallPct: expectedShortfallPct(t.equity.map((p) => p.value)),
    drawdownState: drawdownStage(t.metrics.maxDrawdownPct),
    volatilityShockCount: volatilityShockCount(t),
    executionShortfallUsd: t.costs.totalCostUsd,
    forwardPaperDays: evidence.days,
    forwardPaperDecisions: evidence.decisions,
    forwardPaperFills: evidence.fills,
    blockedTrades,
    summary,
  };
}

export function buildNetProfitabilityReports(
  bt: StrategyBacktestResult,
  forwardPaper: number | ForwardPaperEvidence,
  blockedTradesByStrategy: Partial<Record<ConcreteAutoStrategy, number>> = {},
): Record<ConcreteAutoStrategy, NetProfitabilityReport> {
  const evidence: ForwardPaperEvidence =
    typeof forwardPaper === 'number'
      ? { days: forwardPaper, decisions: 0, fills: 0 }
      : forwardPaper;
  return Object.fromEntries(
    STRATEGIES.map((strategy) => [
      strategy,
      reportForStrategy(bt, strategy, evidence, blockedTradesByStrategy[strategy] ?? 0),
    ]),
  ) as Record<ConcreteAutoStrategy, NetProfitabilityReport>;
}

export function bestActiveReadiness(
  reports: Record<ConcreteAutoStrategy, NetProfitabilityReport>,
): NetProfitabilityReport | null {
  const eligible = ACTIVE.map((s) => reports[s]).filter((r) => r.status !== 'not_ready');
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (b.netEdgeAfterCostsPct > a.netEdgeAfterCostsPct ? b : a));
}

export function checkTradeProfitability(
  intent: ExecutionIntent,
  profile: VenueCostProfile,
  historicalNetEdgeEstimatePct: number,
  options: ProfitabilityGateOptions,
  taxDragUsd = 0,
): TradeProfitabilityCheck {
  const estimate = estimateTradeCost(intent, tradeCostConfigFromVenue(profile));
  const marketQuality = options.marketQuality ?? marketQualityFromCosts({
    asOf: options.asOfMs,
    spreadBps: profile.spreadBps,
    slippageBps: profile.slippageBps,
  });
  const executionPolicy = simulateExecutionPolicy(
    intent,
    tradeCostConfigFromVenue(profile),
    marketQuality,
    DEFAULT_RISK_CONTROL_PROFILE,
  );
  const amountUsd = Decimal.max(0, new Decimal(intent.amountUsd));
  const historicalNetEdgeEstimateUsd = amountUsd
    .mul(Math.max(0, historicalNetEdgeEstimatePct))
    .div(100)
    .toNumber();
  const taxPenaltyUsd = Math.max(0, taxDragUsd);
  const estimatedCostUsd = Math.max(estimate.totalCostUsd, executionPolicy.estimatedCostUsd);
  const requiredEdgeUsd = (estimatedCostUsd + taxPenaltyUsd) * profile.profitBufferMultiple;
  const netEdgeUsd = historicalNetEdgeEstimateUsd - estimatedCostUsd - taxDragUsd;
  const availableEdgeUsd = historicalNetEdgeEstimateUsd - taxDragUsd;
  const blockReasons: string[] = [];
  if (options.riskState?.blockReason) blockReasons.push(options.riskState.blockReason);
  if (executionPolicy.reason) blockReasons.push(executionPolicy.reason);
  if (availableEdgeUsd < requiredEdgeUsd) {
    blockReasons.push(
      intent.side === 'sell' && taxPenaltyUsd > 0
        ? `blocked by tax drag: historical net-edge estimate $${historicalNetEdgeEstimateUsd.toFixed(2)} is below ${profile.profitBufferMultiple.toFixed(1)}x costs + taxes ($${requiredEdgeUsd.toFixed(2)})`
        : `historical net-edge estimate $${historicalNetEdgeEstimateUsd.toFixed(2)} is below ${profile.profitBufferMultiple.toFixed(1)}x estimated cost buffer ($${requiredEdgeUsd.toFixed(2)})`,
    );
  }
  const ok = blockReasons.length === 0;

  let reason: string | null = null;
  if (!ok) {
    reason = blockReasons[0] ?? 'blocked by profitability gate';
  }

  return {
    ok,
    symbol: intent.asset.symbol,
    side: intent.side,
    amountUsd: amountUsd.toNumber(),
    historicalNetEdgeEstimateUsd,
    estimatedCostUsd,
    requiredEdgeUsd,
    taxDragUsd,
    netEdgeUsd,
    riskStage: options.riskState?.stage ?? null,
    expectedShortfallPct: options.riskState?.expectedShortfallPct ?? null,
    executionPolicy,
    executionShortfallUsd: executionPolicy.implementationShortfallUsd,
    blockReasons,
    reason,
  };
}

export function applyProfitabilityGate(
  intents: ExecutionIntent[],
  profile: VenueCostProfile,
  historicalNetEdgeEstimatePct: number,
  options: ProfitabilityGateOptions,
  taxDragUsdForIntent: (intent: ExecutionIntent) => number = () => 0,
): ProfitabilityGateResult {
  const kept: ExecutionIntent[] = [];
  const skippedTrades: SkippedAutoTrade[] = [];
  const checks: TradeProfitabilityCheck[] = [];

  for (const intent of intents) {
    const check = checkTradeProfitability(
      intent,
      profile,
      historicalNetEdgeEstimatePct,
      options,
      taxDragUsdForIntent(intent),
    );
    checks.push(check);
    if (check.ok) {
      kept.push(intent);
    } else {
      skippedTrades.push({
        assetId: instrumentKey(intent.asset.instrument),
        symbol: intent.asset.symbol,
        side: intent.side,
        amountUsd: new Decimal(intent.amountUsd).toNumber(),
        reason: check.reason ?? 'blocked by profitability gate',
      });
    }
  }

  return { intents: kept, skippedTrades, checks };
}
