import { Decimal } from 'decimal.js';
import {
  decimal,
  instrumentKey,
  type AcquisitionSource,
  type AssetQuantity,
  type CostBasisMethod,
  type DecimalString,
  type Disposal,
  type InstrumentIdentity,
  type TaxLot,
} from '../types/index.js';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

export interface DisposalResult {
  /** Realized disposals split by holding-period class. */
  disposals: Disposal[];
  /** Open lots after explicit consumption; fully consumed lots are dropped. */
  updatedLots: TaxLot[];
  /** Units not covered because the open lots were exhausted. */
  shortfall: AssetQuantity;
}

/** Reverse an explicit disposal without inventing quantity or cost basis. */
export function lotFromReversedDisposal(disposal: Disposal, newId: string): TaxLot {
  return {
    id: newId,
    asset: disposal.asset,
    quantity: disposal.quantity,
    remaining: disposal.quantity,
    costUsd: disposal.costBasisUsd,
    acquiredAt: disposal.longTerm
      ? disposal.disposedAt - ONE_YEAR_MS - ONE_DAY_MS
      : disposal.disposedAt,
    source: 'manual',
    externalId: null,
  };
}

function costPerUnit(lot: TaxLot): Decimal {
  const quantity = new Decimal(lot.quantity);
  return quantity.gt(0) ? new Decimal(lot.costUsd).div(quantity) : new Decimal(0);
}

function orderLots(lots: readonly TaxLot[], method: CostBasisMethod): TaxLot[] {
  const copy = [...lots];
  switch (method) {
    case 'lifo':
      return copy.sort((left, right) => right.acquiredAt - left.acquiredAt);
    case 'hifo':
      return copy.sort((left, right) => costPerUnit(right).cmp(costPerUnit(left)));
    case 'fifo':
    case 'average':
      return copy.sort((left, right) => left.acquiredAt - right.acquiredAt);
  }
}

interface DisposalBucket {
  quantity: Decimal;
  cost: Decimal;
}

/**
 * Dispose an exact quantity against canonically matching open lots.
 * Proceeds are net of fees and are allocated pro-rata across holding periods.
 */
export function disposeLots(
  openLots: readonly TaxLot[],
  instrument: InstrumentIdentity,
  quantity: AssetQuantity,
  proceedsUsd: DecimalString,
  method: CostBasisMethod,
  disposedAt: number,
  source: AcquisitionSource = 'manual',
): DisposalResult {
  const target = instrumentKey(instrument);
  const others = openLots.filter((lot) => instrumentKey(lot.asset.instrument) !== target);
  const mine = openLots.filter(
    (lot) => instrumentKey(lot.asset.instrument) === target && new Decimal(lot.remaining).gt(0),
  );
  const requested = Decimal.max(0, new Decimal(quantity));

  if (requested.isZero() || mine.length === 0) {
    return {
      disposals: [],
      updatedLots: openLots.filter((lot) => new Decimal(lot.remaining).gt(0)),
      shortfall: decimal(mine.length === 0 ? requested.toFixed() : '0'),
    };
  }

  const asset = mine[0]!.asset;
  const ordered = orderLots(mine, method);
  const pooledQuantity = mine.reduce(
    (sum, lot) => sum.add(lot.remaining),
    new Decimal(0),
  );
  const pooledCost = mine.reduce(
    (sum, lot) => sum.add(new Decimal(lot.remaining).mul(costPerUnit(lot))),
    new Decimal(0),
  );
  const averageUnitCost = pooledQuantity.gt(0)
    ? pooledCost.div(pooledQuantity)
    : new Decimal(0);
  const buckets: Record<'short' | 'long', DisposalBucket> = {
    short: { quantity: new Decimal(0), cost: new Decimal(0) },
    long: { quantity: new Decimal(0), cost: new Decimal(0) },
  };
  const consumed = new Map<string, Decimal>();

  let remainingToSell = requested;
  for (const lot of ordered) {
    if (remainingToSell.lte(0)) break;
    const taken = Decimal.min(lot.remaining, remainingToSell);
    if (taken.lte(0)) continue;
    const unitCost = method === 'average' ? averageUnitCost : costPerUnit(lot);
    const bucket = disposedAt - lot.acquiredAt > ONE_YEAR_MS ? buckets.long : buckets.short;
    bucket.quantity = bucket.quantity.add(taken);
    bucket.cost = bucket.cost.add(taken.mul(unitCost));
    consumed.set(lot.id, taken);
    remainingToSell = remainingToSell.sub(taken);
  }

  const totalConsumed = requested.sub(remainingToSell);
  const proceeds = new Decimal(proceedsUsd);
  const disposals: Disposal[] = [];
  for (const [term, bucket] of [
    ['short', buckets.short],
    ['long', buckets.long],
  ] as const) {
    if (bucket.quantity.lte(0)) continue;
    const allocatedProceeds = totalConsumed.gt(0)
      ? proceeds.mul(bucket.quantity).div(totalConsumed)
      : new Decimal(0);
    disposals.push({
      id: `${target}-${disposedAt}-${term}`,
      asset,
      quantity: decimal(bucket.quantity.toFixed()),
      proceedsUsd: decimal(allocatedProceeds.toFixed()),
      costBasisUsd: decimal(bucket.cost.toFixed()),
      realizedPnlUsd: decimal(allocatedProceeds.sub(bucket.cost).toFixed()),
      longTerm: term === 'long',
      disposedAt,
      method,
      source,
    });
  }

  const updatedMine = mine
    .map((lot) => {
      const taken = consumed.get(lot.id) ?? new Decimal(0);
      return taken.gt(0)
        ? { ...lot, remaining: decimal(new Decimal(lot.remaining).sub(taken).toFixed()) }
        : lot;
    })
    .filter((lot) => new Decimal(lot.remaining).gt(0));

  return {
    disposals,
    updatedLots: [...others, ...updatedMine],
    shortfall: decimal(Decimal.max(0, remainingToSell).toFixed()),
  };
}
