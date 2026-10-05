import { describe, expect, it, vi } from 'vitest';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';
import { validateParallelPositions, parallelAttemptsResolved } from '../packages/services/src/paper/parallel-paper-recovery.js';
import { reconcileParallelPaper } from '../packages/services/src/paper/parallel-paper-reconciliation.js';
import { parallelPaperFailureDetail } from '../packages/services/src/paper/parallel-paper-utils.js';
import { finalizeParallelSlots } from '../packages/services/src/paper/parallel-paper-slots.js';
import { activeParallelEvents, supersedeUnsubmittedParallelPlans } from '../packages/services/src/paper/parallel-paper-plans.js';
import { parallelReconciliationAttention } from '../packages/services/src/paper/parallel-paper-attention.js';
import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';

const start = Date.parse('2026-10-02T00:00:00Z');
const experiment = { id: 'e', profileId: 'main', startedAt: start } as ParallelPaperExperiment;
let sequence = 0;
function event(kind: string, detail: Record<string, unknown>, at = start): ParallelPaperEvent {
  return { id: `e-${sequence++}`, experimentId: 'e', profileId: 'main', kind, detail, at };
}
function filledHistory() {
  return [event('external_intent', { clientOrderId: 'client', symbol: 'BTCUSD', side: 'buy', qty: '1' }),
    event('submit_attempt', { clientOrderId: 'client' }),
    event('external_order', { clientOrderId: 'client', orderId: 'broker', status: 'filled', filledQty: '1', symbol: 'BTCUSD', side: 'buy' }),
    event('external_fill', { orderId: 'broker', symbol: 'BTC/USD', quantity: '1', price: '100' })];
}

describe('complete paper recovery evidence', () => {
  it('requires exactly matching recorded fills and positions, including delayed crypto fees', async () => {
    const history = filledHistory();
    const client = { positions: async () => [{ symbol: 'BTCUSD', qty: '0.999' }] };
    expect(parallelAttemptsResolved(history)).toBe(true);
    await expect(validateParallelPositions({ positions: async () => [{ symbol: 'ETHUSD', qty: '1' }] } as never,
      [...history.slice(0, -1), event('external_fill', { orderId: 'broker', symbol: 'ETHUSD', quantity: '1' })])).rejects.toThrow('broker_positions_mismatch');
    await expect(validateParallelPositions(client as never, history)).rejects.toMatchObject({ message: 'broker_positions_mismatch', operation: 'positions' });
    history.push(event('external_fee', { symbol: 'BTCUSD', quantity: '-0.001' }));
    await expect(validateParallelPositions(client as never, history)).resolves.toBeUndefined();
    await expect(validateParallelPositions({ positions: async () => [] } as never, history)).rejects.toThrow('broker_positions_mismatch');
    await expect(validateParallelPositions({ positions: async () => [{ symbol: 'DOGEUSD', qty: '1' }] } as never, history)).rejects.toThrow('broker_positions_mismatch');
    expect(parallelAttemptsResolved([...history, event('external_fill', { orderId: 'broker', quantity: '0.1' })])).toBe(false);
  });

  it('does not declare a truncated activity audit complete and records its operation', async () => {
    const history: ParallelPaperEvent[] = [];
    const activities = vi.fn(async () => Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, activity_type: 'FILL' })));
    await expect(reconcileParallelPaper({ experiment, client: { activities } as never,
      events: () => history, now: () => start, append: (kind, _key, detail) => history.push(event(kind, detail)) }))
      .rejects.toMatchObject({ message: 'alpaca_activity_page_limit', operation: 'activities' });
    expect(activities).toHaveBeenCalledTimes(20);
    expect(history.some((item) => item.kind === 'activity_audit' || item.detail['operation'] === 'broker_reconciliation')).toBe(false);
  });

  it('rejects a client ID lookup returning a different order identity', async () => {
    const history = filledHistory().slice(0, 2);
    await expect(reconcileParallelPaper({ experiment,
      client: { orderByClientId: async () => ({ client_order_id: 'different', symbol: 'BTCUSD', side: 'buy' }) } as never,
      events: () => history, now: () => start, append: vi.fn() }))
      .rejects.toMatchObject({ message: 'broker_order_identity_mismatch', operation: 'order_lookup' });
  });

  it('keeps uncertainty visible after twenty later activity entries', () => {
    const history = filledHistory().slice(0, 2);
    history.push(event('paused', { reason: 'paper_execution_unknown' }));
    history.push(event('reconciliation_error', { reason: 'alpaca_rate_limited', operation: 'activities', httpStatus: 429, attemptCount: 1 }));
    for (let i = 0; i < 25; i++) history.push(event('scheduler_check', {}));
    expect(parallelReconciliationAttention(history, 'paused')).toMatchObject({ blocked: true,
      latestFailure: { operation: 'activities', reason: 'alpaca_rate_limited', httpStatus: 429 },
      unresolvedOrders: [{ clientOrderId: 'client', orderId: null }] });
    expect(CHANNEL_SCHEMAS['parallel.paper.reconcile'].request.safeParse({ commandId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
  });

  it('retires only unsubmitted intents while preserving attempted IDs and all history', () => {
    const history = filledHistory();
    const plan = event('buy_plan', { day: '2026-10-01', orders: [{ clientOrderId: 'client' }, { clientOrderId: 'unsubmitted' }] });
    history.push(plan, event('external_intent', { clientOrderId: 'unsubmitted' }));
    supersedeUnsubmittedParallelPlans(history, (kind, _key, detail) => history.push(event(kind, detail)));
    const active = activeParallelEvents(history);
    expect(active.some((item) => item.detail['clientOrderId'] === 'unsubmitted')).toBe(false);
    expect(active.some((item) => item.kind === 'submit_attempt' && item.detail['clientOrderId'] === 'client')).toBe(true);
    expect(history).toContain(plan);
    const append = vi.fn(); supersedeUnsubmittedParallelPlans(history, append);
    expect(append).not.toHaveBeenCalled();
  });
});

describe('definitive slot outcomes', () => {
  it('records gaps on restart once, without replaying any slot', () => {
    const history = [event('started', {}), event('scheduler_check', {}), event('external_complete', { day: '2026-10-01' })];
    const append = (kind: string, _key: string, detail: Record<string, unknown>) => history.push(event(kind, detail, start + 9 * 3_600_000));
    finalizeParallelSlots(experiment, history, start + 9 * 3_600_000, append);
    expect(history.filter((item) => item.kind === 'slot_finalized').map((item) => item.detail['outcome']))
      .toEqual(['no_order', 'host_unavailable', 'host_unavailable']);
    expect(history.at(-1)?.detail['inferred']).toBe(true);
    const size = history.length;
    finalizeParallelSlots(experiment, history, start + 10 * 3_600_000, append);
    expect(history).toHaveLength(size);
  });

  it('reports acknowledgments without fill activity as pending at the cutoff', () => {
    const history = [...filledHistory().slice(0, -1), event('scheduler_check', {}),
      event('external_complete', { day: '2026-10-01' })];
    finalizeParallelSlots(experiment, history, start + 900_000,
      (kind, _key, detail) => history.push(event(kind, detail)));
    expect(history.at(-1)?.detail['outcome']).toBe('pending_order');
  });

  it('distinguishes stale quotes, pauses, and completed recovery before cutoff', () => {
    const history = [event('started', {}), event('scheduler_check', {}), event('paused', { reason: 'paper_execution_unknown' }),
      event('scheduler_check', {}, start + 4 * 3_600_000),
      event('intraday_skipped', { reason: 'stale_alpaca_quote' }, start + 4 * 3_600_000),
      event('resumed', {}, start + 8 * 3_600_000), event('scheduler_check', {}, start + 8 * 3_600_000),
      event('intraday_complete', { slot: '2026-10-02T08' }, start + 8 * 3_600_000)];
    finalizeParallelSlots(experiment, history, start + 9 * 3_600_000,
      (kind, _key, detail) => history.push(event(kind, detail)));
    expect(history.filter((item) => item.kind === 'slot_finalized').map((item) => item.detail['outcome']))
      .toEqual(['paused', 'stale_quote', 'no_order']);
  });
});

it('retains exact position differences without granting order authority', async () => {
  const history=filledHistory();
  try { await validateParallelPositions({positions:async()=>[{symbol:'BTCUSD',qty:'0.999'}]} as never,history); throw new Error('expected mismatch'); }
  catch(error){
    const detail=parallelPaperFailureDetail(error,'unavailable');
    expect(detail).toMatchObject({reason:'broker_positions_mismatch',operation:'positions',positionDifferences:[{symbol:'BTCUSD',expectedQty:'1',observedQty:'0.999',differenceQty:'-0.001'}]});
    history.push(event('paused',{reason:'broker_positions_mismatch'}),event('reconciliation_error',detail));
    expect(parallelReconciliationAttention(history,'paused')).toMatchObject({blocked:true,latestFailure:{positionDifferences:detail.positionDifferences}});
  }
});
