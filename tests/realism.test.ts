import { describe, expect, it } from 'vitest';
import {
  decimal,
  DEFAULT_VENUE_COST_PROFILE,
  applyProfitabilityGate,
  buildNetProfitabilityReports,
  checkTradeProfitability,
  resolveVenueCostProfile,
  tradeCostConfigFromVenue,
  DEFAULT_RISK_CONTROL_PROFILE,
  DEFAULT_TRADE_COST_CONFIG,
  marketQualityFromCosts,
  resolveRiskControlState,
  type AssetRef,
  type ConcreteAutoStrategy,
  type ExecutionIntent,
  type StrategyBacktestResult,
  type StrategyMetrics,
  type TrackResult,
} from '../packages/core/src/index.js';
import { BTC } from './support.js';

function asset(id: string): AssetRef {
  return {
    instrument: { venue: 'coinbase', productId: `${id}-USD`, productType: 'spot' },
    symbol: id,
    name: id,
    baseAsset: id,
    quoteAsset: 'USD',
    coingeckoId: id.toLowerCase(),
  };
}

function intent(id: string, side: 'buy' | 'sell', amountUsd: number): ExecutionIntent {
  return { asset: asset(id), side, amountUsd: decimal(String(amountUsd)), origin: 'rebalance', urgency: 'passive' };
}

function metrics(over: Partial<StrategyMetrics>): StrategyMetrics {
  return {
    totalReturnPct: 0,
    annualizedReturnPct: 0,
    maxDrawdownPct: 0,
    volatilityPct: 0,
    sharpe: null,
    sortino: null,
    calmar: null,
    ...over,
  };
}

function track(over: Partial<StrategyMetrics>, costPctOfStart = 0): TrackResult {
  return {
    equity: [],
    metrics: metrics(over),
    costs: { turnoverUsd: costPctOfStart * 100, totalCostUsd: costPctOfStart, costPctOfStart, events: 1 },
  };
}

function scoreboard(overrides: Partial<Record<'hold' | ConcreteAutoStrategy, TrackResult>> = {}): StrategyBacktestResult {
  return {
    runAtMs: 1_785_542_400_000,
    hold: overrides.hold ?? track({ totalReturnPct: 8, annualizedReturnPct: 8 }),
    passive: overrides.passive ?? track({ totalReturnPct: 7, annualizedReturnPct: 7 }),
    signal: overrides.signal ?? track({ totalReturnPct: 6, annualizedReturnPct: 6, sortino: 0.4 }),
    momentum: overrides.momentum ?? track({ totalReturnPct: 9, annualizedReturnPct: 9, sortino: 0.7 }),
    voltarget: overrides.voltarget ?? track({ totalReturnPct: 5, annualizedReturnPct: 5, sortino: 0.2 }),
    trendvol: overrides.trendvol ?? track({ totalReturnPct: 12, annualizedReturnPct: 12, sortino: 1.1 }, 2),
    rotation: overrides.rotation ?? track({ totalReturnPct: 10, annualizedReturnPct: 10, sortino: 0.8 }),
    significance: {
      trials: 4,
      sampleDays: 365,
      leader: 'trendvol',
      leaderSharpe: 1,
      psr: 0.9,
      dsr: 0.7,
      verdict: 'inconclusive',
      note: '',
    },
    walkForward: {
      folds: 4,
      oosFolds: 3,
      perFold: [],
      walkForwardReturnPct: 10,
      passiveReturnPct: 6,
      holdReturnPct: 7,
      oracleReturnPct: 12,
      verdict: 'adds_value',
      note: '',
    },
    assets: [BTC],
    days: 365,
    rebalanceEveryDays: 14,
  };
}

describe('venue cost profile', () => {
  it('resolves the conservative taker-first defaults', () => {
    const profile = resolveVenueCostProfile();
    expect(profile).toEqual(DEFAULT_VENUE_COST_PROFILE);
    expect(tradeCostConfigFromVenue(profile)).toMatchObject({
      feeBps: profile.takerFeeBps,
      spreadBps: profile.spreadBps,
      slippageBps: profile.slippageBps,
      minUsefulTradeUsd: profile.minUsefulTradeUsd,
    });
  });

  it('honors maker fees only for a custom maker-preferred profile', () => {
    const profile = resolveVenueCostProfile({
      preset: 'custom',
      makerFeeBps: 12,
      takerFeeBps: 80,
      spreadBps: 5,
      slippageBps: 7,
      minUsefulTradeUsd: 50,
      profitBufferMultiple: 3,
      preferredLiquidity: 'maker',
    });

    expect(tradeCostConfigFromVenue(profile).feeBps).toBe(12);
    expect(profile.profitBufferMultiple).toBe(3);
  });
});

describe('trade profitability gate', () => {
  it('blocks trades whose expected edge does not clear the cost buffer', () => {
    const check = checkTradeProfitability(intent('BTC', 'buy', 100), DEFAULT_VENUE_COST_PROFILE, 1, { asOfMs: 0 });

    expect(check.ok).toBe(false);
    expect(check.estimatedCostUsd).toBeCloseTo(0.85, 6);
    expect(check.requiredEdgeUsd).toBeCloseTo(1.7, 6);
    expect(check.reason).toContain('historical net-edge estimate');
  });

  it('adds tax drag to sell suppression and allows loss-harvest credit to help', () => {
    const taxed = checkTradeProfitability(intent('ETH', 'sell', 100), DEFAULT_VENUE_COST_PROFILE, 3, { asOfMs: 0 }, 4);
    const harvest = checkTradeProfitability(intent('ETH', 'sell', 100), DEFAULT_VENUE_COST_PROFILE, 1, { asOfMs: 0 }, -1);

    expect(taxed.ok).toBe(false);
    expect(taxed.reason).toContain('tax drag');
    expect(harvest.ok).toBe(true);
    expect(harvest.netEdgeUsd).toBeGreaterThan(0);
  });

  it('returns skipped dry-run reasons for profitability and tax blocks', () => {
    const res = applyProfitabilityGate(
      [intent('BTC', 'buy', 100), intent('ETH', 'sell', 100)],
      DEFAULT_VENUE_COST_PROFILE,
      0.5,
      { asOfMs: 0 },
      (i) => (i.side === 'sell' ? 3 : 0),
    );

    expect(res.intents).toEqual([]);
    expect(res.skippedTrades).toHaveLength(2);
    expect(res.skippedTrades.map((s) => s.reason).join(' ')).toContain('tax drag');
  });

  it('blocks dry-run trades for stale market data before cost edge checks', () => {
    const riskState = resolveRiskControlState({
      equityValues: [100, 101],
      marketDataAgeMs: DEFAULT_RISK_CONTROL_PROFILE.staleDataTimeoutMs + 1,
    });
    const res = applyProfitabilityGate(
      [intent('BTC', 'buy', 100)],
      DEFAULT_VENUE_COST_PROFILE,
      10,
      {
        asOfMs: 0,
        riskState,
        marketQuality: marketQualityFromCosts({
          asOf: 0,
          feedAgeMs: DEFAULT_RISK_CONTROL_PROFILE.staleDataTimeoutMs + 1,
          spreadBps: 10,
          slippageBps: 15,
        }),
      },
      () => 0,
    );

    expect(res.intents).toEqual([]);
    expect(res.skippedTrades[0]!.reason).toContain('stale');
  });

  it('includes execution shortfall in trade profitability checks', () => {
    const check = checkTradeProfitability(
      intent('BTC', 'buy', 10_000),
      DEFAULT_VENUE_COST_PROFILE,
      10,
      {
        asOfMs: 0,
        marketQuality: marketQualityFromCosts({ asOf: 0, spreadBps: 900, slippageBps: 900, impactBps: 200 }),
      },
      0,
    );

    expect(check.ok).toBe(false);
    expect(check.executionPolicy?.blocked).toBe(true);
    expect(check.reason).toContain('execution shortfall');
    expect(check.estimatedCostUsd).toBeGreaterThan(DEFAULT_TRADE_COST_CONFIG.minUsefulTradeUsd);
  });
});

describe('net profitability reports', () => {
  it('keeps historical winners in watching until forward paper days accrue', () => {
    const reports = buildNetProfitabilityReports(scoreboard(), 0);

    expect(reports.trendvol.status).toBe('watching');
    expect(reports.trendvol.netEdgeAfterCostsPct).toBe(4);
    expect(reports.trendvol.annualCostDragPct).toBeCloseTo(2, 6);
  });

  it('marks active strategies not ready when higher raw return loses after realistic costs', () => {
    const reports = buildNetProfitabilityReports(
      scoreboard({
        passive: track({ totalReturnPct: 12, annualizedReturnPct: 12 }),
        trendvol: track({ totalReturnPct: 11, annualizedReturnPct: 18, sortino: 2 }, 8),
      }),
      45,
    );

    expect(reports.trendvol.status).toBe('not_ready');
    expect(reports.trendvol.excessVsPassivePct).toBeLessThan(0);
  });

  it('only clears the paper gate after observed days, decisions, and fills', () => {
    const reports = buildNetProfitabilityReports(scoreboard(), {
      days: 90,
      decisions: 50,
      fills: 30,
    });

    expect(reports.trendvol.status).toBe('clears_paper_gate');
  });
});
