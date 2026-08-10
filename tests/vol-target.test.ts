import { describe, expect, it } from 'vitest';
import {
  volTargetTargets,
  volTargetExposure,
  realizedPortfolioVolPct,
  DEFAULT_VOL_TARGET_CONFIG,
  instrumentKey,
} from '../packages/core/src/index.js';

const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

// A calm, gently-rising series (low vol) and a wild, choppy one (high vol).
const calm = Array.from({ length: 140 }, (_, i) => 100 * (1 + 0.001 * i));
function choppy(n: number): number[] {
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    v *= i % 2 === 0 ? 1.08 : 0.93; // ~±8% daily swings → very high vol
    out.push(v);
  }
  return out;
}

const base = [
  { assetId: BTC, weight: 0.6 },
  { assetId: ETH, weight: 0.4 },
];

describe('realizedPortfolioVolPct', () => {
  it('reads higher for a choppy series than a calm one', () => {
    const calmVol = realizedPortfolioVolPct(calm, 30)!;
    const wildVol = realizedPortfolioVolPct(choppy(140), 30)!;
    expect(wildVol).toBeGreaterThan(calmVol);
  });
  it('is null without enough history', () => {
    expect(realizedPortfolioVolPct([100], 30)).toBeNull();
  });
});

describe('volTargetExposure', () => {
  it('leans in on a calm uptrend (near full exposure)', () => {
    const { exposure, belowTrend } = volTargetExposure(calm);
    expect(exposure).toBeGreaterThan(0.5);
    expect(belowTrend).toBe(false);
  });
  it('raises cash when realized vol blows past the target', () => {
    const { exposure } = volTargetExposure(choppy(140), { ...DEFAULT_VOL_TARGET_CONFIG, targetVolPct: 50 });
    expect(exposure).toBeLessThan(1);
    expect(exposure).toBeGreaterThanOrEqual(DEFAULT_VOL_TARGET_CONFIG.minExposure);
  });
  it('caps exposure below trend (defensive gate)', () => {
    // A series that ends well below its trend SMA.
    const rise = Array.from({ length: 110 }, (_, i) => 100 + i);
    const drop = Array.from({ length: 30 }, (_, i) => 210 - i * 4); // falls under the MA
    const { exposure, belowTrend } = volTargetExposure([...rise, ...drop]);
    expect(belowTrend).toBe(true);
    expect(exposure).toBeLessThanOrEqual(DEFAULT_VOL_TARGET_CONFIG.belowTrendMaxExposure);
  });
  it('defaults to full exposure without enough history', () => {
    expect(volTargetExposure([100, 101]).exposure).toBe(DEFAULT_VOL_TARGET_CONFIG.maxExposure);
  });
});

describe('volTargetTargets', () => {
  it('scales base weights by exposure and books the rest as cash', () => {
    const r = volTargetTargets(base, choppy(140));
    const invested = r.targets.reduce((s, t) => s + t.weight, 0);
    expect(invested).toBeCloseTo(r.exposure, 6);
    expect(r.cashWeight).toBeCloseTo(1 - r.exposure, 6);
    // base ratio preserved (60/40)
    const btc = r.targets.find((t) => t.assetId === BTC)!.weight;
    const eth = r.targets.find((t) => t.assetId === ETH)!.weight;
    expect(btc / eth).toBeCloseTo(1.5, 4);
  });
});
