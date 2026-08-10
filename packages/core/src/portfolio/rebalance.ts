import { Decimal } from 'decimal.js';
import {
  decimal,
  instrumentKey,
  type AllocationPolicy,
  type Holding,
  type RebalancePlan,
  type RebalanceTrade,
} from '../types/index.js';

export function computeRebalancePlan(
  holdings: readonly Holding[],
  policy: AllocationPolicy,
  asOf: number,
): RebalancePlan {
  const targetById = new Map(policy.targets.map((target) => [instrumentKey(target.instrument), target.weight]));
  const total = holdings.reduce(
    (sum, holding) => sum.plus(holding.valueUsd ?? 0),
    new Decimal(0),
  );
  const trades: RebalanceTrade[] = [];
  let maxDriftPct = 0;

  if (total.gt(0)) {
    for (const holding of holdings) {
      const target = targetById.get(instrumentKey(holding.asset.instrument));
      if (target === undefined || holding.valueUsd === null) continue;
      const value = new Decimal(holding.valueUsd);
      const actualWeight = value.div(total).toNumber();
      const driftPct = (actualWeight - target) * 100;
      if (Math.abs(driftPct) < policy.rebalanceBandPct) continue;
      maxDriftPct = Math.max(maxDriftPct, Math.abs(driftPct));

      const delta = total.mul(target).minus(value);
      const side = delta.gt(0) ? 'buy' : 'sell';
      const amount = delta.abs();
      const price = holding.priceUsd === null ? new Decimal(0) : new Decimal(holding.priceUsd);
      const quantity = price.gt(0) ? amount.div(price) : new Decimal(0);
      const label = side === 'buy' ? 'underweight' : 'overweight';
      const reason = `${label} ${driftPct >= 0 ? '+' : ''}${driftPct.toFixed(1)}pp vs ${(target * 100).toFixed(0)}% target`;
      trades.push({
        asset: holding.asset,
        side,
        amountUsd: decimal(amount.toFixed()),
        estimatedQty: decimal(quantity.toFixed()),
        reason,
      });
    }
  }

  const turnover = trades.reduce(
    (sum, trade) => sum.plus(trade.amountUsd),
    new Decimal(0),
  );
  return {
    trades,
    turnoverUsd: decimal(turnover.toFixed()),
    maxDriftPct,
    asOf,
    estimateOnly: true,
  };
}
