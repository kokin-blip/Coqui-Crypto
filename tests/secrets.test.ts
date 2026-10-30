import { describe, expect, it, vi } from 'vitest';

import {
  createCachedSecretStore,
  createMemorySecretStore,
  createOsKeyringSecretStore,
  MAIN_WALLET_ID,
  MAX_SECRET_BYTES,
  parseStoredCoinbaseCredentials,
  migrateConnectionSecretAlias,
  migrateLegacyConnectionSecret,
  readConnectionSecret,
  removeConnectionSecret,
  readStoredCoinbaseCredentials,
  SECRET_STORE_SERVICE,
  secretAccountForScope,
  serializeCoinbaseCredentials,
  writeConnectionSecret,
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

describe('connection-scoped secrets', () => {
  const first = {
    profileId: 'profile-a', connectionId: 'connection-a', provider: 'coinbase',
    credentialType: 'api_credentials',
  } as const;

  it('migrates on explicit first access using write, verify, remove ordering', async () => {
    const events: string[] = [];
    const values = new Map([['coinbase-credentials:profile-a', 'legacy-secret']]);
    const store = createCachedSecretStore({
      async get(account) { events.push(`get:${account}`); return values.get(account) ?? null; },
      async set(account, value) { events.push(`set:${account}`); values.set(account, value); },
      async delete(account) { events.push(`delete:${account}`); values.delete(account); },
    });
    await expect(migrateLegacyConnectionSecret(store, first)).resolves.toEqual({
      ok: true, value: 'legacy-secret',
    });
    const setIndex = events.findIndex((event) => event.startsWith('set:'));
    const deleteIndex = events.findIndex((event) => event === 'delete:coinbase-credentials:profile-a');
    expect(setIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(setIndex);
    expect(values.has('coinbase-credentials:profile-a')).toBe(false);
    expect(await readConnectionSecret(store, first)).toEqual({ ok: true, value: 'legacy-secret' });
  });

  it('deletes only the requested connection credential', async () => {
    const store = createMemorySecretStore();
    const second = { ...first, connectionId: 'connection-b' };
    await store.write('coinbase-credentials', 'one', 'v2.profile-a.connection-a.coinbase.api_credentials');
    await store.write('coinbase-credentials', 'two', 'v2.profile-a.connection-b.coinbase.api_credentials');
    await removeConnectionSecret(store, first);
    expect(await readConnectionSecret(store, first)).toEqual({ ok: true, value: null });
    expect(await readConnectionSecret(store, second)).toEqual({ ok: true, value: 'two' });
  });

  it('moves a v1 connection identity to v2 using write, verify, remove ordering', async () => {
    const events: string[] = [];
    const values = new Map<string, string>();
    const store = createCachedSecretStore({
      async get(account) { events.push(`get:${account}`); return values.get(account) ?? null; },
      async set(account, value) { events.push(`set:${account}`); values.set(account, value); },
      async delete(account) { events.push(`delete:${account}`); values.delete(account); },
    });
    const replacement = { ...first, connectionId: 'connection-v2', schemaVersion: 2 as const };
    await writeConnectionSecret(store, first, 'connection-scoped-secret');
    events.length = 0;
    await expect(migrateConnectionSecretAlias(store, first, replacement)).resolves.toEqual({
      ok: true, value: 'connection-scoped-secret',
    });
    expect(events.findIndex((event) => event.includes('.connection-v2.') && event.startsWith('set:')))
      .toBeLessThan(events.findIndex((event) => event.includes('.connection-a.') && event.startsWith('delete:')));
    expect(await readConnectionSecret(store, first)).toEqual({ ok: true, value: null });
    expect(await readConnectionSecret(store, replacement)).toEqual({
      ok: true, value: 'connection-scoped-secret',
    });
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
  it.each(['resolve', 'reject'])('retries a hung read and ignores its late %s result', async outcome => {
    vi.useFakeTimers();
    try {
      let resolveOld!: (value: string) => void, rejectOld!: (reason: Error) => void;
      const get = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve, reject) => {
        resolveOld = resolve; rejectOld = reject;
      })).mockResolvedValue('fresh-paper-key');
      const store = createCachedSecretStore({ get, set: async () => {}, delete: async () => {} });
      const first = store.read('alpaca-paper-credentials'), second = store.read('alpaca-paper-credentials');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await first).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await second).toEqual(await first); expect(get).toHaveBeenCalledOnce();
      expect(await store.read('alpaca-paper-credentials')).toEqual({ ok: true, value: 'fresh-paper-key' });
      await store.write('alpaca-paper-credentials', 'newer-paper-key');
      if (outcome === 'resolve') resolveOld('stale-private-material'); else rejectOld(new Error('private backend error'));
      await vi.advanceTimersByTimeAsync(0);
      expect(await store.read('alpaca-paper-credentials')).toEqual({ ok: true, value: 'newer-paper-key' });
      expect(get).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
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

  it('retries backend failures without exposing backend messages or secrets', async () => {
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
    expect(reads).toBe(2);
  });

  it('recovers on the next read after a temporary keychain failure', async () => {
    let reads = 0;
    const store = createCachedSecretStore({
      async get() {
        reads += 1;
        if (reads === 1) throw new Error('keychain temporarily locked');
        return 'paper-key';
      },
      async set() {},
      async delete() {},
    });
    await expect(store.read('alpaca-paper-credentials')).resolves.toMatchObject({ ok: false, code: 'unavailable' });
    await expect(store.read('alpaca-paper-credentials')).resolves.toEqual({ ok: true, value: 'paper-key' });
    await expect(store.read('alpaca-paper-credentials')).resolves.toEqual({ ok: true, value: 'paper-key' });
    expect(reads).toBe(2);
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
  it('does not reuse a native read across credential removal or resurrect its late value', async () => {
    let finish!: (value: string) => void;
    const getPassword = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }))
      .mockResolvedValue(null);
    const store = createOsKeyringSecretStore(async () => ({ getPassword,
      setPassword: async () => {}, deletePassword: async () => true }));
    const oldRead = store.read('alpaca-paper-credentials');
    await vi.waitFor(() => expect(getPassword).toHaveBeenCalledOnce());
    await store.remove('alpaca-paper-credentials');
    expect(await store.read('alpaca-paper-credentials')).toEqual({ ok: true, value: null });
    finish('removed-private-material'); await oldRead;
    expect(await store.read('alpaca-paper-credentials')).toEqual({ ok: true, value: null });
    expect(getPassword).toHaveBeenCalledTimes(2);
  });
  it('bounds repeated cache waits without queuing more uncancellable native reads', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: string) => void;
      const getPassword = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
      const store = createOsKeyringSecretStore(async () => ({ getPassword,
        setPassword: async () => {}, deletePassword: async () => true }));
      const first = store.read('alpaca-paper-credentials'); await vi.advanceTimersByTimeAsync(10_000);
      expect(await first).toMatchObject({ ok: false, code: 'unavailable' });
      const next = store.read('alpaca-paper-credentials'); await vi.advanceTimersByTimeAsync(1);
      expect(getPassword).toHaveBeenCalledOnce();
      finish('existing-paper-key'); await vi.advanceTimersByTimeAsync(0);
      expect(await next).toEqual({ ok: true, value: 'existing-paper-key' });
      expect(await store.read('alpaca-paper-credentials')).toEqual({ ok: true, value: 'existing-paper-key' });
    } finally { vi.useRealTimers(); }
  });
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

  it('retries a failed native loader on the next secret read', async () => {
    let calls = 0;
    const store = createOsKeyringSecretStore(async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary loader failure');
      return { getPassword: async () => 'paper-key', setPassword: async () => {},
        deletePassword: async () => true };
    });
    await expect(store.read('alpaca-paper-credentials')).resolves.toMatchObject({ ok: false, code: 'unavailable' });
    await expect(store.read('alpaca-paper-credentials')).resolves.toEqual({ ok: true, value: 'paper-key' });
    expect(calls).toBe(2);
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
