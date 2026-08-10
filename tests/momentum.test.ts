import { describe, expect, it } from 'vitest';
import { instrumentKey, momentumStat, momentumTargets } from '../packages/core/src/index.js';

const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

function linear(start: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start + step * i);
}

function compound(start: number, dailyReturn: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start * (1 + dailyReturn) ** i);
}

function alternating(start: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start + i + (i % 2 === 0 ? 12 : -12));
}

const base = [
  { assetId: BTC, weight: 0.5 },
  { assetId: ETH, weight: 0.5 },
];

describe('momentumStat', () => {
  it('returns null when history is shorter than the lookback', () => {
    expect(momentumStat(BTC, [100, 101], { lookbackDays: 5, volatilityDays: 3, maxRelativeTilt: 0.3, defensiveScale: 0.4, targetVolatilityPct: 55 })).toBeNull();
  });

  it('computes lookback return and annualized volatility', () => {
    const stat = momentumStat(BTC, linear(100, 1, 160));
    expect(stat).not.toBeNull();
    expect(stat!.returnPct).toBeGreaterThan(0);
    expect(stat!.volatilityPct).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(stat!.riskAdjustedMomentum)).toBe(true);
  });

  it('averages the trend return across a multi-lookback ensemble', () => {
    // Anchor the return at each horizon: end=200, and the close `lb` days back is
    // 100 (63d → +100%), 160 (126d → +25%), 50 (252d → +300%).
    const closes = Array.from({ length: 253 }, () => 100);
    closes[0] = 50; // 252d back
    closes[126] = 160; // 126d back
    closes[189] = 100; // 63d back
    closes[252] = 200; // end
    const cfg = {
      lookbackDays: 63,
      lookbackDaysEnsemble: [63, 126, 252],
      volatilityDays: 30,
      maxRelativeTilt: 0.35,
      defensiveScale: 0.2,
      targetVolatilityPct: 55,
    };
    const ens = momentumStat(BTC, closes, cfg)!;
    expect(ens.returnPct).toBeCloseTo((1.0 + 0.25 + 3.0) / 3, 6); // 1.4167
    // The single-lookback path (no ensemble field) uses only the 63d horizon → +100%.
    const single = momentumStat(BTC, closes, {
      lookbackDays: 63,
      volatilityDays: 30,
      maxRelativeTilt: 0.35,
      defensiveScale: 0.2,
      targetVolatilityPct: 55,
    })!;
    expect(single.returnPct).toBeCloseTo(1.0, 6);
  });

  it('uses only the ensemble lookbacks the history can cover', () => {
    // 130 closes: the 63d + 126d horizons fit, 252d does not → averaged over two.
    const closes = Array.from({ length: 130 }, () => 100);
    closes[0] = 100;
    closes[3] = 80; // 126d back (129-126=3) → 100/80-1 = +25%
    closes[66] = 50; // 63d back (129-63=66) → 100/50-1 = +100%
    closes[129] = 100; // end
    const stat = momentumStat(BTC, closes, {
      lookbackDays: 63,
      lookbackDaysEnsemble: [63, 126, 252],
      volatilityDays: 30,
      maxRelativeTilt: 0.35,
      defensiveScale: 0.2,
      targetVolatilityPct: 55,
    })!;
    expect(stat.returnPct).toBeCloseTo((1.0 + 0.25) / 2, 6);
  });
});

describe('momentumTargets', () => {
  it('overweights the stronger positive-momentum asset', () => {
    const r = momentumTargets(base, {
      [BTC]: compound(100, 0.01, 140),
      [ETH]: compound(100, 0.001, 140),
    });
    const btc = r.targets.find((t) => t.assetId === BTC)!;
    const eth = r.targets.find((t) => t.assetId === ETH)!;
    expect(btc.weight).toBeGreaterThan(eth.weight);
    expect(r.cashWeight).toBeCloseTo(0, 5);
  });

  it('raises cash when every asset has negative absolute momentum', () => {
    const falling = linear(300, -1, 140);
    const r = momentumTargets(base, { [BTC]: falling, [ETH]: falling });
    expect(r.cashWeight).toBeGreaterThan(0.5);
    expect(r.targets.reduce((s, t) => s + t.weight, 0)).toBeLessThan(0.5);
  });

  it('scales down a high-volatility asset even when its return is positive', () => {
    const calm = linear(100, 1, 140);
    const choppy = alternating(100, 140);
    const r = momentumTargets(base, { [BTC]: calm, [ETH]: choppy }, { lookbackDays: 90, volatilityDays: 30, maxRelativeTilt: 0, defensiveScale: 1, targetVolatilityPct: 25 });
    const btc = r.targets.find((t) => t.assetId === BTC)!;
    const eth = r.targets.find((t) => t.assetId === ETH)!;
    expect(eth.weight).toBeLessThan(btc.weight);
    expect(r.cashWeight).toBeGreaterThan(0);
  });

  it('drops assets without enough history and reports their weight as zero', () => {
    const r = momentumTargets(base, { [BTC]: linear(100, 1, 140), [ETH]: [100, 101] });
    expect(r.targets.find((t) => t.assetId === BTC)!.weight).toBeGreaterThan(0);
    expect(r.targets.find((t) => t.assetId === ETH)!.weight).toBe(0);
  });
});
