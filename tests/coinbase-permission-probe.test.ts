import { describe, expect, it, vi } from 'vitest';

import {
  probeCoinbaseViewOnlyPermissions,
  type CoinbaseReadHttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';

function clientWith(results: HttpResult<unknown>[]): {
  client: CoinbaseReadHttpClient;
  getJson: ReturnType<typeof vi.fn>;
} {
  const getJson = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return results.shift()!;
  });
  return {
    client: {
      getJson: async <T>(url: string, init?: RequestInit) =>
        await getJson(url, init) as HttpResult<T>,
      destroy: () => {},
    },
    getJson,
  };
}

describe('probeCoinbaseViewOnlyPermissions', () => {
  it('checks permissions before proving account reads', async () => {
    const fake = clientWith([
      {
        ok: true,
        status: 200,
        data: {
          can_view: true,
          can_trade: false,
          can_transfer: false,
          can_receive: false,
          portfolio_uuid: ' portfolio-one ',
        },
      },
      { ok: true, status: 200, data: { accounts: [] } },
    ]);

    const result = await probeCoinbaseViewOnlyPermissions(fake.client);

    expect(result).toEqual({
      ok: true,
      portfolioUuid: 'portfolio-one',
      diagnostics: {
        permissionHttpStatus: 200,
        accountsHttpStatus: 200,
        traceId: null,
      },
    });
    expect(fake.getJson.mock.calls.map(([url]) => url)).toEqual([
      'https://api.coinbase.com/api/v3/brokerage/key_permissions',
      'https://api.coinbase.com/api/v3/brokerage/accounts?limit=1',
    ]);
  });

  it.each([
    { can_view: true, can_trade: true, can_transfer: false, can_receive: false },
    { can_view: true, can_trade: false, can_transfer: true, can_receive: false },
    { can_view: true, can_trade: false, can_transfer: false, can_receive: true },
    { can_view: true, can_trade: true, can_transfer: true, can_receive: true },
  ])('rejects transaction-capable keys before reading accounts', async (permissions) => {
    const fake = clientWith([{ ok: true, status: 200, data: permissions }]);

    const result = await probeCoinbaseViewOnlyPermissions(fake.client);

    expect(result).toMatchObject({ ok: false, code: 'excess_permissions' });
    expect(fake.getJson).toHaveBeenCalledOnce();
  });

  it('fails closed when Coinbase omits any permission flag', async () => {
    const fake = clientWith([{
      ok: true,
      status: 200,
      data: { can_view: true, can_trade: false, can_receive: false },
    }]);

    const result = await probeCoinbaseViewOnlyPermissions(fake.client);

    expect(result).toMatchObject({ ok: false, code: 'invalid_permissions' });
    expect(fake.getJson).toHaveBeenCalledOnce();
  });

  it('rejects a key without View permission', async () => {
    const fake = clientWith([{
      ok: true,
      status: 200,
      data: { can_view: false, can_trade: false, can_transfer: false, can_receive: false },
    }]);
    await expect(probeCoinbaseViewOnlyPermissions(fake.client)).resolves.toMatchObject({
      ok: false,
      code: 'missing_view_permission',
    });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
  ] as const)('classifies HTTP %i without exposing a response body', async (status, code) => {
    const fake = clientWith([{
      ok: false,
      status,
      reason: 'http',
      retried: 0,
      traceId: 'safe-trace',
    }]);

    const result = await probeCoinbaseViewOnlyPermissions(fake.client);

    expect(result).toMatchObject({
      ok: false,
      code,
      diagnostics: { traceId: 'safe-trace' },
    });
  });

  it('requires a valid accounts response after permission success', async () => {
    const fake = clientWith([
      {
        ok: true,
        status: 200,
        data: { can_view: true, can_trade: false, can_transfer: false, can_receive: false },
      },
      { ok: true, status: 200, data: { unexpected: [] } },
    ]);

    await expect(probeCoinbaseViewOnlyPermissions(fake.client)).resolves.toMatchObject({
      ok: false,
      code: 'accounts_unreadable',
    });
  });

  it('classifies successful-status parse failures by probe stage', async () => {
    const permissions = clientWith([{
      ok: false,
      status: 200,
      reason: 'parse',
      retried: 0,
    }]);
    await expect(probeCoinbaseViewOnlyPermissions(permissions.client)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_permissions',
    });

    const accounts = clientWith([
      {
        ok: true,
        status: 200,
        data: { can_view: true, can_trade: false, can_transfer: false, can_receive: false },
      },
      { ok: false, status: 200, reason: 'parse', retried: 0 },
    ]);
    await expect(probeCoinbaseViewOnlyPermissions(accounts.client)).resolves.toMatchObject({
      ok: false,
      code: 'accounts_unreadable',
    });
  });

  it.each([
    ['canceled', 'cancelled'],
    ['shutdown', 'shutdown'],
    ['elapsed-budget', 'elapsed_budget_exhausted'],
  ] as const)('classifies %s without exposing transport detail', async (reason, code) => {
    const fake = clientWith([{
      ok: false, status: 0, reason, retried: 0,
    }]);
    await expect(probeCoinbaseViewOnlyPermissions(fake.client)).resolves.toMatchObject({
      ok: false, code,
    });
  });
});
