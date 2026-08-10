import { Decimal } from 'decimal.js';
import { instrumentKey } from '../types/index.js';
import { decimal, type Allocation, type AllocationPolicy, type AllocationSlice, type Holding } from '../types/index.js';

export function computeAllocation(
  holdings: readonly Holding[],
  asOf: number,
  policy?: AllocationPolicy,
): Allocation {
  const targetById = new Map(policy?.targets.map((target) => [instrumentKey(target.instrument), target.weight]));
  const total = holdings.reduce(
    (sum, holding) => sum.plus(holding.valueUsd ?? 0),
    new Decimal(0),
  );
  const slices: AllocationSlice[] = holdings.map((holding) => {
    const priced = holding.valueUsd !== null;
    const value = new Decimal(holding.valueUsd ?? 0);
    const actualWeight = total.gt(0) ? value.div(total).toNumber() : 0;
    const targetWeight = targetById.get(instrumentKey(holding.asset.instrument)) ?? null;
    const driftPct = targetWeight !== null && priced ? (actualWeight - targetWeight) * 100 : null;
    return {
      asset: holding.asset,
      valueUsd: decimal(value.toFixed()),
      actualWeight,
      targetWeight,
      driftPct,
    };
  });
  return { slices, totalValueUsd: decimal(total.toFixed()), asOf };
}
