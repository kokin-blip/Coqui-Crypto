import { describe, expect, it, vi } from 'vitest';

import { createAlpacaPaperHandlers } from '../apps/desktop/src/main/alpaca-paper-handlers.js';
import { createAlpacaPaperClient, createMemorySecretStore } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import { openDatabase } from '../packages/storage/src/index.js';

const KEY_ID = 'paper-key-test';
const SECRET = 'paper-secret-test';
const ACCOUNT = { id: 'paper-account-1234', status: 'PAPER_ONLY', currency: 'USD',
  cash: '100000', equity: '100000', trading_blocked: false, account_blocked: false };

describe('Alpaca paper boundary', () => {
  it('always targets the paper host with the documented header pair', async () => {
    const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return Response.json(ACCOUNT);
    });
    const client = createAlpacaPaperClient({ keyId: KEY_ID, secretKey: SECRET }, fetcher);
    expect(await client.account()).toMatchObject({ id: ACCOUNT.id });
    expect(fetcher).toHaveBeenCalledWith('https://paper-api.alpaca.markets/v2/account',
      expect.objectContaining({ headers: expect.objectContaining({
        'APCA-API-KEY-ID': KEY_ID, 'APCA-API-SECRET-KEY': SECRET,
      }) }));
    await client.orderByClientId('abc-123');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://paper-api.alpaca.markets/v2/orders:by_client_order_id?client_order_id=abc-123');
    expect(fetcher.mock.calls.every((call) => !String(call[0]).includes('https://api.alpaca.markets/'))).toBe(true);
  });

  it('verifies before storing keys and never exposes them in status or database', async () => {
    const database = openDatabase(':memory:');
    const secrets = createMemorySecretStore();
    const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return Response.json(ACCOUNT);
    });
    const handlers = createAlpacaPaperHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), secrets,
      clientFactory: (credentials) => createAlpacaPaperClient(credentials, fetcher) });
    const connect = handlers['alpaca.paper.connect'] as unknown as (payload: unknown) => Promise<unknown>;
    const status = handlers['alpaca.paper.status'] as unknown as () => Promise<unknown>;
    const result = await connect({ commandId: '00000000-0000-4000-8000-000000000001',
      keyId: KEY_ID, secretKey: SECRET });
    expect(result).toMatchObject({ ok: true, value: { state: 'connected', accountSuffix: '1234', paperOnly: true } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(await status())).not.toContain(SECRET);
    expect(JSON.stringify(database.prepare('SELECT * FROM app_settings').all())).not.toContain(SECRET);
    expect(await secrets.read('alpaca-paper-credentials', 'main')).toMatchObject({ ok: true,
      value: JSON.stringify({ keyId: KEY_ID, secretKey: SECRET }) });
    database.close();
  });

  it('rejects live or invalid keys without writing them to the secret store', async () => {
    const database = openDatabase(':memory:');
    const secrets = createMemorySecretStore();
    const handlers = createAlpacaPaperHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), secrets,
      clientFactory: (credentials) => createAlpacaPaperClient(credentials, async () =>
        new Response('', { status: 401 })) });
    const connect = handlers['alpaca.paper.connect'] as unknown as (payload: unknown) => Promise<unknown>;
    expect(await connect({ commandId: '00000000-0000-4000-8000-000000000002',
      keyId: KEY_ID, secretKey: SECRET })).toMatchObject({ ok: false,
      issues: [{ code: 'alpaca_unauthorized' }] });
    expect(await secrets.read('alpaca-paper-credentials', 'main')).toEqual({ ok: true, value: null });
    database.close();
  });

  it('disconnects from paper and signals the experiment to pause', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const paused = vi.fn();
    await secrets.write('alpaca-paper-credentials', JSON.stringify({ keyId: KEY_ID, secretKey: SECRET }), 'main');
    const handlers = createAlpacaPaperHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), secrets, onDisconnect: paused });
    const disconnect = handlers['alpaca.paper.disconnect'] as unknown as () => Promise<unknown>;
    expect(await disconnect()).toMatchObject({ ok: true, value: { state: 'disconnected' } });
    expect(paused).toHaveBeenCalledOnce();
    expect(await secrets.read('alpaca-paper-credentials', 'main')).toEqual({ ok: true, value: null });
    database.close();
  });
});
