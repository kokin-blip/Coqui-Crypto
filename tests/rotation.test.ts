import { describe, expect, it } from 'vitest';
import {
  rotationTargets,
  DEFAULT_ROTATION_CONFIG,
  instrumentKey,
  type RotationConfig,
} from '../packages/core/src/index.js';

const key = (symbol: string) =>
  instrumentKey({ venue: 'coinbase', productId: `${symbol}-USD`, productType: 'spot' });
const UP_BIG = key('UP-BIG');
const UP_SMALL = key('UP-SMALL');
const DOWN = key('DOWN');
const A = key('A');
const B = key('B');
const C = key('C');
const OLD = key('OLD');
const YOUNG = key('YOUNG');
const CALM = key('CALM');
const WILD = key('WILD');

const cfg = (over: Partial<RotationConfig> = {}): RotationConfig => ({
  ...DEFAULT_ROTATION_CONFIG,
  topN: 2,
  lookbackDays: 10,
  volatilityDays: 5,
  holdBufferMultiple: 1,
  ...over,
});

function compound(start: number, dailyReturn: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start * (1 + dailyReturn) ** i);
}

describe('rotationTargets', () => {
  it('selects the strongest risk-adjusted assets and skips negatives', () => {
    const r = rotationTargets(
      {
        [UP_BIG]: compound(100, 0.02, 30),
        [UP_SMALL]: compound(100, 0.005, 30),
        [DOWN]: compound(100, -0.01, 30),
      },
      cfg(),
    );
    expect(r.eligible).toBe(3);
    expect(r.picks.map((p) => p.assetId)).toEqual([UP_BIG, UP_SMALL]);
    expect(r.picks.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
  });

  it('goes fully to cash in an all-down universe (absolute filter)', () => {
    const r = rotationTargets(
      { [A]: compound(100, -0.01, 30), [B]: compound(100, -0.02, 30) },
      cfg(),
    );
    expect(r.picks).toHaveLength(0);
    expect(r.cashWeight).toBe(1);
  });

  it('without the absolute filter, still ranks and holds the least bad', () => {
    const r = rotationTargets(
      { [A]: compound(100, -0.001, 30), [B]: compound(100, -0.02, 30) },
      cfg({ absoluteFilter: false, topN: 1 }),
    );
    expect(r.picks.map((p) => p.assetId)).toEqual([A]);
  });

  it('excludes assets with insufficient history (no survivorship shortcut)', () => {
    const r = rotationTargets(
      { [OLD]: compound(100, 0.01, 30), [YOUNG]: compound(100, 0.05, 5) },
      cfg({ topN: 2 }),
    );
    expect(r.eligible).toBe(1);
    expect(r.picks.map((p) => p.assetId)).toEqual([OLD]);
  });

  it('hold buffer keeps an incumbent that slipped just below the cut', () => {
    // B edges A on rank, C is behind both. With topN 1 and buffer ×2, incumbent
    // A (rank 2 ≤ buffer 2) keeps its seat; without the buffer, B takes over.
    // A shared noise pattern gives all three a comparable, NON-degenerate vol so
    // the risk-adjusted ranking follows return (smooth series rank on fp dust).
    const noisy = (r: number) =>
      compound(100, r, 30).map((v, i) => v * (1 + (i % 2 === 0 ? 0.02 : -0.02)));
    const closes = {
      [A]: noisy(0.01),
      [B]: noisy(0.012),
      [C]: noisy(0.002),
    };
    const withBuffer = rotationTargets(closes, cfg({ topN: 1, holdBufferMultiple: 2 }), [A]);
    expect(withBuffer.picks.map((p) => p.assetId)).toEqual([A]);
    const noBuffer = rotationTargets(closes, cfg({ topN: 1, holdBufferMultiple: 1 }), [A]);
    expect(noBuffer.picks.map((p) => p.assetId)).toEqual([B]);
    // An incumbent that collapsed out of the buffer is still evicted.
    const collapsed = rotationTargets(closes, cfg({ topN: 1, holdBufferMultiple: 2 }), [C]);
    expect(collapsed.picks.map((p) => p.assetId)).toEqual([B]);
  });

  it('inverse-vol weighting gives the calmer pick more weight', () => {
    const calm = compound(100, 0.01, 30);
    const wild = compound(100, 0.01, 30).map((v, i) => v * (1 + (i % 2 === 0 ? 0.05 : -0.045)));
    const r = rotationTargets({ [CALM]: calm, [WILD]: wild }, cfg({ weighting: 'inverse_vol' }));
    const calmW = r.picks.find((p) => p.assetId === CALM)?.weight ?? 0;
    const wildW = r.picks.find((p) => p.assetId === WILD)?.weight ?? 0;
    expect(calmW).toBeGreaterThan(wildW);
  });
});

