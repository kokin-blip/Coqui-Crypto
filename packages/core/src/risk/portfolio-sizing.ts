/** Portfolio-size-aware sizing for paper auto-trading. */

import {
  DEFAULT_BUY_CANDIDATE_CONFIG,
  type BuyCandidateConfig,
} from '../strategies/index.js';
import {
  DEFAULT_AUTO_TRADE_GUARDRAILS,
  type AutoTradeGuardrails,
} from './autotrade.js';
import type { RiskControlState } from './risk-controls.js';

export type PortfolioSizeTier = 'micro' | 'small' | 'medium' | 'large';

export interface PortfolioSizingPolicy {
  accountSizeUsd: number;
  tier: PortfolioSizeTier;
  maxPositionPct: number;
  maxNewEntryPct: number;
  maxTurnoverPct: number;
  maxTradesPerRun: number;
  minTradeUsd: number;
  candidateSleevePct: number;
  cashReservePct: number;
  riskScale: number;
  blockReason: string | null;
}

export interface PortfolioSizingInput {
  portfolioValueUsd: number;
  /** Negative percent drawdown/loss, e.g. -6.5. */
  drawdownPct?: number | null;
  riskState?: RiskControlState | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function tierFor(valueUsd: number): PortfolioSizeTier {
  if (valueUsd < 100) return 'micro';
  if (valueUsd < 1_000) return 'small';
  if (valueUsd < 10_000) return 'medium';
  return 'large';
}

function basePolicy(
  accountSizeUsd: number,
  tier: PortfolioSizeTier,
): PortfolioSizingPolicy {
  switch (tier) {
    case 'micro':
      return {
        accountSizeUsd,
        tier,
        maxPositionPct: 0.7,
        maxNewEntryPct: 0.03,
        maxTurnoverPct: 0.08,
        maxTradesPerRun: 1,
        minTradeUsd: 25,
        candidateSleevePct: 0,
        cashReservePct: 0.1,
        riskScale: 1,
        blockReason: null,
      };
    case 'small':
      return {
        accountSizeUsd,
        tier,
        maxPositionPct: 0.45,
        maxNewEntryPct: 0.05,
        maxTurnoverPct: 0.16,
        maxTradesPerRun: 2,
        minTradeUsd: 25,
        candidateSleevePct: 0.04,
        cashReservePct: 0.07,
        riskScale: 1,
        blockReason: null,
      };
    case 'medium':
      return {
        accountSizeUsd,
        tier,
        maxPositionPct: 0.3,
        maxNewEntryPct: 0.08,
        maxTurnoverPct: 0.28,
        maxTradesPerRun: 5,
        minTradeUsd: 25,
        candidateSleevePct: 0.08,
        cashReservePct: 0.04,
        riskScale: 1,
        blockReason: null,
      };
    case 'large':
      return {
        accountSizeUsd,
        tier,
        maxPositionPct: 0.2,
        maxNewEntryPct: 0.05,
        maxTurnoverPct: 0.35,
        maxTradesPerRun: 8,
        minTradeUsd: 50,
        candidateSleevePct: 0.1,
        cashReservePct: 0.03,
        riskScale: 1,
        blockReason: null,
      };
  }
}

export function resolvePortfolioSizingPolicy(
  input: PortfolioSizingInput,
): PortfolioSizingPolicy {
  const accountSizeUsd = Math.max(
    0,
    Number.isFinite(input.portfolioValueUsd) ? input.portfolioValueUsd : 0,
  );
  const drawdownPct =
    typeof input.drawdownPct === 'number' && Number.isFinite(input.drawdownPct)
      ? Math.min(0, input.drawdownPct)
      : 0;
  const policy = basePolicy(accountSizeUsd, tierFor(accountSizeUsd));

  let riskScale = input.riskState?.exposureScale ?? 1;
  let blockReason: string | null = input.riskState?.blockReason ?? null;
  if (drawdownPct <= -8) {
    riskScale = 0;
    blockReason = 'daily loss limit reached';
  } else if (drawdownPct <= -5) {
    riskScale = 0.35;
  } else if (drawdownPct <= -2) {
    riskScale = 0.6;
  }

  return {
    ...policy,
    riskScale,
    blockReason,
    maxTurnoverPct:
      Math.min(policy.maxTurnoverPct, (input.riskState?.maxTurnoverPct ?? 100) / 100) *
      riskScale,
    maxTradesPerRun:
      riskScale === 0
        ? 0
        : Math.max(
            1,
            Math.min(
              policy.maxTradesPerRun,
              Math.floor(input.riskState?.maxTradeCount ?? policy.maxTradesPerRun),
              Math.floor(policy.maxTradesPerRun * riskScale),
            ),
          ),
    candidateSleevePct: policy.candidateSleevePct * riskScale,
    maxPositionPct: Math.min(
      policy.maxPositionPct,
      (input.riskState?.profile.maxPositionPct ?? policy.maxPositionPct * 100) / 100,
    ),
  };
}

export function guardrailsForPortfolioSizing(
  policy: PortfolioSizingPolicy,
): AutoTradeGuardrails {
  const guardrails: AutoTradeGuardrails = {
    ...DEFAULT_AUTO_TRADE_GUARDRAILS,
    minTradeUsd: Math.max(policy.minTradeUsd, DEFAULT_AUTO_TRADE_GUARDRAILS.minTradeUsd),
    maxTurnoverPct: clamp(
      policy.maxTurnoverPct,
      0,
      DEFAULT_AUTO_TRADE_GUARDRAILS.maxTurnoverPct,
    ),
    maxTrades: Math.max(0, Math.floor(policy.maxTradesPerRun)),
    maxPositionPct: clamp(policy.maxPositionPct, 0, 1),
    maxTotalAtRiskPct: clamp(1 - policy.cashReservePct, 0, 1),
  };
  if (policy.blockReason) guardrails.blockReason = policy.blockReason;
  return guardrails;
}

export function buyCandidateConfigForPortfolioSizing(
  policy: PortfolioSizingPolicy,
): BuyCandidateConfig {
  return {
    ...DEFAULT_BUY_CANDIDATE_CONFIG,
    minScore:
      policy.tier === 'micro'
        ? 80
        : policy.tier === 'small'
          ? 75
          : DEFAULT_BUY_CANDIDATE_CONFIG.minScore,
    sleevePct: policy.candidateSleevePct,
    maxCandidates:
      policy.maxTradesPerRun <= 0
        ? 0
        : Math.min(DEFAULT_BUY_CANDIDATE_CONFIG.maxCandidates, policy.maxTradesPerRun),
    maxCandidateWeightPct: policy.maxNewEntryPct,
  };
}
