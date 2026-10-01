import { Decimal } from 'decimal.js';
import { EXECUTION_COST_MODELS, type PlannedExecutionIntent } from './remediation-planner.js';

export interface MatchedBook {
  readonly cash: string; readonly quantities: Readonly<Record<string, string>>;
  readonly applied: Readonly<Record<string, { quantity: string; notional: string; fee: string }>>;
  readonly pending: readonly string[];
}
export function openingMatchedBook(): MatchedBook {
  return { cash: '100000', quantities: {}, applied: {}, pending: [] };
}
/** Cumulative modeled fills: retries are idempotent and never manufacture an actual broker fill. */
export function applyModeledFill(book: MatchedBook, intent: PlannedExecutionIntent, evidence: {
  readonly cumulativeQuantity: string; readonly cumulativeNotional: string;
  readonly cumulativeFee: string; readonly final: boolean;
}): MatchedBook {
  const prior = book.applied[intent.id] ?? { quantity: '0', notional: '0', fee: '0' };
  const quantity = new Decimal(evidence.cumulativeQuantity), notional = new Decimal(evidence.cumulativeNotional);
  const fee = new Decimal(evidence.cumulativeFee);
  if ([quantity, notional, fee].some((value) => !value.isFinite() || value.lt(0)) || quantity.gt(intent.quantity) ||
      quantity.lt(prior.quantity) || notional.lt(prior.notional) || fee.lt(prior.fee)) throw new Error('invalid_cumulative_fill');
  const deltaQty = quantity.minus(prior.quantity), deltaNotional = notional.minus(prior.notional), deltaFee = fee.minus(prior.fee);
  const held = new Decimal(book.quantities[intent.assetId] ?? '0');
  const cash = new Decimal(book.cash).plus(intent.side === 'sell' ? deltaNotional.minus(deltaFee) : deltaNotional.neg());
  const next = intent.side === 'buy' ? held.plus(deltaQty).minus(deltaFee) : held.minus(deltaQty);
  if (cash.lt(0) || next.lt(0)) throw new Error('fill_exceeds_book');
  return { cash: cash.toString(), quantities: { ...book.quantities, [intent.assetId]: next.toString() },
    applied: { ...book.applied, [intent.id]: { quantity: quantity.toString(), notional: notional.toString(), fee: fee.toString() } },
    pending: evidence.final ? book.pending.filter((id) => id !== intent.assetId) : [...new Set([...book.pending, intent.assetId])] };
}
export function modelMarketFill(book: MatchedBook, intent: PlannedExecutionIntent, quote: {bid: string; ask: string}, multiplier = 1): MatchedBook {
  if (multiplier !== 1 && multiplier !== 2) throw new Error('undeclared_cost_scenario');
  const mid = new Decimal(quote.bid).plus(quote.ask).div(2), half = new Decimal(quote.ask).minus(quote.bid).div(2);
  const friction = half.plus(mid.mul(EXECUTION_COST_MODELS.alpacaShadow.slippage)).mul(multiplier);
  const price = intent.side === 'buy' ? mid.plus(friction) : mid.minus(friction);
  if (price.lte(0)) throw new Error('invalid_modeled_fill_price');
  const qty = new Decimal(intent.quantity), notional = qty.mul(price);
  const fee = intent.side === 'buy' ? qty.mul(EXECUTION_COST_MODELS.alpacaShadow.fee).mul(multiplier)
    : notional.mul(EXECUTION_COST_MODELS.alpacaShadow.fee).mul(multiplier);
  return applyModeledFill(book, intent, { cumulativeQuantity: qty.toString(), cumulativeNotional: notional.toString(),
    cumulativeFee: fee.toString(), final: true });
}
