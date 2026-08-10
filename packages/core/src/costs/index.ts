import { Decimal } from 'decimal.js';
import { sha256Hex } from '../crypto/sha256.js';
import { instrumentKey, type InstrumentIdentity, type UsdAmount } from '../types/index.js';

/**
 * Cost-aware execution estimates.
 *
 * This is deliberately conservative and pure: it does not know the venue's exact
 * order book or the user's current fee tier. The point is to keep paper
 * auto-trade and rebalance previews honest about friction before any live
 * execution path exists.
 */

export interface CostableTrade {
  asset?: { instrument?: InstrumentIdentity; id?: string; symbol: string };
  assetId?: string;
  symbol?: string;
  side: 'buy' | 'sell';
  amountUsd: number | UsdAmount;
}

export interface TradeCostConfig {
  /** Stable identifier persisted in research manifests and reports. */
  modelVersion?: string;
  /** Exchange fee in basis points. */
  feeBps: number;
  /** Expected spread cost in basis points. */
  spreadBps: number;
  /** Extra execution/slippage buffer in basis points. */
  slippageBps: number;
  /** Small moves below this are flagged as easy to overtrade. */
  minUsefulTradeUsd: number;
  /**
   * Size-dependent market impact, as a square-root law: a trade of `impactRefUsd`
   * adds `impactCoefBps`, and impact grows ∝ √(amountUsd / impactRefUsd). This is
   * what makes cost% RISE with trade size (fee/spread/slippage above are flat %).
   * Omitted/0 → impact off, so the backtest cost model is unchanged; the guardrail
   * path (`GUARD_TRADE_COST_CONFIG`) turns it on to bias pessimistic on large
   * orders (CLAUDE.md §6).
   */
  impactCoefBps?: number;
  /** Reference notional (USD) at which impact ≈ `impactCoefBps`. Default 25k. */
  impactRefUsd?: number;
}

export interface TradeCostEstimate {
  assetId: string;
  symbol: string;
  side: 'buy' | 'sell';
  amountUsd: number;
  feeUsd: number;
  spreadUsd: number;
  slippageUsd: number;
  impactUsd: number;
  totalCostUsd: number;
  totalCostPct: number;
  warning: string | null;
}

export interface PlanCostEstimate {
  trades: TradeCostEstimate[];
  turnoverUsd: number;
  totalCostUsd: number;
  costPctOfTurnover: number;
  warnings: string[];
}

export const DEFAULT_TRADE_COST_CONFIG: TradeCostConfig = {
  modelVersion: 'coinbase-conservative-v2',
  // Conservative blended assumption for Coinbase-style crypto execution.
  feeBps: 60,
  spreadBps: 10,
  slippageBps: 15,
  minUsefulTradeUsd: 25,
  // Impact OFF by default → the backtest/scoreboard cost model is unchanged.
  impactCoefBps: 0,
  impactRefUsd: 25_000,
};

/**
 * Cost model for the auto-trade GUARDRAIL check only. Same base friction, but with
 * size-dependent impact ON so `maxTradeCostPct` actually bites large orders — a
 * pessimistic protective check, separate from the frozen backtest cost model.
 * At the $25k reference an order adds 60bps of impact; a $100k order adds ~120bps.
 */
export const GUARD_TRADE_COST_CONFIG: TradeCostConfig = {
  ...DEFAULT_TRADE_COST_CONFIG,
  impactCoefBps: 60,
};

/** Stable research-manifest identity for one fully specified friction profile. */
export function tradeCostConfigHash(config: TradeCostConfig): string {
  const values = [
    config.feeBps, config.spreadBps, config.slippageBps, config.minUsefulTradeUsd,
    config.impactCoefBps ?? 0, config.impactRefUsd ?? 25_000,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Trade-cost profiles require finite non-negative values');
  }
  return sha256Hex(JSON.stringify({
    modelVersion: config.modelVersion ?? null,
    feeBps: config.feeBps,
    spreadBps: config.spreadBps,
    slippageBps: config.slippageBps,
    minUsefulTradeUsd: config.minUsefulTradeUsd,
    impactCoefBps: config.impactCoefBps ?? 0,
    impactRefUsd: config.impactRefUsd ?? 25_000,
  }));
}

function nonNegativeAmount(amountUsd: number | UsdAmount): Decimal {
  const amount = new Decimal(amountUsd);
  return Decimal.max(0, amount);
}

function bpsToUsd(amountUsd: Decimal, bps: number): number {
  return Decimal.max(0, amountUsd).mul(Math.max(0, bps)).div(10_000).toNumber();
}

/** Square-root market-impact in bps for a trade of `amountUsd`. 0 when disabled. */
function impactBps(amountUsd: Decimal, config: TradeCostConfig): number {
  const coef = Math.max(0, config.impactCoefBps ?? 0);
  if (coef === 0) return 0;
  const ref = config.impactRefUsd && config.impactRefUsd > 0 ? config.impactRefUsd : 25_000;
  return Decimal.max(0, amountUsd).div(ref).sqrt().mul(coef).toNumber();
}

export function totalTradeCostBps(config: TradeCostConfig = DEFAULT_TRADE_COST_CONFIG): number {
  return Math.max(0, config.feeBps) + Math.max(0, config.spreadBps) + Math.max(0, config.slippageBps);
}

export function estimateTurnoverCostUsd(
  turnoverUsd: number,
  config: TradeCostConfig = DEFAULT_TRADE_COST_CONFIG,
): number {
  return bpsToUsd(new Decimal(turnoverUsd), totalTradeCostBps(config));
}

function tradeIdentity(trade: CostableTrade): { assetId: string; symbol: string } {
  return {
    assetId:
      (trade.asset?.instrument ? instrumentKey(trade.asset.instrument) : trade.asset?.id) ??
      trade.assetId ??
      trade.symbol ??
      'unknown',
    symbol: trade.asset?.symbol ?? trade.symbol ?? trade.assetId ?? 'UNKNOWN',
  };
}

export function estimateTradeCost(
  trade: CostableTrade,
  config: TradeCostConfig = DEFAULT_TRADE_COST_CONFIG,
): TradeCostEstimate {
  const amount = nonNegativeAmount(trade.amountUsd);
  const amountUsd = amount.toNumber();
  const feeUsd = bpsToUsd(amount, config.feeBps);
  const spreadUsd = bpsToUsd(amount, config.spreadBps);
  const slippageUsd = bpsToUsd(amount, config.slippageBps);
  const impactUsd = bpsToUsd(amount, impactBps(amount, config));
  const totalCostUsd = feeUsd + spreadUsd + slippageUsd + impactUsd;
  const totalCostPct = amount.gt(0) ? new Decimal(totalCostUsd).div(amount).mul(100).toNumber() : 0;
  const { assetId, symbol } = tradeIdentity(trade);
  const warning =
    amountUsd > 0 && amountUsd < config.minUsefulTradeUsd
      ? `${symbol} move is below the $${config.minUsefulTradeUsd.toFixed(0)} useful-trade floor`
      : null;

  return {
    assetId,
    symbol,
    side: trade.side,
    amountUsd,
    feeUsd,
    spreadUsd,
    slippageUsd,
    impactUsd,
    totalCostUsd,
    totalCostPct,
    warning,
  };
}

export function estimatePlanCosts(
  trades: CostableTrade[],
  config: TradeCostConfig = DEFAULT_TRADE_COST_CONFIG,
): PlanCostEstimate {
  const estimates = trades.map((trade) => estimateTradeCost(trade, config));
  const turnoverUsd = estimates.reduce((sum, trade) => sum + trade.amountUsd, 0);
  const totalCostUsd = estimates.reduce((sum, trade) => sum + trade.totalCostUsd, 0);
  const costPctOfTurnover = turnoverUsd > 0 ? (totalCostUsd / turnoverUsd) * 100 : 0;

  return {
    trades: estimates,
    turnoverUsd,
    totalCostUsd,
    costPctOfTurnover,
    warnings: estimates.flatMap((trade) => (trade.warning ? [trade.warning] : [])),
  };
}
