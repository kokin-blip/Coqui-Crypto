import { Decimal } from 'decimal.js';
import {
  DEFAULT_TRADE_COST_CONFIG,
  GUARD_TRADE_COST_CONFIG,
  estimatePlanCosts,
  estimateTradeCost,
  type PlanCostEstimate,
} from '../costs/index.js';
import { instrumentKey, decimal, type AllocationPolicy, type ExecutionIntent, type Holding, type InstrumentKey } from '../types/index.js';
import { computeRebalancePlan, isStablecoin } from '../portfolio/index.js';
import type { SkippedAutoTrade } from '../execution/index.js';

export interface AutoTradeGuardrails {
  minTradeUsd: number;
  maxTurnoverPct: number;
  maxTradeCostPct: number;
  maxTrades: number;
  maxTradeUsd?: number;
  maxPositionPct?: number;
  maxTotalAtRiskPct?: number;
  blockReason?: string;
}

export interface GuardedAutoRebalance {
  intents: ExecutionIntent[];
  skippedTrades: SkippedAutoTrade[];
  warnings: string[];
  turnoverUsd: number;
  portfolioValueUsd: number;
  costEstimate: PlanCostEstimate;
}

export const DEFAULT_AUTO_TRADE_GUARDRAILS: AutoTradeGuardrails = {
  minTradeUsd: DEFAULT_TRADE_COST_CONFIG.minUsefulTradeUsd,
  maxTurnoverPct: 0.35,
  maxTradeCostPct: 1.25,
  maxTrades: 8,
};

export function planAutoRebalance(
  holdings: readonly Holding[],
  policy: AllocationPolicy,
  now: number,
): ExecutionIntent[] {
  return computeRebalancePlan(holdings, policy, now).trades.map((trade) => ({
    asset: trade.asset,
    side: trade.side,
    amountUsd: trade.amountUsd,
    origin: 'rebalance',
    reason: trade.reason,
    urgency: 'passive',
  }));
}

function portfolioValue(holdings: readonly Holding[]): Decimal {
  return holdings.reduce(
    (sum, holding) => sum.plus(Decimal.max(0, holding.valueUsd ?? 0)),
    new Decimal(0),
  );
}

function atRiskValue(holdings: readonly Holding[]): Decimal {
  return holdings.reduce(
    (sum, holding) =>
      isStablecoin(holding.asset) ? sum : sum.plus(Decimal.max(0, holding.valueUsd ?? 0)),
    new Decimal(0),
  );
}

function valueByAsset(holdings: readonly Holding[]): Map<InstrumentKey, Decimal> {
  return new Map(
    holdings.map((holding) => [
      instrumentKey(holding.asset.instrument),
      Decimal.max(0, holding.valueUsd ?? 0),
    ]),
  );
}

function skip(intent: ExecutionIntent, reason: string): SkippedAutoTrade {
  return {
    assetId: instrumentKey(intent.asset.instrument),
    symbol: intent.asset.symbol,
    side: intent.side,
    amountUsd: new Decimal(intent.amountUsd).toNumber(),
    reason,
  };
}

export function applyAutoTradeGuardrails(
  intents: readonly ExecutionIntent[],
  holdings: readonly Holding[],
  guardrails: AutoTradeGuardrails = DEFAULT_AUTO_TRADE_GUARDRAILS,
): GuardedAutoRebalance {
  const warnings: string[] = [];
  const skippedTrades: SkippedAutoTrade[] = [];
  let kept: ExecutionIntent[] = [];
  const value = portfolioValue(holdings);
  const heldValue = valueByAsset(holdings);

  if (guardrails.blockReason) {
    return {
      intents: [],
      skippedTrades: intents.map((intent) => skip(intent, guardrails.blockReason!)),
      warnings: [`Auto-trade stood down: ${guardrails.blockReason}.`],
      turnoverUsd: 0,
      portfolioValueUsd: value.toNumber(),
      costEstimate: estimatePlanCosts([]),
    };
  }

  for (const raw of intents) {
    const rawAmount = new Decimal(raw.amountUsd);
    const amount = guardrails.maxTradeUsd === undefined
      ? rawAmount
      : Decimal.min(rawAmount, guardrails.maxTradeUsd);
    const intent = amount.eq(rawAmount) ? raw : { ...raw, amountUsd: decimal(amount.toFixed()) };
    if (amount.lt(guardrails.minTradeUsd)) {
      skippedTrades.push(skip(intent, `below $${guardrails.minTradeUsd.toFixed(0)} minimum trade size`));
      continue;
    }
    const costPct = estimateTradeCost(intent, GUARD_TRADE_COST_CONFIG).totalCostPct;
    if (costPct > guardrails.maxTradeCostPct) {
      skippedTrades.push(skip(intent, `estimated cost ${costPct.toFixed(2)}% is too high`));
      continue;
    }
    const assetId = instrumentKey(intent.asset.instrument);
    if (
      intent.side === 'buy' &&
      guardrails.maxPositionPct !== undefined &&
      value.gt(0) &&
      (heldValue.get(assetId) ?? new Decimal(0)).plus(amount).gt(value.mul(guardrails.maxPositionPct))
    ) {
      skippedTrades.push(skip(intent, `would push ${intent.asset.symbol} past the ${(guardrails.maxPositionPct * 100).toFixed(0)}% position cap`));
      continue;
    }
    kept.push(intent);
  }

  if (guardrails.maxTotalAtRiskPct !== undefined && value.gt(0)) {
    const sells = kept.filter((intent) => intent.side === 'sell');
    const buys = kept
      .filter((intent) => intent.side === 'buy')
      .sort((left, right) => new Decimal(right.amountUsd).cmp(left.amountUsd));
    const sellTotal = sells.reduce((sum, intent) => sum.plus(intent.amountUsd), new Decimal(0));
    let headroom = value.mul(guardrails.maxTotalAtRiskPct).minus(atRiskValue(holdings)).plus(sellTotal);
    const admittedBuys: ExecutionIntent[] = [];
    for (const buy of buys) {
      const amount = new Decimal(buy.amountUsd);
      if (amount.lte(headroom)) {
        admittedBuys.push(buy);
        headroom = headroom.minus(amount);
      } else {
        skippedTrades.push(skip(buy, `would exceed the ${(guardrails.maxTotalAtRiskPct * 100).toFixed(0)}% total-at-risk cap`));
      }
    }
    kept = [...sells, ...admittedBuys];
  }

  kept.sort((left, right) => new Decimal(right.amountUsd).cmp(left.amountUsd));
  const sized = kept.slice(0, guardrails.maxTrades);
  for (const extra of kept.slice(guardrails.maxTrades)) {
    skippedTrades.push(skip(extra, `above ${guardrails.maxTrades} trades per run`));
  }

  const guardedCosts = estimatePlanCosts(sized);
  if (value.gt(0) && new Decimal(guardedCosts.turnoverUsd).gt(value.mul(guardrails.maxTurnoverPct))) {
    warnings.push(
      `Auto-trade stood down: ${guardedCosts.costPctOfTurnover.toFixed(2)}% estimated cost and ${new Decimal(guardedCosts.turnoverUsd).div(value).mul(100).toFixed(1)}% turnover exceeds the ${(guardrails.maxTurnoverPct * 100).toFixed(0)}% guardrail.`,
    );
    return {
      intents: [],
      skippedTrades: [
        ...skippedTrades,
        ...sized.map((intent) => skip(intent, `turnover exceeds ${(guardrails.maxTurnoverPct * 100).toFixed(0)}% per run`)),
      ],
      warnings,
      turnoverUsd: 0,
      portfolioValueUsd: value.toNumber(),
      costEstimate: estimatePlanCosts([]),
    };
  }

  if (skippedTrades.length > 0) {
    warnings.push(`${skippedTrades.length} auto-trade move${skippedTrades.length === 1 ? '' : 's'} skipped by guardrails.`);
  }
  return {
    intents: sized,
    skippedTrades,
    warnings,
    turnoverUsd: guardedCosts.turnoverUsd,
    portfolioValueUsd: value.toNumber(),
    costEstimate: guardedCosts,
  };
}
