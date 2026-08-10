import { describe, expect, it } from 'vitest';
import {
  assetConviction,
  instrumentKey,
  tiltTargets,
  type AssetSignal,
  type InstrumentKey,
} from '../packages/core/src/index.js';

const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

function sig(over: Partial<AssetSignal> & { assetId: InstrumentKey }): AssetSignal {
  return { action: 'hold', rsi: 50, regime: 'calm', ...over };
}

describe('assetConviction', () => {
  it('is neutral for hold', () => {
    expect(assetConviction(sig({ assetId: BTC, action: 'hold' }))).toBe(0);
  });

  it('fully retreats on exit', () => {
    expect(assetConviction(sig({ assetId: BTC, action: 'exit' }))).toBe(-1);
  });

  it('accumulate is positive and deeper when more oversold', () => {
    const mild = assetConviction(sig({ assetId: BTC, action: 'accumulate', rsi: 50 }));
    const deep = assetConviction(sig({ assetId: BTC, action: 'accumulate', rsi: 30 }));
    expect(mild).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(mild);
    expect(deep).toBeCloseTo(0.8, 5);
  });

  it('trim is negative and deeper when more overbought', () => {
    const mild = assetConviction(sig({ assetId: BTC, action: 'trim', rsi: 50 }));
    const deep = assetConviction(sig({ assetId: BTC, action: 'trim', rsi: 70 }));
    expect(mild).toBeLessThan(0);
    expect(deep).toBeLessThan(mild);
    // calm regime eases trims (×0.7): −(0.3 + 0.5) × 0.7 = −0.56.
    expect(deep).toBeCloseTo(-0.56, 5);
  });

  it('eases trims in a calm regime (trend-follow) but not in volatile', () => {
    const calmTrim = assetConviction(sig({ assetId: BTC, action: 'trim', rsi: 70, regime: 'calm' }));
    const volTrim = assetConviction(sig({ assetId: BTC, action: 'trim', rsi: 70, regime: 'volatile' }));
    // calm ×0.7 = −0.56; volatile ×0.6 (dampen) = −0.48. Calm trims *less* (closer to 0).
    expect(calmTrim).toBeCloseTo(-0.56, 5);
    expect(volTrim).toBeCloseTo(-0.48, 5);
    expect(Math.abs(calmTrim)).toBeGreaterThan(Math.abs(volTrim));
  });

  it('dampens the magnitude in a volatile regime', () => {
    const calm = assetConviction(sig({ assetId: BTC, action: 'accumulate', rsi: 30, regime: 'calm' }));
    const vol = assetConviction(sig({ assetId: BTC, action: 'accumulate', rsi: 30, regime: 'volatile' }));
    expect(vol).toBeCloseTo(calm * 0.6, 5);
  });

  it('honors a custom config (bigger maxTilt not applied here, but presets differ)', () => {
    const aggressive = assetConviction(
      sig({ assetId: BTC, action: 'trim', rsi: 70, regime: 'calm' }),
      { maxTilt: 0.6, baseTilt: 0.4, rsiScale: 0.5, rsiWindow: 20, volatileDampen: 0.6, calmTrimRelief: 1 },
    );
    // No calm relief (1.0): −(0.4 + 0.5) = −0.9.
    expect(aggressive).toBeCloseTo(-0.9, 5);
  });
});

describe('tiltTargets', () => {
  const base = [
    { assetId: BTC, weight: 0.5 },
    { assetId: ETH, weight: 0.5 },
  ];

  it('leaves base weights untouched when all signals are hold', () => {
    const r = tiltTargets(base, [
      sig({ assetId: BTC, action: 'hold' }),
      sig({ assetId: ETH, action: 'hold' }),
    ]);
    expect(r.targets).toEqual(base);
    expect(r.cashWeight).toBeCloseTo(0, 5);
  });

  it('raises cash when the net tilt is defensive (exit)', () => {
    const r = tiltTargets(base, [
      sig({ assetId: BTC, action: 'exit' }), // conviction -1 → 0.5*0.4 = 0.2
      sig({ assetId: ETH, action: 'hold' }), // 0.5
    ]);
    const btc = r.targets.find((t) => t.assetId === BTC)!;
    expect(btc.weight).toBeCloseTo(0.2, 5);
    expect(r.cashWeight).toBeCloseTo(0.3, 5); // 1 − (0.2 + 0.5)
  });

  it('caps at fully invested (no leverage) when net-bullish, rotating instead', () => {
    const r = tiltTargets(base, [
      sig({ assetId: BTC, action: 'accumulate', rsi: 30 }), // strong overweight
      sig({ assetId: ETH, action: 'accumulate', rsi: 30 }),
    ]);
    const sum = r.targets.reduce((s, t) => s + t.weight, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(r.cashWeight).toBeCloseTo(0, 5);
  });

  it('keeps an unsignaled asset at its base weight', () => {
    const r = tiltTargets(base, [sig({ assetId: BTC, action: 'trim', rsi: 70 })]);
    const eth = r.details.find((d) => d.assetId === ETH)!;
    expect(eth.conviction).toBe(0);
    expect(eth.tiltedWeight).toBeCloseTo(0.5, 5);
  });

  it('reports per-asset detail', () => {
    const r = tiltTargets(base, [sig({ assetId: BTC, action: 'exit' })]);
    const btc = r.details.find((d) => d.assetId === BTC)!;
    expect(btc).toMatchObject({ action: 'exit', baseWeight: 0.5 });
    expect(btc.conviction).toBe(-1);
  });
});
