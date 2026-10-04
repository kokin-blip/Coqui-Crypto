import { Decimal as DecimalBase } from 'decimal.js';
const Decimal = DecimalBase.clone({ precision: 40 });
import { modeledFill, type ModeledFill } from '../paper/modeled-fill.js';
import { tradeCostConfigHash, type TradeCostConfig } from '../costs/index.js';
import type { InstrumentKey } from '../types/index.js';

export interface ResearchBook { readonly cash: string; readonly units: ReadonlyMap<InstrumentKey, string> }
export interface ResearchFill extends ModeledFill { readonly assetId: InstrumentKey; readonly side: 'buy' | 'sell' }
export interface BookTransition { readonly book: ResearchBook; readonly fills: readonly ResearchFill[] }
export function researchBookValue(book: ResearchBook, prices: ReadonlyMap<InstrumentKey, number>): DecimalBase {
  let value = new Decimal(book.cash);
  for (const [asset, quantity] of book.units) {
    const price = prices.get(asset);
    if (price === undefined || !Number.isFinite(price) || price <= 0) throw new TypeError('Missing valuation price');
    value = value.add(new Decimal(quantity).mul(price));
  }
  return value;
}

/** Self financing, sell first, fees reserved; never reconstruct positions from post-cost equity. */
export function rebalanceResearchBook(book: ResearchBook, prices: ReadonlyMap<InstrumentKey, number>,
  weights: ReadonlyMap<InstrumentKey, number>, costs: TradeCostConfig): BookTransition {
  tradeCostConfigHash(costs);
  if (!new Decimal(book.cash).isFinite() || new Decimal(book.cash).isNegative() ||
      [...book.units.values()].some((q) => !new Decimal(q).isFinite() || new Decimal(q).isNegative()) ||
      prices.size === 0 || [...prices.values()].some((p) => !Number.isFinite(p) || p <= 0) ||
      [...weights].some(([asset, w]) => !prices.has(asset) || !Number.isFinite(w) || w < 0) ||
      [...weights.values()].reduce((a, b) => a + b, 0) > 1 + 1e-12) throw new TypeError('Invalid research book targets');
  const equity = researchBookValue(book, prices);
  const units = new Map(book.units);
  let cash = new Decimal(book.cash);
  const fills: ResearchFill[] = [];
  const orders = [...prices].sort(([a], [b]) => a.localeCompare(b)).map(([asset, price]) => {
    const held = new Decimal(units.get(asset) ?? 0);
    return { asset, price, held, delta: equity.mul(weights.get(asset) ?? 0).div(price).sub(held) };
  }).sort((a, b) => a.delta.cmp(b.delta) || a.asset.localeCompare(b.asset));
  for (const order of orders) {
    if (order.delta.abs().mul(order.price).lte('0.00000001')) continue;
    const side = order.delta.isPositive() ? 'buy' : 'sell';
    let quantity = order.delta.abs();
    if (side === 'buy') {
      const upper = Decimal.min(quantity, cash.div(order.price));
      if (!upper.isPositive()) continue;
      // Fixed bisection also handles size-dependent impact and fee rounding.
      let low = new Decimal(0), high = upper;
      if (new Decimal(modeledFill('buy', upper.toFixed(), String(order.price), costs).cashChange).neg().lte(cash)) low = upper;
      for (let step = 0; low.lt(high) && step < 80; step += 1) {
        const trial = low.add(high).div(2);
        const required = new Decimal(modeledFill('buy', trial.toFixed(), String(order.price), costs).cashChange).neg();
        if (required.lte(cash)) low = trial; else high = trial;
      }
      quantity = low.toDecimalPlaces(16, Decimal.ROUND_DOWN);
    } else quantity = Decimal.min(quantity, order.held);
    if (quantity.mul(order.price).lte('0.00000001')) continue;
    const fill = modeledFill(side, quantity.toFixed(), String(order.price), costs);
    cash = cash.add(fill.cashChange);
    units.set(order.asset, order.held.add(side === 'buy' ? quantity : quantity.neg()).toFixed());
    fills.push(Object.freeze({ ...fill, assetId: order.asset, side }));
  }
  if (cash.isNegative()) throw new Error('Research cash conservation failure');
  return Object.freeze({ book: { cash: cash.toFixed(), units }, fills: Object.freeze(fills) });
}
