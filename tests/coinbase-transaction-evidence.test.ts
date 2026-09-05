import { describe, expect, it, vi } from 'vitest';

import {
  fetchCoinbaseTransactionEvidence,
  type CoinbaseReadHttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';
import { decimal, type CoinbaseAccountEvidence } from '../packages/core/src/index.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const accounts: readonly CoinbaseAccountEvidence[] = [{
  accountUuid: ACCOUNT_ID,
  currency: 'BTC',
  availableQuantity: decimal('1'), holdQuantity: decimal('0'), totalQuantity: decimal('1'),
  active: true, ready: true, defaultAccount: true, providerUpdatedAtMs: null,
}];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'transaction-1', type: 'advanced_trade_fill', status: 'completed',
    amount: { amount: '-0.100000000000000001', currency: 'BTC' },
    native_amount: { amount: '-5000.00000000000001', currency: 'USD' },
    created_at: '2026-08-10T12:00:00Z', updated_at: '2026-08-10T12:00:01Z',
    resource_path: '/v2/accounts/example/transactions/transaction-1',
    ...overrides,
  };
}

function success(data: unknown): HttpResult<unknown> {
  return { ok: true, status: 200, data };
}

function client(results: readonly HttpResult<unknown>[]) {
  const queue = [...results];
  return {
    getJson: vi.fn(async () => queue.shift() ?? success({ pagination: {}, data: [] })),
  } as unknown as Pick<CoinbaseReadHttpClient, 'getJson'>;
}

describe('Coinbase transaction evidence adapter', () => {
  it('paginates each account and preserves signed decimal text', async () => {
    const http = client([
      success({
        pagination: { next_uri: `/v2/accounts/${ACCOUNT_ID}/transactions?limit=100&starting_after=one` },
        data: [row()],
      }),
      success({ pagination: { next_uri: null }, data: [row()] }),
    ]);

    const result = await fetchCoinbaseTransactionEvidence(http, accounts);

    expect(result).toEqual({
      ok: true,
      pageCount: 2,
      rows: [{
        transactionId: 'transaction-1', accountUuid: ACCOUNT_ID,
        type: 'advanced_trade_fill', status: 'completed',
        amount: '-0.100000000000000001', amountCurrency: 'BTC',
        nativeAmount: '-5000.00000000000001', nativeCurrency: 'USD',
        createdAtMs: Date.parse('2026-08-10T12:00:00Z'),
        updatedAtMs: Date.parse('2026-08-10T12:00:01Z'),
        resourcePath: '/v2/accounts/example/transactions/transaction-1',
      }],
    });
    expect(http.getJson).toHaveBeenNthCalledWith(
      2,
      `https://api.coinbase.com/v2/accounts/${ACCOUNT_ID}/transactions?limit=100&starting_after=one`,
      undefined,
    );
  });

  it('rejects cross-origin pagination and malformed financial values', async () => {
    await expect(fetchCoinbaseTransactionEvidence(client([success({
      pagination: { next_uri: 'https://evil.example/v2/accounts/x/transactions' }, data: [],
    })]), accounts)).resolves.toEqual({ ok: false, code: 'invalid_response' });

    await expect(fetchCoinbaseTransactionEvidence(client([success({
      pagination: {}, data: [row({ amount: { amount: '1e-8', currency: 'BTC' } })],
    })]), accounts)).resolves.toEqual({ ok: false, code: 'invalid_response' });
  });

  it('accepts the documented omission of updated_at', async () => {
    const result = await fetchCoinbaseTransactionEvidence(client([success({
      pagination: {}, data: [row({ updated_at: undefined })],
    })]), accounts);
    expect(result.ok && result.rows[0]?.updatedAtMs).toBeNull();
  });

  it('normalizes thrown transport failures without exposing their messages', async () => {
    const http = { getJson: vi.fn(async () => { throw new Error('secret response body'); }) };
    await expect(fetchCoinbaseTransactionEvidence(
      http as unknown as Pick<CoinbaseReadHttpClient, 'getJson'>,
      accounts,
    )).resolves.toEqual({ ok: false, code: 'network' });
  });
});
