import { describe, expect, it } from 'vitest';
import {
  buyCandidateConfigForPortfolioSizing,
  guardrailsForPortfolioSizing,
  resolvePortfolioSizingPolicy,
} from '../packages/core/src/index.js';

describe('resolvePortfolioSizingPolicy', () => {
  it('keeps micro paper accounts conservative enough to avoid churn', () => {
    const policy = resolvePortfolioSizingPolicy({ portfolioValueUsd: 33 });
    const guardrails = guardrailsForPortfolioSizing(policy);
    const buyConfig = buyCandidateConfigForPortfolioSizing(policy);

    expect(policy.tier).toBe('micro');
    expect(policy.candidateSleevePct).toBe(0);
    expect(policy.maxTradesPerRun).toBe(1);
    expect(guardrails.minTradeUsd).toBe(25);
    expect(guardrails.maxTurnoverPct).toBeCloseTo(0.08, 6);
    expect(buyConfig.maxCandidates).toBe(1);
    expect(buyConfig.sleevePct).toBe(0);
    expect(buyConfig.minScore).toBe(80);
  });

  it('allows medium accounts more rotation and candidate exposure', () => {
    const policy = resolvePortfolioSizingPolicy({ portfolioValueUsd: 5_000 });
    const guardrails = guardrailsForPortfolioSizing(policy);
    const buyConfig = buyCandidateConfigForPortfolioSizing(policy);

    expect(policy.tier).toBe('medium');
    expect(policy.maxTradesPerRun).toBe(5);
    expect(policy.candidateSleevePct).toBeCloseTo(0.08, 6);
    expect(guardrails.maxTurnoverPct).toBeCloseTo(0.28, 6);
    expect(buyConfig.maxCandidates).toBe(2);
    expect(buyConfig.maxCandidateWeightPct).toBeCloseTo(0.08, 6);
  });

  it('carries position and total-at-risk ceilings into the guardrails', () => {
    const medium = guardrailsForPortfolioSizing(
      resolvePortfolioSizingPolicy({ portfolioValueUsd: 5_000 }),
    );
    expect(medium.maxPositionPct).toBeCloseTo(0.3, 6);
    expect(medium.maxTotalAtRiskPct).toBeCloseTo(0.96, 6);

    const micro = guardrailsForPortfolioSizing(
      resolvePortfolioSizingPolicy({ portfolioValueUsd: 33 }),
    );
    expect(micro.maxPositionPct).toBeCloseTo(0.7, 6);
    expect(micro.maxTotalAtRiskPct).toBeCloseTo(0.9, 6);
  });

  it('scales risk down during drawdown and blocks after the hard loss limit', () => {
    const reduced = resolvePortfolioSizingPolicy({
      portfolioValueUsd: 5_000,
      drawdownPct: -5.2,
    });
    expect(reduced.riskScale).toBeCloseTo(0.35, 6);
    expect(reduced.candidateSleevePct).toBeCloseTo(0.028, 6);
    expect(reduced.maxTradesPerRun).toBe(1);

    const blocked = resolvePortfolioSizingPolicy({
      portfolioValueUsd: 5_000,
      drawdownPct: -8.5,
    });
    const guardrails = guardrailsForPortfolioSizing(blocked);
    expect(blocked.riskScale).toBe(0);
    expect(blocked.blockReason).toBe('daily loss limit reached');
    expect(guardrails.maxTrades).toBe(0);
    expect(guardrails.blockReason).toBe('daily loss limit reached');
  });
});
