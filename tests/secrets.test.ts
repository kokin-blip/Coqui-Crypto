import { describe, expect, it, vi } from 'vitest';

import {
  createCachedSecretStore,
  createMemorySecretStore,
  createOsKeyringSecretStore,
  MAIN_WALLET_ID,
  MAX_SECRET_BYTES,
  parseStoredCoinbaseCredentials,
  readStoredCoinbaseCredentials,
  SECRET_STORE_SERVICE,
  secretAccountForScope,
  serializeCoinbaseCredentials,
  type SecretBackend,
} from '../packages/adapters/src/index.js';

describe('secret account compatibility', () => {
  it('preserves the predecessor service and wallet-scoped account names', () => {
    expect(SECRET_STORE_SERVICE).toBe('kokincrypto');
    expect(secretAccountForScope(null, 'coinbase-credentials')).toBe(
      'coinbase-credentials',
    );
    expect(secretAccountForScope(MAIN_WALLET_ID, 'coinbase-credentials')).toBe(
      'coinbase-credentials',
    );
    expect(secretAccountForScope('wallet-2', 'coinbase-credentials')).toBe(
      'coinbase-credentials:wallet-2',
    );
  });

  it('keeps the optional CoinGecko key app-wide', () => {
    expect(secretAccountForScope('wallet-2', 'coingecko-api-key')).toBe(
      'coingecko-api-key',
    );
  });

  it('keeps the optional CoinMarketCap key app-wide', () => {
    expect(secretAccountForScope('wallet-2', 'coinmarketcap-api-key')).toBe(
      'coinmarketcap-api-key',
    );
  });

  it('scopes the advisor key without changing the predecessor main account', () => {
    expect(secretAccountForScope(null, 'gemini-api-key')).toBe('gemini-api-key');
    expect(secretAccountForScope('family-a', 'gemini-api-key')).toBe(
      'gemini-api-key:family-a',
    );
  });
});

describe('createMemorySecretStore', () => {
  it('reads, writes, isolates wallet scope, and removes values', async () => {
    const store = createMemorySecretStore();
    await expect(store.write('coinbase-credentials', 'main-secret')).resolves.toEqual({
      ok: true,
    });
    await expect(store.write(
      'coinbase-credentials',
      'other-secret',
      'wallet-2',
    )).resolves.toEqual({ ok: true });
    await expect(store.read('coinbase-credentials')).resolves.toEqual({
      ok: true,
      value: 'main-secret',
    });
    await expect(store.read('coinbase-credentials', 'wallet-2')).resolves.toEqual({
      ok: true,
      value: 'other-secret',
    });
    await store.remove('coinbase-credentials');
    await expect(store.read('coinbase-credentials')).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it('rejects empty, oversized, and invalidly scoped writes', async () => {
    const store = createMemorySecretStore();
    await expect(store.write('coinbase-credentials', '')).resolves.toMatchObject({
      ok: false,
      code: 'invalid_value',
    });
    await expect(store.write(
      'coinbase-credentials',
      'x'.repeat(MAX_SECRET_BYTES + 1),
    )).resolves.toMatchObject({ ok: false, code: 'invalid_value' });
    await expect(store.write(
      'coinbase-credentials',
      'secret',
      'bad:scope',
    )).resolves.toMatchObject({ ok: false, code: 'invalid_value' });
  });
});

describe('createCachedSecretStore', () => {
  function backend() {
    const values = new Map<string, string>();
    let reads = 0;
    const raw: SecretBackend = {
      async get(account) {
        reads += 1;
        await Promise.resolve();
        return values.get(account) ?? null;
      },
      async set(account, value) {
        values.set(account, value);
      },
      async delete(account) {
        values.delete(account);
      },
    };
    return { raw, values, readCount: () => reads };
  }

  it('deduplicates concurrent reads and caches missing values', async () => {
    const raw = backend();
    const store = createCachedSecretStore(raw.raw);
    expect(await Promise.all([
      store.read('coinbase-credentials'),
      store.read('coinbase-credentials'),
    ])).toEqual([
      { ok: true, value: null },
      { ok: true, value: null },
    ]);
    await store.read('coinbase-credentials');
    expect(raw.readCount()).toBe(1);
  });

  it('caches backend failures without exposing backend messages or secrets', async () => {
    const secret = 'private-material-from-backend';
    let reads = 0;
    const store = createCachedSecretStore({
      async get() {
        reads += 1;
        throw new Error(`Keychain rejected ${secret}`);
      },
      async set() {
        throw new Error(secret);
      },
      async delete() {
        throw new Error(secret);
      },
    });

    const first = await store.read('coinbase-credentials');
    const second = await store.read('coinbase-credentials');
    expect(first).toEqual({
      ok: false,
      code: 'unavailable',
      message: 'Secure credential storage is unavailable.',
    });
    expect(second).toEqual(first);
    expect(JSON.stringify([first, second])).not.toContain(secret);
    expect(reads).toBe(1);
  });

  it('a successful write replaces a cached read failure', async () => {
    let fail = true;
    const store = createCachedSecretStore({
      async get() {
        if (fail) throw new Error('denied');
        return 'backend-value';
      },
      async set() {
        fail = false;
      },
      async delete() {},
    });
    await expect(store.read('coinbase-credentials')).resolves.toMatchObject({ ok: false });
    await expect(store.write('coinbase-credentials', 'replacement')).resolves.toEqual({
      ok: true,
    });
    await expect(store.read('coinbase-credentials')).resolves.toEqual({
      ok: true,
      value: 'replacement',
    });
  });
});

describe('createOsKeyringSecretStore', () => {
  it('uses asynchronous native entries with exact service and account identity', async () => {
    const calls: string[] = [];
    const values = new Map<string, string>();
    const loader = vi.fn(async () => ({
      async getPassword(service: string, account: string) {
        calls.push(`${service}/${account}/get`);
        return values.get(account) ?? null;
      },
      async setPassword(service: string, account: string, value: string) {
        calls.push(`${service}/${account}/set`);
        values.set(account, value);
      },
      async deletePassword(service: string, account: string) {
        calls.push(`${service}/${account}/delete`);
        return values.delete(account);
      },
    }));
    const store = createOsKeyringSecretStore(loader);

    await store.write('coinbase-credentials', 'encrypted-by-os', 'wallet-2');
    await expect(store.read('coinbase-credentials', 'wallet-2')).resolves.toEqual({
      ok: true,
      value: 'encrypted-by-os',
    });
    await store.remove('coinbase-credentials', 'wallet-2');

    expect(loader).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      'kokincrypto/coinbase-credentials:wallet-2/set',
      'kokincrypto/coinbase-credentials:wallet-2/delete',
    ]);
  });

  it('fails closed when the native credential manager cannot load', async () => {
    const secret = 'native-loader-detail';
    const store = createOsKeyringSecretStore(async () => {
      throw new Error(secret);
    });
    const result = await store.read('coinbase-credentials');
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('stored Coinbase credential record', () => {
  it('round-trips only the key name and private key', async () => {
    const credentials = {
      keyName: 'organizations/example/apiKeys/key-id',
      privateKey: 'private-key-material',
    };
    const serialized = serializeCoinbaseCredentials(credentials);
    expect(parseStoredCoinbaseCredentials(serialized)).toEqual(credentials);
    const store = createMemorySecretStore({ 'coinbase-credentials': serialized });
    await expect(readStoredCoinbaseCredentials(store)).resolves.toEqual({
      ok: true,
      credentials,
    });
  });

  it('reports corruption without returning stored material', async () => {
    const malformed = '{"keyName":"key","privateKey":""}';
    const store = createMemorySecretStore({ 'coinbase-credentials': malformed });
    const result = await readStoredCoinbaseCredentials(store);
    expect(result).toEqual({
      ok: false,
      code: 'corrupt',
      message: 'Stored Coinbase credentials are invalid.',
    });
    expect(JSON.stringify(result)).not.toContain(malformed);
  });
});
