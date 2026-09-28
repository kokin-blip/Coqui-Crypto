import { describe, expect, it } from 'vitest';
import { replayExecutionPolicies, type ExecutionObservation } from '../packages/core/src/research/execution-replay.js';
function tape(): ExecutionObservation[] {
  return Array.from({ length: 12 }, (_, i) => ({
    slot: new Date(Date.parse('2026-09-27T00:00:00Z') + i * 4 * 3_600_000).toISOString().slice(0, 13),
    decisionDay: i < 6 ? '2026-09-26' : '2026-09-27', targets: [0.25, 0.25, 0.25],
    quotes: [0, 1, 2].map(() => ({ bid: 99 + i * 2, ask: 101 + i * 2 })),
  }));
}
describe('matched execution replay', () => {
  it('rejects missing slots and changed same-day targets', () => {
    expect(replayExecutionPolicies([]).status).toBe('insufficient_matched_quotes');
    const rows = tape(); rows[4] = rows[3]!;
    expect(replayExecutionPolicies(rows).status).toBe('invalid_or_gapped_tape');
    const changed = tape(); changed[1] = { ...changed[1]!, targets: [0.3, 0.25, 0.25] };
    expect(replayExecutionPolicies(changed).status).toBe('changed_intraday_target');
  });
  it('counts costs and missed favorable moves, preserves cash and reports every variant', () => {
    const result = replayExecutionPolicies(tape());
    expect(result.status).toBe('modeled_replay_only'); expect(result.results).toHaveLength(8);
    expect(result.results.find((r) => r.policy === 'cash')).toMatchObject({ netReturn: 0, orders: 0 });
    const screened = result.results.find((r) => r.policy === 'entry-cost-screen-0.5pct')!;
    expect(screened.orders).toBe(0); expect(screened.missedFavorableMovesUsd).toBeGreaterThan(0);
    const baseline = result.results[0]!;
    expect(baseline.feesUsd).toBeGreaterThan(0); expect(baseline.spreadUsd).toBeGreaterThan(0);
    expect(baseline.slippageUsd).toBeGreaterThan(0); expect(baseline.missedFills).toBeNull();
    expect(replayExecutionPolicies(tape(), 100_000, 2).results[0]!.netReturn).toBeLessThan(baseline.netReturn);
  });
  it('does not use future quotes for earlier execution', () => {
    const original = tape(), changed = tape();
    changed[11] = { ...changed[11]!, quotes: [0, 1, 2].map(() => ({ bid: 199, ask: 201 })) };
    expect(replayExecutionPolicies(original).results[0]!.equityCurve.slice(0, 11))
      .toEqual(replayExecutionPolicies(changed).results[0]!.equityCurve.slice(0, 11));
  });
});
