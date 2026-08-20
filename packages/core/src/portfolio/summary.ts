import { Decimal } from 'decimal.js';
import {
  decimal,
  type DecimalString,
  type Holding,
  type InstrumentKey,
  type UsdAmount,
} from '../types/index.js';

/** Exact valuation totals with explicit priced-book coverage. */
export interface PortfolioValuationSummary {
  /** Market value of priced holdings only. */
  readonly totalValueUsd: UsdAmount;
  /** Open cost basis for every holding, including holdings without a price. */
  readonly totalCostUsd: UsdAmount;
  /** Open cost basis for the priced subset used by unrealized P&L. */
  readonly pricedCostUsd: UsdAmount;
  /** Unrealized P&L for priced holdings only. */
  readonly totalUnrealizedPnlUsd: DecimalString;
  /** Priced-book unrealized return; null when the priced cost basis is zero. */
  readonly totalUnrealizedPnlPct: number | null;
  readonly pricedCount: number;
  readonly unpricedCount: number;
}

export function summarizePortfolioValuation(
  holdings: readonly Holding[],
): PortfolioValuationSummary {
  let totalValue = new Decimal(0);
  let totalCost = new Decimal(0);
  let pricedCost = new Decimal(0);
  let unrealized = new Decimal(0);
  let pricedCount = 0;

  for (const holding of holdings) {
    const cost = new Decimal(holding.quantity).mul(holding.avgCostUsd);
    totalCost = totalCost.plus(cost);
    if (holding.valueUsd === null) continue;

    pricedCount += 1;
    totalValue = totalValue.plus(holding.valueUsd);
    pricedCost = pricedCost.plus(cost);
    if (holding.unrealizedPnlUsd !== null) {
      unrealized = unrealized.plus(holding.unrealizedPnlUsd);
    }
  }

  return {
    totalValueUsd: decimal(totalValue.toFixed()),
    totalCostUsd: decimal(totalCost.toFixed()),
    pricedCostUsd: decimal(pricedCost.toFixed()),
    totalUnrealizedPnlUsd: decimal(unrealized.toFixed()),
    totalUnrealizedPnlPct: pricedCost.gt(0)
      ? unrealized.div(pricedCost).mul(100).toNumber()
      : null,
    pricedCount,
    unpricedCount: holdings.length - pricedCount,
  };
}

export interface PaperValuationBalance {
  readonly assetId: 'USD' | InstrumentKey;
  readonly quantity: string;
}

export interface PaperBalanceValuationSummary {
  readonly cashUsd: UsdAmount;
  readonly pricedAssetValueUsd: UsdAmount;
  /** Complete paper equity only; null when any non-cash balance is unpriced. */
  readonly completeValueUsd: UsdAmount | null;
  readonly pricedAssetCount: number;
  readonly unpricedAssetCount: number;
  readonly unpricedInstruments: readonly InstrumentKey[];
}

/** Exact paper-balance valuation without inventing prices for missing instruments. */
export function summarizePaperBalanceValuation(
  balances: readonly PaperValuationBalance[],
  prices: Readonly<Partial<Record<InstrumentKey, UsdAmount>>>,
): PaperBalanceValuationSummary {
  let cash = new Decimal(0);
  let pricedAssets = new Decimal(0);
  let pricedAssetCount = 0;
  const unpriced: InstrumentKey[] = [];
  for (const balance of balances) {
    const quantity = new Decimal(balance.quantity);
    if (!quantity.isFinite() || quantity.isNegative()) {
      throw new TypeError('Paper balances must be finite non-negative decimals.');
    }
    if (balance.assetId === 'USD') {
      cash = cash.plus(quantity);
      continue;
    }
    const price = prices[balance.assetId];
    if (price === undefined) {
      unpriced.push(balance.assetId);
      continue;
    }
    const exactPrice = new Decimal(price);
    if (!exactPrice.isFinite() || exactPrice.isNegative()) {
      throw new TypeError('Paper prices must be finite non-negative decimals.');
    }
    pricedAssets = pricedAssets.plus(quantity.mul(exactPrice));
    pricedAssetCount += 1;
  }
  const cashUsd = decimal(cash.toFixed());
  const pricedAssetValueUsd = decimal(pricedAssets.toFixed());
  return {
    cashUsd,
    pricedAssetValueUsd,
    completeValueUsd: unpriced.length === 0
      ? decimal(cash.plus(pricedAssets).toFixed())
      : null,
    pricedAssetCount,
    unpricedAssetCount: unpriced.length,
    unpricedInstruments: Object.freeze([...unpriced].sort()),
  };
}

/** Sum exact USD values without exposing Decimal outside pure core. */
export function sumUsdAmounts(values: readonly UsdAmount[]): UsdAmount {
  return decimal(values.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed());
}
