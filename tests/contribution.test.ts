import { describe, expect, it } from 'vitest';
import {
  decimal,
  planContribution,
  type ContributionPlanInput,
  type InstrumentIdentity,
} from '../packages/core/src/index.js';

const NO_COST = { feeBps: 0, spreadBps: 0, slippageBps: 0, minUsefulTradeUsd: 25 };

function instrument(id: string): InstrumentIdentity {
  return { venue: 'coinbase', productId: `${id}-USD`, productType: 'spot' };
}

function input(overrides: Partial<ContributionPlanInput> = {}): ContributionPlanInput {
  return {
    budgetUsd: decimal('50'),
    cadence: 'weekly',
    targets: [
      { instrument: instrument('BTC'), weight: 0.6 },
      { instrument: instrument('ETH'), weight: 0.4 },
    ],
    holdings: [],
    costs: NO_COST,
    ...overrides,
  };
}

describe('planContribution', () => {
  it('returns null for non-positive budget or empty targets', () => {
    expect(planContribution(input({ budgetUsd: decimal('0') }))).toBeNull();
    expect(planContribution(input({ budgetUsd: decimal('-5') }))).toBeNull();
    expect(planContribution(input({ targets: [] }))).toBeNull();
  });

  it('batches small contributions up to the minimum useful trade', () => {
    const plan = planContribution(input({ budgetUsd: decimal('10') }))!;
    expect(plan.batchEveryPeriods).toBe(3);
    expect(plan.buyAmountUsd).toBe('30');
    expect(plan.batchingNote).toContain('every 3 periods');
    expect(plan.upcomingBuys[0]?.period).toBe(3);
    expect(planContribution(input())?.batchEveryPeriods).toBe(1);
  });

  it('uses canonical drift to buy the most underweight target first', () => {
    const plan = planContribution(
      input({
        holdings: [
          { instrument: instrument('BTC'), valueUsd: decimal('900') },
          { instrument: instrument('ETH'), valueUsd: decimal('100') },
        ],
      }),
    )!;
    expect(plan.upcomingBuys[0]?.instrument.productId).toBe('ETH-USD');
    expect(plan.upcomingBuys[1]?.instrument.productId).toBe('ETH-USD');
  });

  it('moves an empty book toward the target mix', () => {
    const plan = planContribution(input({ budgetUsd: decimal('100') }))!;
    const first = plan.upcomingBuys.slice(0, 5).map((buy) => buy.instrument.productId);
    expect(first[0]).toBe('BTC-USD');
    expect(new Set(first)).toEqual(new Set(['BTC-USD', 'ETH-USD']));
    expect(first.filter((id) => id === 'BTC-USD').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the zero-growth projection arithmetically exact without costs', () => {
    const plan = planContribution(
      input({
        budgetUsd: decimal('100'),
        holdings: [{ instrument: instrument('BTC'), valueUsd: decimal('500') }],
      }),
    )!;
    const zero = plan.projections.find((projection) => projection.annualReturnPct === 0)!;
    expect(zero.value1yUsd).toBe('5700');
    expect(zero.value5yUsd).toBe('26500');
  });

  it('compounds bounded illustration scenarios above the contribution baseline', () => {
    const plan = planContribution(
      input({ scenarios: [{ label: 'Historical mix', annualReturnPct: 12 }] }),
    )!;
    const growth = plan.projections.find((projection) => projection.label === 'Historical mix')!;
    expect(Number(growth.value5yUsd)).toBeGreaterThan(Number(plan.contributed5yUsd));
    const clamped = planContribution(
      input({ scenarios: [{ label: 'wild', annualReturnPct: 500 }] }),
    )!;
    expect(clamped.projections.find((projection) => projection.label === 'wild')?.annualReturnPct)
      .toBe(60);
  });

  it('uses the shared cost profile for annual drag and projections', () => {
    const costs = { feeBps: 60, spreadBps: 10, slippageBps: 15, minUsefulTradeUsd: 25 };
    const costly = planContribution(input({ costs }))!;
    const free = planContribution(input())!;
    expect(Number(costly.estAnnualCostUsd)).toBeGreaterThan(0);
    expect(costly.estAnnualCostPct).toBeCloseTo(0.85, 6);
    expect(Number(costly.projections[0]!.value1yUsd)).toBeLessThan(
      Number(free.projections[0]!.value1yUsd),
    );
  });

  it('uses twelve monthly periods per year', () => {
    const plan = planContribution(
      input({ cadence: 'monthly', budgetUsd: decimal('100') }),
    )!;
    expect(plan.periodsPerYear).toBe(12);
    expect(plan.contributed1yUsd).toBe('1200');
  });
});
