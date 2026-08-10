import { Decimal } from 'decimal.js';
import {
  decimal,
  instrumentKey,
  type AssetQuantity,
  type AssetRef,
  type DecimalString,
  type InstrumentKey,
  type TaxLot,
  type UsdAmount,
} from '../types/index.js';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

function unitCost(lot: TaxLot): Decimal {
  const quantity = new Decimal(lot.quantity);
  return quantity.gt(0) ? new Decimal(lot.costUsd).div(quantity) : new Decimal(0);
}

export interface HarvestOpportunity {
  asset: AssetRef;
  quantity: AssetQuantity;
  costBasisUsd: UsdAmount;
  marketValueUsd: UsdAmount;
  /** Negative amount that could be realized by selling the losing lots. */
  unrealizedLossUsd: DecimalString;
  longTermLossUsd: DecimalString;
  shortTermLossUsd: DecimalString;
}

export interface HarvestSummary {
  /** Per-instrument opportunities, largest loss first. */
  opportunities: HarvestOpportunity[];
  totalHarvestableLossUsd: DecimalString;
  totalLongTermLossUsd: DecimalString;
  totalShortTermLossUsd: DecimalString;
}

interface HarvestAccumulator {
  asset: AssetRef;
  quantity: Decimal;
  cost: Decimal;
  value: Decimal;
  longLoss: Decimal;
  shortLoss: Decimal;
}

/** Find losing open lots using canonical prices and exact decimal arithmetic. */
export function harvestOpportunities(
  openLots: readonly TaxLot[],
  priceByInstrument: ReadonlyMap<InstrumentKey, UsdAmount>,
  now: number,
): HarvestSummary {
  const byInstrument = new Map<InstrumentKey, HarvestAccumulator>();

  for (const lot of openLots) {
    const remaining = new Decimal(lot.remaining);
    if (remaining.lte(0)) continue;
    const key = instrumentKey(lot.asset.instrument);
    const priceString = priceByInstrument.get(key);
    if (priceString === undefined) continue;
    const price = new Decimal(priceString);
    if (!price.isFinite() || price.lt(0)) continue;

    const cost = remaining.mul(unitCost(lot));
    const value = remaining.mul(price);
    const loss = value.sub(cost);
    if (loss.gte(0)) continue;

    const entry = byInstrument.get(key) ?? {
      asset: lot.asset,
      quantity: new Decimal(0),
      cost: new Decimal(0),
      value: new Decimal(0),
      longLoss: new Decimal(0),
      shortLoss: new Decimal(0),
    };
    entry.quantity = entry.quantity.add(remaining);
    entry.cost = entry.cost.add(cost);
    entry.value = entry.value.add(value);
    if (now - lot.acquiredAt > ONE_YEAR_MS) entry.longLoss = entry.longLoss.add(loss);
    else entry.shortLoss = entry.shortLoss.add(loss);
    byInstrument.set(key, entry);
  }

  const opportunities: HarvestOpportunity[] = [...byInstrument.values()]
    .map((entry) => ({
      asset: entry.asset,
      quantity: decimal(entry.quantity.toFixed()),
      costBasisUsd: decimal(entry.cost.toFixed()),
      marketValueUsd: decimal(entry.value.toFixed()),
      unrealizedLossUsd: decimal(entry.value.sub(entry.cost).toFixed()),
      longTermLossUsd: decimal(entry.longLoss.toFixed()),
      shortTermLossUsd: decimal(entry.shortLoss.toFixed()),
    }))
    .sort((left, right) =>
      new Decimal(left.unrealizedLossUsd).cmp(right.unrealizedLossUsd),
    );

  const sum = (field: keyof Pick<
    HarvestOpportunity,
    'unrealizedLossUsd' | 'longTermLossUsd' | 'shortTermLossUsd'
  >): DecimalString =>
    decimal(
      opportunities
        .reduce((total, opportunity) => total.add(opportunity[field]), new Decimal(0))
        .toFixed(),
    );

  return {
    opportunities,
    totalHarvestableLossUsd: sum('unrealizedLossUsd'),
    totalLongTermLossUsd: sum('longTermLossUsd'),
    totalShortTermLossUsd: sum('shortTermLossUsd'),
  };
}
