import { Decimal } from 'decimal.js';
import {
  decimal,
  instrumentKey,
  type Holding,
  type InstrumentKey,
  type TaxLot,
  type UsdAmount,
} from '../types/index.js';

function unitCost(lot: TaxLot): Decimal {
  const quantity = new Decimal(lot.quantity);
  return quantity.gt(0) ? new Decimal(lot.costUsd).div(quantity) : new Decimal(0);
}

export function holdingsFromLots(
  openLots: readonly TaxLot[],
  priceById: Partial<Record<InstrumentKey, UsdAmount>>,
): Holding[] {
  const byAsset = new Map<InstrumentKey, TaxLot[]>();
  for (const lot of openLots) {
    if (new Decimal(lot.remaining).lte(0)) continue;
    const key = instrumentKey(lot.asset.instrument);
    const lots = byAsset.get(key) ?? [];
    lots.push(lot);
    byAsset.set(key, lots);
  }

  const holdings: Holding[] = [];
  for (const [key, lots] of byAsset) {
    const asset = lots[0]!.asset;
    const quantity = lots.reduce((sum, lot) => sum.plus(lot.remaining), new Decimal(0));
    const openCost = lots.reduce(
      (sum, lot) => sum.plus(new Decimal(lot.remaining).mul(unitCost(lot))),
      new Decimal(0),
    );
    const averageCost = quantity.gt(0) ? openCost.div(quantity) : new Decimal(0);
    const rawPrice = priceById[key];
    const price = rawPrice === undefined ? null : new Decimal(rawPrice);
    const value = price?.mul(quantity) ?? null;
    const unrealized = value?.minus(openCost) ?? null;
    const unrealizedPct = unrealized !== null && openCost.gt(0)
      ? unrealized.div(openCost).mul(100).toNumber()
      : null;
    holdings.push({
      asset,
      quantity: decimal(quantity.toFixed()),
      avgCostUsd: decimal(averageCost.toFixed()),
      priceUsd: price === null ? null : decimal(price.toFixed()),
      valueUsd: value === null ? null : decimal(value.toFixed()),
      unrealizedPnlUsd: unrealized === null ? null : decimal(unrealized.toFixed()),
      unrealizedPnlPct: unrealizedPct,
    });
  }

  holdings.sort((left, right) => {
    if (left.valueUsd === null) return right.valueUsd === null ? 0 : 1;
    if (right.valueUsd === null) return -1;
    return new Decimal(right.valueUsd).cmp(left.valueUsd);
  });
  return holdings;
}
