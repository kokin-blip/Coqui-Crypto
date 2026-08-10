import { Decimal } from 'decimal.js';
import {
  DEFAULT_TRADE_COST_CONFIG,
  totalTradeCostBps,
  type TradeCostConfig,
} from '../costs/index.js';
import {
  decimal,
  instrumentKey,
  type AllocationTarget,
  type InstrumentIdentity,
  type InstrumentKey,
  type UsdAmount,
} from '../types/index.js';

export type ContributionCadence = 'weekly' | 'biweekly' | 'monthly';

export const PERIODS_PER_YEAR: Record<ContributionCadence, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
};

export interface ContributionHoldingValue {
  instrument: InstrumentIdentity;
  valueUsd: UsdAmount;
}

export interface ContributionPlanInput {
  budgetUsd: UsdAmount;
  cadence: ContributionCadence;
  targets: readonly AllocationTarget[];
  holdings: readonly ContributionHoldingValue[];
  costs?: TradeCostConfig;
  scenarios?: readonly { label: string; annualReturnPct: number }[];
}

export interface PlannedBuy {
  /** One-based contribution period in which this estimated buy occurs. */
  period: number;
  instrument: InstrumentIdentity;
  amountUsd: UsdAmount;
  estCostUsd: UsdAmount;
  estCostPct: number;
}

export interface ContributionProjection {
  label: string;
  annualReturnPct: number;
  value1yUsd: UsdAmount;
  value3yUsd: UsdAmount;
  value5yUsd: UsdAmount;
}

export interface ContributionPlan {
  budgetUsd: UsdAmount;
  cadence: ContributionCadence;
  periodsPerYear: number;
  batchEveryPeriods: number;
  buyAmountUsd: UsdAmount;
  batchingNote: string;
  upcomingBuys: PlannedBuy[];
  estAnnualCostUsd: UsdAmount;
  estAnnualCostPct: number;
  contributed1yUsd: UsdAmount;
  contributed3yUsd: UsdAmount;
  contributed5yUsd: UsdAmount;
  projections: ContributionProjection[];
}

interface NormalizedTarget {
  instrument: InstrumentIdentity;
  key: InstrumentKey;
  weight: number;
}

function normalizeTargets(targets: readonly AllocationTarget[]): NormalizedTarget[] {
  const clean = targets
    .map((target) => ({
      instrument: target.instrument,
      key: instrumentKey(target.instrument),
      weight: Math.max(0, target.weight),
    }))
    .filter((target) => target.weight > 0);
  const total = clean.reduce((sum, target) => sum + target.weight, 0);
  return total > 0
    ? clean.map((target) => ({ ...target, weight: target.weight / total }))
    : [];
}

function futureValue(
  startUsd: Decimal,
  contributionUsd: Decimal,
  periodsPerYear: number,
  years: number,
  annualReturnPct: number,
  costPct: Decimal,
): Decimal {
  const periods = Math.round(periodsPerYear * years);
  const netContribution = contributionUsd.mul(new Decimal(1).sub(costPct.div(100)));
  const periodicRate = new Decimal(1)
    .add(new Decimal(annualReturnPct).div(100))
    .pow(new Decimal(1).div(periodsPerYear))
    .sub(1);
  if (periodicRate.abs().lt('0.000000000001')) {
    return startUsd.add(netContribution.mul(periods));
  }
  const growth = new Decimal(1).add(periodicRate).pow(periods);
  return startUsd.mul(growth).add(netContribution.mul(growth.sub(1).div(periodicRate)));
}

function estimateCost(amount: Decimal, costs: TradeCostConfig): Decimal {
  return amount.mul(totalTradeCostBps(costs)).div(10_000);
}

/** Build a fee-aware, drift-correcting contribution plan; never an execution instruction. */
export function planContribution(input: ContributionPlanInput): ContributionPlan | null {
  const budget = new Decimal(input.budgetUsd);
  if (!budget.isFinite() || budget.lte(0)) return null;
  const targets = normalizeTargets(input.targets);
  if (targets.length === 0) return null;
  const costs = input.costs ?? DEFAULT_TRADE_COST_CONFIG;
  const periodsPerYear = PERIODS_PER_YEAR[input.cadence];
  const minimumUseful = new Decimal(Math.max(1, costs.minUsefulTradeUsd));
  const batchEveryPeriods = budget.gte(minimumUseful)
    ? 1
    : minimumUseful.div(budget).ceil().toNumber();
  const buyAmount = budget.mul(batchEveryPeriods);
  const batchingNote =
    batchEveryPeriods === 1
      ? `Each ${input.cadence} contribution is large enough to buy right away.`
      : `$${budget.toDecimalPlaces(0).toFixed()} per ${input.cadence.replace('ly', '')} is under the ~$${minimumUseful.toFixed(0)} minimum useful trade - accumulate and buy every ${batchEveryPeriods} periods ($${buyAmount.toFixed(0)} per buy) so fees and spread don't eat the contribution.`;

  const values = new Map<InstrumentKey, Decimal>();
  for (const target of targets) values.set(target.key, new Decimal(0));
  let offTargetValue = new Decimal(0);
  for (const holding of input.holdings) {
    const key = instrumentKey(holding.instrument);
    const value = Decimal.max(0, holding.valueUsd);
    if (values.has(key)) values.set(key, value);
    else offTargetValue = offTargetValue.add(value);
  }

  const upcomingBuys: PlannedBuy[] = [];
  const costPerBuy = estimateCost(buyAmount, costs);
  for (let buyIndex = 0; buyIndex < 6; buyIndex++) {
    const currentTargetValue = [...values.values()].reduce(
      (sum, value) => sum.add(value),
      new Decimal(0),
    );
    const total = currentTargetValue.add(offTargetValue).add(buyAmount);
    let best: { target: NormalizedTarget; gap: Decimal } | null = null;
    for (const target of targets) {
      const gap = total.mul(target.weight).sub(values.get(target.key) ?? 0);
      if (!best || gap.gt(best.gap)) best = { target, gap };
    }
    if (!best) break;
    upcomingBuys.push({
      period: (buyIndex + 1) * batchEveryPeriods,
      instrument: best.target.instrument,
      amountUsd: decimal(buyAmount.toFixed()),
      estCostUsd: decimal(costPerBuy.toFixed()),
      estCostPct: buyAmount.gt(0) ? costPerBuy.div(buyAmount).mul(100).toNumber() : 0,
    });
    values.set(
      best.target.key,
      (values.get(best.target.key) ?? new Decimal(0)).add(buyAmount).sub(costPerBuy),
    );
  }

  const buysPerYear = new Decimal(periodsPerYear).div(batchEveryPeriods);
  const annualCost = costPerBuy.mul(buysPerYear);
  const annualContribution = budget.mul(periodsPerYear);
  const annualCostPct = annualContribution.gt(0)
    ? annualCost.div(annualContribution).mul(100).toNumber()
    : 0;
  const start = input.holdings.reduce(
    (sum, holding) => sum.add(Decimal.max(0, holding.valueUsd)),
    new Decimal(0),
  );
  const costPct = buyAmount.gt(0) ? costPerBuy.div(buyAmount).mul(100) : new Decimal(0);
  const scenarios = [
    { label: 'No growth (contributions only)', annualReturnPct: 0 },
    ...(input.scenarios ?? [])
      .filter((scenario) => Number.isFinite(scenario.annualReturnPct))
      .map((scenario) => ({
        label: scenario.label,
        annualReturnPct: Math.max(-50, Math.min(60, scenario.annualReturnPct)),
      })),
  ];
  const projections = scenarios.map((scenario) => ({
    label: scenario.label,
    annualReturnPct: scenario.annualReturnPct,
    value1yUsd: decimal(
      futureValue(start, budget, periodsPerYear, 1, scenario.annualReturnPct, costPct).toFixed(),
    ),
    value3yUsd: decimal(
      futureValue(start, budget, periodsPerYear, 3, scenario.annualReturnPct, costPct).toFixed(),
    ),
    value5yUsd: decimal(
      futureValue(start, budget, periodsPerYear, 5, scenario.annualReturnPct, costPct).toFixed(),
    ),
  }));

  return {
    budgetUsd: input.budgetUsd,
    cadence: input.cadence,
    periodsPerYear,
    batchEveryPeriods,
    buyAmountUsd: decimal(buyAmount.toFixed()),
    batchingNote,
    upcomingBuys,
    estAnnualCostUsd: decimal(annualCost.toFixed()),
    estAnnualCostPct: annualCostPct,
    contributed1yUsd: decimal(annualContribution.toFixed()),
    contributed3yUsd: decimal(annualContribution.mul(3).toFixed()),
    contributed5yUsd: decimal(annualContribution.mul(5).toFixed()),
    projections,
  };
}
