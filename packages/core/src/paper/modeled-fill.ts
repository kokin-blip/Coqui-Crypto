import { Decimal as DecimalBase } from 'decimal.js';
const Decimal = DecimalBase.clone({ precision: 40 });
import { tradeCostConfigHash, type TradeCostConfig } from '../costs/index.js';

export interface ModeledFill {
  readonly quantity: string;
  readonly referenceNotional: string;
  readonly executionPrice: string;
  readonly notional: string;
  readonly venueFee: string;
  readonly spreadCost: string;
  readonly slippageCost: string;
  readonly impactCost: string;
  readonly totalCost: string;
  readonly cashChange: string;
}

/** Shared reference-notional cost convention; execution friction is charged only in price. */
export function modeledFill(side: 'buy' | 'sell', quantity: string, reference: string,
  config: TradeCostConfig): ModeledFill {
  tradeCostConfigHash(config);
  const qty = new Decimal(quantity), price = new Decimal(reference);
  if (!qty.isFinite() || !qty.isPositive() || !price.isFinite() || !price.isPositive()) {
    throw new TypeError('Invalid modeled fill');
  }
  const amount = qty.mul(price);
  const cost = (bps: number) => amount.mul(bps).div(10_000).toDecimalPlaces(8);
  const fee = cost(config.feeBps), spread = cost(config.spreadBps), slip = cost(config.slippageBps);
  const impact = cost(new Decimal(amount).div(config.impactRefUsd ?? 25_000).sqrt()
    .mul(config.impactCoefBps ?? 0).toNumber());
  const friction = spread.add(slip).add(impact);
  const execution = side === 'buy' ? price.add(friction.div(qty)) : price.sub(friction.div(qty));
  if (!execution.isPositive()) throw new RangeError('Nonpositive modeled execution price');
  const notional = qty.mul(execution);
  return Object.freeze({ quantity: qty.toFixed(), referenceNotional: amount.toFixed(),
    executionPrice: execution.toFixed(), notional: notional.toFixed(), venueFee: fee.toFixed(),
    spreadCost: spread.toFixed(), slippageCost: slip.toFixed(), impactCost: impact.toFixed(),
    totalCost: fee.add(friction).toFixed(), cashChange: (side === 'buy'
      ? notional.add(fee).neg() : notional.sub(fee)).toFixed() });
}
