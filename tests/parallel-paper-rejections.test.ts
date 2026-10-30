import { describe, expect, it, vi } from 'vitest';
import { AlpacaPaperError, createAlpacaPaperClient } from '../packages/adapters/src/index.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';
import { reconcileParallelPaper } from '../packages/services/src/paper/parallel-paper-reconciliation.js';
import { parallelAttemptsResolved } from '../packages/services/src/paper/parallel-paper-recovery.js';
import { parallelRefusalReceipts, parallelRejectedSubmissions, recordParallelRefusal } from '../packages/services/src/paper/parallel-paper-rejections.js';
import { parallelReconciliationAttention } from '../packages/services/src/paper/parallel-paper-attention.js';
import { observedParallelClient } from '../packages/services/src/paper/parallel-execution-safety.js';
import { executeParallelIntraday } from '../packages/services/src/paper/parallel-paper-intraday.js';
import { executeParallelDaily } from '../packages/services/src/paper/parallel-paper-daily.js';

const at = Date.parse('2026-10-22T04:00:27Z');
const experiment = { id: 'study', profileId: 'main', startedAt: at - 86_400_000 } as ParallelPaperExperiment;
function fixture(receipt = true) {
  const history: ParallelPaperEvent[] = [];
  const append = (kind: string, key: string, detail: Record<string, unknown>) => {
    if (!history.some(event => event.id === key)) history.push({ id: key, kind, detail, at,
      profileId: 'main', experimentId: 'study' });
  };
  append('external_intent', 'intent', { clientOrderId: 'buy', symbol: 'BTCUSD', side: 'buy',
    qty: '1', day: '2026-10-21', slot: '2026-10-22T04' });
  append('submit_attempt', 'attempt', { clientOrderId: 'buy' });
  if (receipt) append('readiness', 'receipt', { operation: 'submit', status: 'unavailable',
    httpStatus: 403, reason: 'alpaca_forbidden', attemptCount: 1 });
  append('paused', 'pause', { reason: 'submission_outcome_unknown' });
  const client = { orderByClientId: vi.fn(async () => { throw new AlpacaPaperError('not_found', 'order_lookup', 404); }),
    activities: vi.fn(async () => [] as Record<string, unknown>[]), submit: vi.fn() };
  const reconcile = () => reconcileParallelPaper({ experiment, client: client as never, events: () => history,
    now: () => at, append });
  return { history, append, client, reconcile };
}

describe('refused paper submissions', () => {
  it('recovers the legacy submit-403/lookup-404 incident only after a full audit, without a retry or fabricated fill', async () => {
    const { history, client, reconcile } = fixture();
    expect(parallelAttemptsResolved(history)).toBe(false);
    await reconcile();
    expect(client.activities).toHaveBeenCalledExactlyOnceWith('2026-10-21T00:00:00.000Z', undefined, true);
    expect(parallelAttemptsResolved(history)).toBe(true);
    expect(parallelReconciliationAttention(history, 'paused').unresolvedOrders).toEqual([]);
    expect(history.some(event => event.kind === 'external_fill' || event.kind === 'external_order' || event.kind === 'resumed')).toBe(false);
    await reconcile();
    expect(history.filter(event => event.kind === 'submission_rejected')).toHaveLength(1);
    expect(client.submit).not.toHaveBeenCalled();
  });
  it.each([null, 401, 422, 429, 500, 503])('keeps missing orders uncertain without an original submit 403 (%s)', async status => {
    const { history, client, reconcile } = fixture();
    history.find(event => event.id === 'receipt')!.detail['httpStatus'] = status;
    await expect(reconcile()).rejects.toThrow('submission_outcome_unknown');
    expect(parallelAttemptsResolved(history)).toBe(false);
    expect(client.activities).not.toHaveBeenCalled();
  });
  it.each(['account', 'order_lookup', 'cancel'])('does not associate a %s refusal with an order submission', async operation => {
    const { history, reconcile } = fixture();
    history.find(event => event.id === 'receipt')!.detail['operation'] = operation;
    await expect(reconcile()).rejects.toThrow('submission_outcome_unknown');
  });
  it('keeps timeouts, broken bodies, duplicate attempts, and stale or incorrectly bound receipts uncertain', async () => {
    for (const change of [
      (h: ParallelPaperEvent[]) => { h.find(e => e.id === 'receipt')!.detail['reason'] = 'alpaca_timeout'; },
      (h: ParallelPaperEvent[]) => { h.find(e => e.id === 'receipt')!.detail['networkCode'] = 'ECONNRESET'; },
      (h: ParallelPaperEvent[]) => { h.push({ ...h[1]!, id: 'duplicate' }); },
      (h: ParallelPaperEvent[]) => { h[2] = { ...h[2]!, at: at + 10_001 }; },
    ]) {
      const { history, reconcile } = fixture(); change(history);
      await expect(reconcile()).rejects.toThrow('submission_outcome_unknown');
      expect(parallelAttemptsResolved(history)).toBe(false);
    }
  });
  it('does not retire the attempt after an incomplete, failed, or foreign-fill activity audit', async () => {
    for (const mode of ['failed', 'foreign', 'truncated']) {
      const { history, client, reconcile } = fixture();
      client.activities.mockImplementation(async () => {
        if (mode === 'failed') throw new AlpacaPaperError('unavailable', 'activities', 503);
        if (mode === 'foreign') return [{ id: 'foreign', activity_type: 'FILL', order_id: 'unknown', transaction_time: new Date(at).toISOString() }];
        return Array.from({ length: 100 }, (_, i) => ({ id: String(i), activity_type: 'OTHER' }));
      });
      await expect(reconcile()).rejects.toThrow();
      expect(parallelAttemptsResolved(history)).toBe(false);
      expect(history.some(event => event.kind === 'submission_rejected')).toBe(false);
    }
  });
  it('blocks contradictory broker acceptance, including partial fills, even after a refusal was audited', async () => {
    const { history, client, append, reconcile } = fixture(); await reconcile();
    client.orderByClientId.mockImplementation(async () => ({ id: 'broker', client_order_id: 'buy', symbol: 'BTC/USD', side: 'buy', status: 'partially_filled', filled_qty: '0.1' }) as never);
    await expect(reconcile()).rejects.toThrow('broker_order_identity_mismatch');
    append('external_order', 'contradiction', { clientOrderId: 'buy', orderId: 'broker', status: 'partially_filled', filledQty: '0.1' });
    expect(parallelAttemptsResolved(history)).toBe(false);
    append('external_order', 'filled-contradiction', { clientOrderId: 'buy', orderId: 'broker', status: 'filled', filledQty: '1' });
    append('external_fill', 'fill', { orderId: 'broker', symbol: 'BTCUSD', quantity: '1', price: '100' });
    expect(parallelAttemptsResolved(history)).toBe(false);
    await expect(reconcile()).rejects.toThrow('broker_order_identity_mismatch');
  });
  it('rejects stored resolution markers without their original receipt or completed audit', async () => {
    const { history, reconcile } = fixture(); await reconcile();
    for (const kind of ['readiness', 'activity_audit']) {
      expect(parallelAttemptsResolved(history.filter(event => event.kind !== kind))).toBe(false);
    }
    expect(parallelRejectedSubmissions(history)).toEqual(new Set(['buy']));
  });
  it('never replays a retired leg in the same daily or intraday execution window', async () => {
    const { history, client, append, reconcile } = fixture(); await reconcile();
    const decision = { ...history[0]!, kind: 'decision', detail: { day: '2026-10-21', weights: {} } };
    await executeParallelIntraday({ experimentId: 'study', nowMs: at, decision, client: client as never,
      events: () => history, append });
    await executeParallelDaily({ experiment, today: '2026-10-22', day: '2026-10-21', preparation: {} as never,
      client: client as never, events: () => history, append, now: () => Date.parse('2026-10-22T00:01:00Z'), beforeSubmit: vi.fn() });
    expect(client.submit).not.toHaveBeenCalled();
    expect(history.some(event => ['intraday_complete', 'external_complete'].includes(event.kind))).toBe(false);
  });
  it('retains only safe structured refusal diagnostics through the observation wrapper and journal', async () => {
    const secret = 'private-key-DO-NOT-LOG';
    const fetcher = vi.fn(async () => Response.json({ code: 40310000, message: `insufficient buying power ${secret}`, buying_power: secret },
      { status: 403, headers: { 'x-request-id': 'cfd483b7-c4b9-4a73-9379-737b04d31afa' } }));
    const client = createAlpacaPaperClient({ keyId: secret, secretKey: secret }, fetcher);
    const { history, append } = fixture(false);
    const observed = observedParallelClient(client, () => at, append);
    try { await observed.submit({ client_order_id: 'buy', symbol: 'BTCUSD', side: 'buy', qty: '1' }); }
    catch (error) { expect(recordParallelRefusal(error, history, append)).toBe(true); }
    expect(history.find(event => event.kind === 'submission_refused')?.detail['rejection']).toEqual({ providerCode: 40310000,
      reason: 'insufficient_buying_power', requestId: 'cfd483b7-c4b9-4a73-9379-737b04d31afa' });
    expect(parallelRefusalReceipts(history).has('buy')).toBe(true);
    expect(JSON.stringify(history)).not.toContain(secret);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recordParallelRefusal(new AlpacaPaperError('timeout', 'submit', 403), history, append)).toBe(false);
  });
});
