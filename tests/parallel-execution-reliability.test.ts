import { describe, expect, it, vi } from 'vitest';
import { createAlpacaPaperClient, createRequestDeadline, AlpacaPaperError } from '../packages/adapters/src/index.js';
import { observedParallelClient } from '../packages/services/src/paper/parallel-execution-safety.js';
import { parallelAttemptsResolved, prepareParallelPass } from '../packages/services/src/paper/parallel-paper-recovery.js';
import { parallelPaperFailureDetail } from '../packages/services/src/paper/parallel-paper-utils.js';
import { FixedClock } from '../packages/core/src/index.js';
import type { ParallelPaperEvent } from '../packages/storage/src/index.js';

const credentials = { keyId: 'test-key', secretKey: 'test-secret' };
describe('paper read reliability', () => {
  it('never treats an arbitrary lowercase secret as a safe error code', () => {
    expect(parallelPaperFailureDetail(new Error('sensitive_secret'), 'broker_read_failed')).toEqual({ reason: 'broker_read_failed' });
    expect(parallelPaperFailureDetail(new Error('deadline_exceeded'), 'broker_read_failed')).toEqual({ reason: 'deadline_exceeded' });
  });
  it('wraps the actual frozen adapter, receives account and activity reads, and exposes no secrets', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/account') ? { id: 'paper' } : []));
    const journal: unknown[] = [];
    const client = createAlpacaPaperClient(credentials, fetcher);
    expect(Object.isFrozen(client)).toBe(true);
    const observed = observedParallelClient(client, () => 1000, (_kind, _key, detail) => journal.push(detail));
    expect(await observed.account()).toEqual({ id: 'paper' });
    expect(await observed.activities('2026-10-01')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(journal).toMatchObject([{ operation: 'account', status: 'received' }, { operation: 'activities', status: 'received' }]);
    expect(JSON.stringify(journal)).not.toContain(credentials.secretKey);
    expect(JSON.stringify(journal)).not.toContain('paper-api');
  });
  it('records safe failure metadata and preserves the failed operation', async () => {
    const append = vi.fn();
    const client = observedParallelClient(createAlpacaPaperClient(credentials, async () => new Response('sensitive', { status: 503 })),
      () => 1000, append);
    await expect(client.positions()).rejects.toMatchObject({ code: 'unavailable', operation: 'positions', httpStatus: 503, attemptCount: 2 });
    expect(append.mock.calls[0]?.[2]).toMatchObject({ operation: 'positions', reason: 'alpaca_unavailable', httpStatus: 503, attemptCount: 2 });
    expect(JSON.stringify(append.mock.calls)).not.toContain('sensitive');
  });
  it('bounds a stalled body, retries reads at most once, and never retries ambiguous submissions', async () => {
    vi.useFakeTimers();
    try {
      const response = Response.json({});
      response.json = async () => new Promise(() => {});
      const fetcher = vi.fn(async () => response);
      const client = createAlpacaPaperClient(credentials, fetcher);
      const read = expect(client.account()).rejects.toMatchObject({ code: 'timeout', operation: 'account', attemptCount: 2 });
      await vi.advanceTimersByTimeAsync(10_001); await read;
      expect(fetcher).toHaveBeenCalledTimes(2);
      fetcher.mockClear();
      const write = expect(client.submit({ symbol: 'BTCUSD', side: 'buy', qty: '1', client_order_id: 'deterministic' }))
        .rejects.toMatchObject({ code: 'timeout', operation: 'submit', attemptCount: 1 });
      await vi.advanceTimersByTimeAsync(5_001); await write;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('records deadline exhaustion before invoking an operation or losing its name', async () => {
    const deadline = createRequestDeadline(() => 1000, 1000), append = vi.fn(), fetcher = vi.fn();
    deadline.dispose();
    const client = observedParallelClient(createAlpacaPaperClient(credentials, fetcher, deadline), () => 1000, append, deadline);
    await expect(client.account()).rejects.toMatchObject({ code: 'deadline_exceeded', operation: 'account' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(append.mock.calls[0]?.[2]).toMatchObject({ operation: 'account', remainingMs: expect.any(Number) });
  });
  it('caps preparation at ten seconds and reserves fifteen seconds without extending a cutoff', async () => {
    let wall = 1000;
    const deadline = createRequestDeadline(() => wall, 30_000, 31_000);
    const refreshFor = vi.fn(async (_at: number, child?: { remainingMs(): number }) => {
      expect(child!.remainingMs()).toBeLessThanOrEqual(10_000);
      expect(deadline.remainingMs()).toBeGreaterThan(15_000);
      return { ok: false as const, code: 'market_fetch_failed' as const };
    });
    const input = { clock: new FixedClock(1000), refreshFor, preparation: () => ({ ok: false as const, code: 'market_fetch_failed' as const }) };
    await prepareParallelPass(input, deadline);
    wall += 15_001;
    await expect(prepareParallelPass(input, deadline)).rejects.toThrow('deadline_exceeded');
    expect(refreshFor).toHaveBeenCalledTimes(1); deadline.dispose();
    const nearCutoff = createRequestDeadline(() => wall, 30_000, wall + 500);
    await expect(prepareParallelPass(input, nearCutoff)).rejects.toThrow('deadline_exceeded'); nearCutoff.dispose();
  });
  it('cannot recover a legacy generic pause with missing, partial, or unconfirmed attempted orders', () => {
    const event = (kind: string, detail: Record<string, unknown>): ParallelPaperEvent =>
      ({ kind, detail, id: kind, experimentId: 'e', profileId: 'main', at: 1000 });
    const attempt = event('submit_attempt', { clientOrderId: 'known' });
    const order = event('external_order', { clientOrderId: 'known', orderId: 'order', status: 'filled', filledQty: '1' });
    expect(parallelAttemptsResolved([])).toBe(true);
    expect(parallelAttemptsResolved([attempt])).toBe(false);
    expect(parallelAttemptsResolved([attempt, order])).toBe(false);
    expect(parallelAttemptsResolved([attempt, order, event('external_fill', { orderId: 'order', quantity: '0.5' })])).toBe(false);
    expect(parallelAttemptsResolved([attempt, order, event('external_fill', { orderId: 'order', quantity: '1' })])).toBe(true);
  });
  it('retains explicit transport error codes without leaking raw exception text', async () => {
    const client = createAlpacaPaperClient(credentials, async () => { throw new Error('test-secret raw body'); });
    try { await client.activities('2026-10-01'); } catch (error) {
      expect(error).toBeInstanceOf(AlpacaPaperError);
      expect(JSON.stringify(error)).not.toContain('test-secret');
    }
  });
});
