import { describe, expect, it } from 'vitest';
import {
  applyAutoTradeGuardrails,
  canExecute,
  decimal,
  planAutoRebalance,
  DEFAULT_AUTO_TRADE_GUARDRAILS,
  type AllocationPolicy,
  type AssetRef,
  type ExecutionIntent,
  type Holding,
} from '../packages/core/src/index.js';

const NOW = 1_700_000_000_000;

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
function holding(id: string, quantity: number, priceUsd: number | null): Holding {
  const valueUsd = priceUsd !== null ? quantity * priceUsd : null;
  return {
    asset: asset(id),
    quantity: decimal(String(quantity)),
    avgCostUsd: decimal(String(priceUsd ?? 0)),
    priceUsd: priceUsd === null ? null : decimal(String(priceUsd)),
    valueUsd: valueUsd === null ? null : decimal(String(valueUsd)),
    unrealizedPnlUsd: decimal('0'),
    unrealizedPnlPct: 0,
  };
}

const passive = (id: string, side: 'buy' | 'sell', amountUsd: number): ExecutionIntent => ({
  asset: asset(id),
  side,
  amountUsd: decimal(String(amountUsd)),
  origin: 'rebalance',
  urgency: 'passive',
});

describe('canExecute', () => {
  it('only executes in paper mode with the kill switch off', () => {
    expect(canExecute('paper', false)).toBe(true);
    expect(canExecute('paper', true)).toBe(false);
    expect(canExecute('off', false)).toBe(false);
    expect(canExecute('live', false)).toBe(false); // live is hard-disabled
  });
});

describe('planAutoRebalance', () => {
  const policy: AllocationPolicy = {
    targets: [
      { instrument: asset('BTC').instrument, weight: 0.5 },
      { instrument: asset('ETH').instrument, weight: 0.5 },
    ],
    rebalanceBandPct: 5,
  };

  it('emits passive rebalance intents for holdings past the band', () => {
    // BTC 90% / ETH 10% vs 50/50 → sell BTC, buy ETH.
    const holdings = [holding('BTC', 9, 1000), holding('ETH', 1, 1000)];
    const intents = planAutoRebalance(holdings, policy, NOW);
    expect(intents.length).toBe(2);
    for (const i of intents) {
      expect(i.origin).toBe('rebalance');
      expect(i.urgency).toBe('passive');
    }
    expect(intents.find((i) => i.asset.symbol === 'BTC')!.side).toBe('sell');
    expect(intents.find((i) => i.asset.symbol === 'ETH')!.side).toBe('buy');
  });

  it('emits nothing when holdings are within band', () => {
    const holdings = [holding('BTC', 5, 1000), holding('ETH', 5, 1000)];
    expect(planAutoRebalance(holdings, policy, NOW)).toEqual([]);
  });
});

describe('applyAutoTradeGuardrails', () => {
  it('skips trades below the minimum size', () => {
    const intents = [
      passive('BTC', 'buy', 10),
      passive('ETH', 'buy', 100),
    ];
    const guarded = applyAutoTradeGuardrails(intents, [holding('BTC', 1, 1000), holding('ETH', 1, 1000)]);

    expect(guarded.intents.map((i) => i.asset.symbol)).toEqual(['ETH']);
    expect(guarded.skippedTrades).toHaveLength(1);
    expect(guarded.skippedTrades[0]!.reason).toContain('minimum trade size');
    expect(guarded.warnings[0]).toContain('skipped');
  });

  it('blocks the run when turnover exceeds the per-run cap', () => {
    const intents = [
      passive('BTC', 'sell', 900),
    ];
    const guarded = applyAutoTradeGuardrails(intents, [holding('BTC', 1, 1000)], {
      minTradeUsd: 25,
      maxTurnoverPct: 0.5,
      maxTradeCostPct: 2,
      maxTrades: 8,
    });

    expect(guarded.intents).toEqual([]);
    expect(guarded.skippedTrades[0]!.reason).toContain('turnover exceeds');
    expect(guarded.warnings[0]).toContain('stood down');
  });

  it('stands down completely when portfolio sizing trips a hard block', () => {
    const intents = [
      passive('BTC', 'buy', 100),
      passive('ETH', 'sell', 100),
    ];
    const guarded = applyAutoTradeGuardrails(intents, [holding('BTC', 1, 1000), holding('ETH', 1, 1000)], {
      minTradeUsd: 25,
      maxTurnoverPct: 0,
      maxTradeCostPct: 2,
      maxTrades: 0,
      blockReason: 'daily loss limit reached',
    });

    expect(guarded.intents).toEqual([]);
    expect(guarded.skippedTrades).toHaveLength(2);
    expect(guarded.skippedTrades[0]!.reason).toBe('daily loss limit reached');
    expect(guarded.warnings[0]).toContain('daily loss limit reached');
  });
});

describe('applyAutoTradeGuardrails — hard caps', () => {
  it('rejects a very large order once size-aware impact pushes cost over the cap', () => {
    const holdings = [holding('BTC', 1000, 1000)]; // $1,000,000 book
    // $400k order: 85bps flat + 60*√(400k/25k)=240bps impact = 3.25% > 1.25% cap.
    const guarded = applyAutoTradeGuardrails([passive('BTC', 'sell', 400_000)], holdings);
    expect(guarded.intents).toHaveLength(0);
    expect(guarded.skippedTrades[0]!.reason).toContain('cost');
    // A moderate $10k order on the same book stays under the cap (impact is small).
    const ok = applyAutoTradeGuardrails([passive('BTC', 'sell', 10_000)], holdings);
    expect(ok.intents).toHaveLength(1);
  });

  it('clamps an oversized trade down to maxTradeUsd', () => {
    const res = applyAutoTradeGuardrails([passive('BTC', 'sell', 8000)], [holding('BTC', 10, 1000)], {
      ...DEFAULT_AUTO_TRADE_GUARDRAILS,
      maxTradeUsd: 2000,
    });
    expect(res.intents).toHaveLength(1);
    expect(res.intents[0]!.amountUsd).toBe('2000');
  });

  it('skips a buy that would push a position past the max-position ceiling', () => {
    // $10k book: $4k BTC + $6k cash. Ceiling 50% = $5k; 4k+3k buy = 7k > 5k → skip.
    const holdings = [holding('BTC', 4, 1000), holding('USDC', 6000, 1)];
    const res = applyAutoTradeGuardrails([passive('BTC', 'buy', 3000)], holdings, {
      ...DEFAULT_AUTO_TRADE_GUARDRAILS,
      maxPositionPct: 0.5,
    });
    expect(res.intents).toHaveLength(0);
    expect(res.skippedTrades[0]!.reason).toContain('position cap');
  });

  it('caps aggregate buying at the total-at-risk ceiling (stablecoins are cash)', () => {
    // $10k: $2k BTC risk + $8k USDC cash. Cap 50% = $5k → headroom $3k.
    const holdings = [holding('BTC', 2, 1000), holding('USDC', 8000, 1)];
    const res = applyAutoTradeGuardrails([passive('ETH', 'buy', 2500), passive('SOL', 'buy', 2000)], holdings, {
      ...DEFAULT_AUTO_TRADE_GUARDRAILS,
      maxTotalAtRiskPct: 0.5,
    });
    // ETH 2500 admitted (headroom→500); SOL 2000 > 500 → skipped.
    expect(res.intents.map((i) => i.asset.symbol)).toEqual(['ETH']);
    expect(res.skippedTrades.some((s) => s.symbol === 'SOL' && /total-at-risk/.test(s.reason))).toBe(true);
  });

  it('a risk-reducing sell frees total-at-risk headroom for a buy', () => {
    // $10k: $5k BTC risk + $5k cash → base headroom 0 at a 50% cap; a $2k sell frees $2k.
    const holdings = [holding('BTC', 5, 1000), holding('USDC', 5000, 1)];
    const res = applyAutoTradeGuardrails([passive('BTC', 'sell', 2000), passive('ETH', 'buy', 1500)], holdings, {
      ...DEFAULT_AUTO_TRADE_GUARDRAILS,
      maxTotalAtRiskPct: 0.5,
    });
    expect(res.intents.some((i) => i.asset.symbol === 'ETH')).toBe(true);
    expect(res.intents.some((i) => i.asset.symbol === 'BTC' && i.side === 'sell')).toBe(true);
  });
});

