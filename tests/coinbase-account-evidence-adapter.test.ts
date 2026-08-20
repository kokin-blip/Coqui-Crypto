import { describe, expect, it, vi } from 'vitest';

import {
  fetchCoinbaseAccountEvidence,
  type CoinbaseReadHttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function account(overrides: Record<string, unknown> = {}) {
  return {
    uuid: ACCOUNT_ID,
    currency: 'BTC',
    available_balance: { value: '0.100000000000000001', currency: 'BTC' },
    hold: { value: '0.200000000000000002', currency: 'BTC' },
    default: true,
    active: true,
    ready: true,
    updated_at: '2026-08-10T12:00:00.123456Z',
    ...overrides,
  };
}

function fill(overrides: Record<string, unknown> = {}) {
  return {
    trade_id: 'trade-1', order_id: 'order-1', product_id: 'BTC-USD',
    trade_type: 'FILL', side: 'BUY', price: '50000.01', size: '0.1',
    commission: '1.25', size_in_quote: false,
    trade_time: '2026-08-10T12:01:00Z',
    sequence_timestamp: '2026-08-10T12:01:00.000001Z',
    ...overrides,
  };
}

function success(data: unknown): HttpResult<unknown> {
  return { ok: true, status: 200, data };
}

function client(results: readonly HttpResult<unknown>[]) {
  const queue = [...results];
  const getJson = vi.fn(async () => queue.shift() ?? success({ has_next: false }));
  return { getJson } as unknown as Pick<CoinbaseReadHttpClient, 'getJson'>;
}

describe('Coinbase account evidence adapter', () => {
  it('paginates accounts and fills, deduplicates exact rows, and freezes normalized evidence', async () => {
    const http = client([
      success({ accounts: [account()], has_next: true, cursor: 'next/account=' }),
      success({ accounts: [account()], has_next: false, cursor: '' }),
      success({ fills: [fill()], has_next: true, cursor: 'fill-next' }),
      success({ fills: [fill()], has_next: false, cursor: null }),
    ]);
    const result = await fetchCoinbaseAccountEvidence(http);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ accountPageCount: 2, fillPageCount: 2 });
    expect(result.value.accounts).toEqual([{
      accountUuid: ACCOUNT_ID,
      currency: 'BTC',
      availableQuantity: '0.100000000000000001',
      holdQuantity: '0.200000000000000002',
      totalQuantity: '0.300000000000000003',
      active: true, ready: true, defaultAccount: true,
      providerUpdatedAtMs: Date.parse('2026-08-10T12:00:00.123456Z'),
    }]);
    expect(result.value.fills[0]).toMatchObject({
      tradeId: 'trade-1', orderId: 'order-1', productId: 'BTC-USD',
      price: '50000.01', size: '0.1', commission: '1.25', side: 'BUY',
    });
    expect(result.value.datasetHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.accounts)).toBe(true);
    expect(Object.isFrozen(result.value.accounts[0])).toBe(true);
    expect(http.getJson).toHaveBeenNthCalledWith(
      2, expect.stringContaining('cursor=next%2Faccount%3D'), undefined,
    );
    expect(http.getJson).toHaveBeenNthCalledWith(
      3, expect.stringContaining('product_types=SPOT'), undefined,
    );
  });

  it('still fetches fill evidence when the provider has no accounts', async () => {
    const http = client([
      success({ accounts: [], has_next: false }),
      success({ fills: [fill()], has_next: false, proof_token_required: false }),
    ]);
    const result = await fetchCoinbaseAccountEvidence(http);
    expect(result.ok && result.value.accounts).toEqual([]);
    expect(result.ok && result.value.fills).toHaveLength(1);
  });

  it.each([
    ['bad account decimal', account({ available_balance: { value: '1e-8', currency: 'BTC' } })],
    ['currency mismatch', account({ hold: { value: '0', currency: 'ETH' } })],
    ['malformed timestamp', account({ updated_at: 'August 10, 2026' })],
    ['impossible calendar date', account({ updated_at: '2026-02-30T12:00:00Z' })],
    ['missing boolean', account({ ready: undefined })],
  ])('rejects %s', async (_label, malformed) => {
    const result = await fetchCoinbaseAccountEvidence(client([
      success({ accounts: [malformed], has_next: false }),
    ]));
    expect(result).toEqual({ ok: false, code: 'invalid_response', resource: 'accounts' });
  });

  it('preserves a missing authoritative account timestamp as null', async () => {
    const result = await fetchCoinbaseAccountEvidence(client([
      success({ accounts: [account({ updated_at: undefined })], has_next: false }),
      success({ fills: [], has_next: false }),
    ]));
    expect(result.ok && result.value.accounts[0]?.providerUpdatedAtMs).toBeNull();
  });

  it('fails closed on conflicting duplicate fill identities', async () => {
    const result = await fetchCoinbaseAccountEvidence(client([
      success({ accounts: [], has_next: false }),
      success({ fills: [fill()], has_next: true, cursor: 'two' }),
      success({ fills: [fill({ price: '50001' })], has_next: false }),
    ]));
    expect(result).toEqual({ ok: false, code: 'conflicting_duplicate', resource: 'fills' });
  });

  it('fails closed on cursor cycles and proof-token requirements', async () => {
    const cycle = await fetchCoinbaseAccountEvidence(client([
      success({ accounts: [], has_next: true, cursor: 'same' }),
      success({ accounts: [], has_next: true, cursor: 'same' }),
    ]));
    expect(cycle).toEqual({ ok: false, code: 'pagination_cycle', resource: 'accounts' });
    const proof = await fetchCoinbaseAccountEvidence(client([
      success({ accounts: [], has_next: false }),
      success({ fills: [], has_next: false, proof_token_required: true }),
    ]));
    expect(proof).toEqual({ ok: false, code: 'proof_token_required', resource: 'fills' });
    const malformedProof = await fetchCoinbaseAccountEvidence(client([
      success({ accounts: [], has_next: false }),
      success({ fills: [], has_next: false, proof_token_required: 'yes' }),
    ]));
    expect(malformedProof).toEqual({ ok: false, code: 'invalid_response', resource: 'fills' });
  });

  it('forwards cancellation and maps bounded HTTP failures without diagnostics', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await fetchCoinbaseAccountEvidence(client([]), controller.signal)).toEqual({
      ok: false, code: 'cancelled', resource: 'accounts',
    });
    const failure: HttpResult<unknown> = {
      ok: false, status: 429, reason: 'http', retried: 3, traceId: 'secret-ish-trace',
    };
    expect(await fetchCoinbaseAccountEvidence(client([failure]))).toEqual({
      ok: false, code: 'rate_limited', resource: 'accounts',
    });
    const throwing = {
      getJson: vi.fn(async () => { throw new Error('secret-bearing network detail'); }),
    } as unknown as Pick<CoinbaseReadHttpClient, 'getJson'>;
    expect(await fetchCoinbaseAccountEvidence(throwing)).toEqual({
      ok: false, code: 'network', resource: 'accounts',
    });
  });
});
