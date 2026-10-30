import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../packages/core/src/index.js';
import { projectParallelPaperActivity } from '../packages/services/src/paper/parallel-paper-activity.js';
import type { ParallelPaperEvent } from '../packages/storage/src/index.js';

function event(kind: string, index: number, detail: Record<string, unknown> = {}): ParallelPaperEvent {
  return { id: sha256Hex(`${kind}:${index}`), profileId: 'main', experimentId: sha256Hex('study'), kind, at: index * 60_000, detail };
}
function wait(index: number, overrides: Record<string, unknown> = {}, kind = 'reconciliation_error') {
  return event(kind, index, { reason: 'broker_positions_mismatch', operation: 'positions',
    pendingFeeEvidence: { status: 'awaiting', oldestFillAtMs: 1, latestFillAtMs: 2, reviewAfterMs: 100 },
    positionDifferences: [{ symbol: 'BTCUSD', expectedQty: '1', observedQty: '0.999', differenceQty: '-0.001' }],
    elapsedMs: index, remainingMs: 30000 - index, ...overrides });
}
describe('fee wait activity episodes', () => {
  it('groups repeated lookup failures while preserving changed failures and recovery boundaries', () => {
    const failure = (index: number, changes = {}) => event('reconciliation_error', index, {
      reason: 'submission_outcome_unknown', operation: 'order_lookup', httpStatus: 404,
      attemptCount: 1, elapsedMs: index, remainingMs: 10000 - index, ...changes });
    const events = [failure(1)];
    for (let i = 2; i <= 200; i++) {
      events.push(event('scheduler_check', i), event('broker_read_attempt', i), event('readiness', i), failure(i));
    }
    const original = JSON.stringify(events);
    expect(projectParallelPaperActivity(events).activity).toEqual([
      expect.objectContaining({ repeatCount: 200, firstAtMs: 60000, atMs: 200 * 60000, title: 'Alpaca order lookup read failed' })]);
    expect(JSON.stringify(events)).toBe(original);
    events.push(failure(201, { httpStatus: 503 }), event('submission_rejected', 202), failure(203),
      event('readiness', 204, { operation: 'broker_reconciliation', status: 'validated' }), failure(205));
    expect(projectParallelPaperActivity(events).activity.filter(row => row.kind === 'retry')).toHaveLength(4);
    events.push(failure(206, { feeReconciliation: { observedValueUsd: '30' } }));
    expect(projectParallelPaperActivity(events).activity.filter(row => row.kind === 'retry')).toHaveLength(5);
  });
  it.each(['reconciliation_error', 'pass_deferred'])('groups hundreds of %s checks before the display limit without mutating evidence', kind => {
    const events = [event('external_fill', 0, { symbol: 'BTCUSD', quantity: '1', price: '100' })];
    for (let i = 1; i <= 300; i++) {
      for (const diagnostic of ['scheduler_check', 'broker_read_attempt', 'readiness', 'broker_position_snapshot',
        'activity_audit_started', 'activity_audit', 'readiness_check']) events.push(event(diagnostic, i));
      events.push(wait(i, {}, kind));
    }
    const before = JSON.stringify(events);
    const activity = projectParallelPaperActivity(events).activity;
    expect(activity).toHaveLength(2);
    expect(activity[0]).toMatchObject({ id: wait(1, {}, kind).id, atMs: 300 * 60000, firstAtMs: 60000,
      repeatCount: 300, title: 'Waiting for fee evidence' });
    expect(activity[1]?.kind).toBe('fill');
    expect(JSON.stringify(events)).toBe(before);
  });
  it.each(['external_fee', 'external_fill', 'external_order', 'paused', 'resumed', 'decision', 'pass_complete'])('starts a new episode after %s', kind => {
    // Decision projections require financial target fields; a policy event is otherwise the same boundary.
    const detail = kind === 'decision' ? { exposure: 1, cashWeight: 0, mixVolPct: 1, weights: {} } : {};
    const activity = projectParallelPaperActivity([wait(1), wait(2), event(kind, 3, detail), wait(4)]).activity;
    expect(activity.filter(row => row.kind === 'retry')).toHaveLength(2);
    expect(activity.find(row => row.repeatCount === 2)?.atMs).toBe(120000);
  });
  it('separates changed quantities, overdue fees, fill ranges, and different read failures', () => {
    const events = [wait(1), wait(2, { positionDifferences: [{ symbol: 'BTCUSD', expectedQty: '1', observedQty: '0.998', differenceQty: '-0.002' }] }),
      wait(3, { pendingFeeEvidence: { status: 'overdue', oldestFillAtMs: 1, latestFillAtMs: 2, reviewAfterMs: 100 } }),
      wait(4, { pendingFeeEvidence: { status: 'overdue', oldestFillAtMs: 1, latestFillAtMs: 3, reviewAfterMs: 100 } }),
      event('reconciliation_error', 5, { reason: 'alpaca_unavailable' }), wait(6)];
    const activity = projectParallelPaperActivity(events).activity;
    expect(activity).toHaveLength(6);
    expect(activity.some(row => row.repeatCount !== undefined)).toBe(false);
    expect(activity.filter(row => row.title.includes('overdue'))).toHaveLength(2);
  });
});
