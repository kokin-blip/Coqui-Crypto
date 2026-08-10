import { describe, expect, it } from 'vitest';
import { walkForwardSelection } from '../packages/core/src/validation/walk-forward.js';

/** n daily returns averaging `mean` with tiny ± noise so Sharpe is well-defined. */
function seg(mean: number, n: number, noise = 0.0005): number[] {
  return Array.from({ length: n }, (_, i) => mean + (i % 2 === 0 ? noise : -noise));
}

describe('walkForwardSelection', () => {
  it('flags insufficient data when folds do not have enough days', () => {
    const r = walkForwardSelection(
      { A: seg(0.01, 15), B: seg(0.002, 15) },
      { passive: seg(0.002, 15), hold: seg(0.001, 15) },
      4,
      20,
    );
    expect(r.verdict).toBe('insufficient_data');
    expect(r.perFold).toHaveLength(0);
  });

  it('credits adaptive selection when one track is consistently best out-of-sample', () => {
    const active = { A: seg(0.01, 60), B: seg(0.002, 60), C: seg(0.001, 60), D: seg(0.0, 60) };
    const r = walkForwardSelection(active, { passive: seg(0.002, 60), hold: seg(0.001, 60) }, 3, 10);
    expect(r.oosFolds).toBe(2);
    expect(r.perFold).toHaveLength(2);
    // Prior data always points at A → look-ahead-free selection lands on the real winner.
    expect(r.perFold.every((f) => f.selected === 'A')).toBe(true);
    expect(r.walkForwardReturnPct).toBeGreaterThan(r.passiveReturnPct);
    expect(r.walkForwardReturnPct).toBeGreaterThan(r.holdReturnPct);
    expect(r.verdict).toBe('adds_value');
    // Oracle (hindsight best each fold) is an upper bound on the walk-forward pick.
    expect(r.oracleReturnPct).toBeGreaterThanOrEqual(r.walkForwardReturnPct - 1e-6);
  });

  it('penalizes chasing when last period’s winner reverses (selection lags passive)', () => {
    // A wins the first fold, then collapses; steady passive beats the chased leader.
    const A = [...seg(0.02, 20), ...seg(-0.01, 40)];
    const B = [...seg(-0.01, 20), ...seg(-0.008, 40)];
    const r = walkForwardSelection({ A, B }, { passive: seg(0.004, 60), hold: seg(0.002, 60) }, 3, 10);
    expect(r.perFold[0]!.selected).toBe('A'); // picked from the first fold only
    expect(r.walkForwardReturnPct).toBeLessThan(r.passiveReturnPct);
    expect(r.verdict).toBe('lags_passive');
  });

  it('is deterministic and reports one selection per out-of-sample fold', () => {
    const active = { A: seg(0.005, 100), B: seg(0.004, 100) };
    const bench = { passive: seg(0.004, 100), hold: seg(0.002, 100) };
    const a = walkForwardSelection(active, bench, 4, 20);
    const b = walkForwardSelection(active, bench, 4, 20);
    expect(a).toEqual(b);
    expect(a.oosFolds).toBe(3);
    expect(a.perFold.map((f) => f.fold)).toEqual([1, 2, 3]);
  });
});
