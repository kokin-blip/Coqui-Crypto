import { Decimal } from 'decimal.js';
import { freezeUniverse } from './wider-universe.js';
import type { UniversePortfolio } from './wider-universe-replay.js';

export interface SelectorPendingOrder {
  readonly id: string; readonly assetId: string; readonly side: 'buy' | 'sell';
  readonly quantity: string; readonly cumulativeFilled: string;
  readonly modeledPrice: string; readonly feeRate: string;
}
export interface SelectorVirtualBook {
  readonly portfolio: UniversePortfolio; readonly pending: readonly SelectorPendingOrder[];
}

/** Cumulative virtual fills are idempotent; remaining quantity blocks conflicting replans. */
export function reconcileSelectorVirtualFill(book: SelectorVirtualBook, orderId: string,
  cumulativeFilled: string): SelectorVirtualBook {
  const order = book.pending.find((item) => item.id === orderId);
  if (!order || book.pending.filter((item) => item.id === orderId).length !== 1) throw new Error('unknown_virtual_order');
  const filled = new Decimal(cumulativeFilled), previous = new Decimal(order.cumulativeFilled);
  const total = new Decimal(order.quantity), price = new Decimal(order.modeledPrice), feeRate = new Decimal(order.feeRate);
  if (![filled, previous, total, price, feeRate].every((v) => v.isFinite()) ||
      previous.isNegative() || filled.lt(previous) || filled.gt(total) || !price.gt(0) ||
      feeRate.isNegative() || feeRate.gte(1)) throw new Error('invalid_virtual_fill');
  const delta = filled.minus(previous), notional = delta.mul(price);
  const cash = new Decimal(book.portfolio.cash);
  const held = new Decimal(book.portfolio.quantities[order.assetId] ?? 0);
  const nextCash = order.side === 'buy' ? cash.minus(notional) : cash.plus(notional.mul(new Decimal(1).minus(feeRate)));
  const nextHeld = order.side === 'buy' ? held.plus(delta.mul(new Decimal(1).minus(feeRate))) : held.minus(delta);
  if (nextCash.isNegative() || nextHeld.isNegative()) throw new Error('virtual_fill_overdraw');
  const pending = book.pending.map((item) => item.id === orderId ?
    { ...item, cumulativeFilled: filled.toFixed() } : item).filter((item) =>
      new Decimal(item.cumulativeFilled).lt(item.quantity));
  return freezeUniverse({ portfolio: { cash: nextCash.toFixed(),
    quantities: { ...book.portfolio.quantities, [order.assetId]: nextHeld.toFixed() } }, pending });
}
