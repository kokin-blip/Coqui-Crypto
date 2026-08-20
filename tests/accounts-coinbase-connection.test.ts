import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMemorySecretStore,
  type CoinbaseCredentials,
  type CoinbaseReadHttpClient,
  type HttpResult,
  type SecretStore,
} from '../packages/adapters/src/index.js';
import { sha256Hex } from '../packages/core/src/index.js';
import {
  CoinbaseConnectionService,
  createCoinbaseViewOnlyVerifier,
  createProfileOperationGate,
  type CoinbaseCredentialVerifier,
} from '../packages/services/src/index.js';
import {
  createFileProfileManifestStore,
  type ProfileManifestStore,
  type ProfileManifestV1,
} from '../packages/storage/src/index.js';

const OTHER_ID = '00000000-0000-4000-8000-000000000001';
const PORTFOLIO_A = '11111111-1111-4111-8111-111111111111';
const PORTFOLIO_B = '22222222-2222-4222-8222-222222222222';
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function credentials(label: string): CoinbaseCredentials {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    keyName: 'organizations/example/apiKeys/' + label,
    privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
  };
}

function manifest(): ProfileManifestV1 {
  return {
    version: 1,
    activeProfileId: 'main',
    profiles: [
      {
        id: 'main', name: 'Main', color: '#60a5fa', icon: 'wallet',
        dbFilename: 'kokintrader.db', createdAt: 1, lastOpenedAt: 1, order: 0,
      },
      {
        id: OTHER_ID, name: 'Other', color: '#34d399', icon: 'star',
        dbFilename: 'wallet-' + OTHER_ID + '.db', createdAt: 1, lastOpenedAt: 1, order: 1,
      },
    ],
  };
}

function fixture(options: {
  secretStore?: SecretStore;
  verifier?: CoinbaseCredentialVerifier;
  manifestStore?: ProfileManifestStore;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'coqui-coinbase-connection-'));
  temporaryDirectories.push(root);
  const fileStore = createFileProfileManifestStore(join(root, 'wallet-profiles.json'));
  expect(fileStore.replace(null, manifest()).ok).toBe(true);
  const secretStore = options.secretStore ?? createMemorySecretStore();
  const verifier = options.verifier ?? {
    verify: vi.fn(async () => ({ ok: true as const, portfolioUuid: PORTFOLIO_A })),
  };
  const service = new CoinbaseConnectionService({
    clock: { nowMs: () => 100 },
    manifestStore: options.manifestStore ?? fileStore,
    secretStore,
    verifier,
    operationGate: createProfileOperationGate(),
  });
  return { fileStore, secretStore, verifier, service };
}

describe('Coinbase connection service', () => {
  it('publishes only verified view-only identity and returns no credential material', async () => {
    const target = fixture();
    const input = credentials('first-key');

    const result = await target.service.connect('main', input);

    expect(result).toEqual({
      ok: true,
      value: {
        asOfMs: 100,
        profileId: 'main',
        provider: 'coinbase',
        state: 'connected',
        reasonCode: null,
        permissionMode: 'view_only',
        portfolioIdentityVerified: true,
        readOnly: true,
        executionAuthority: false,
        transferAuthority: false,
        receiveAuthority: false,
      },
    });
    const loaded = target.fileStore.read();
    if (!loaded.ok || !loaded.value) throw new Error('Expected manifest.');
    expect(loaded.value.manifest.profiles[0]).toEqual(expect.objectContaining({
      coinbaseKeyFingerprint: sha256Hex(input.keyName),
      coinbasePortfolioFingerprint: sha256Hex(PORTFOLIO_A),
    }));
    expect(await target.secretStore.read('coinbase-credentials', 'main')).toEqual({
      ok: true,
      value: JSON.stringify({
        keyName: input.keyName,
        privateKey: input.privateKey.trim(),
      }),
    });
    expect(await target.service.status('main')).toEqual(result);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(input.keyName);
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(serialized).not.toContain(sha256Hex(input.keyName));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value)).toBe(true);
  });

  it('parses bounded key-file JSON locally and rejects malformed input before verification', async () => {
    const target = fixture();
    const input = credentials('json-key');

    await expect(target.service.connectJson('main', JSON.stringify({
      name: input.keyName,
      privateKey: input.privateKey,
      unrelated: 'not retained',
    }))).resolves.toMatchObject({ ok: true });
    await expect(target.service.connectJson('main', '{"privateKey":"secret"}')).resolves.toEqual({
      ok: false,
      issues: [{ path: ['credentials'], code: 'invalid_coinbase_key_file' }],
    });
    expect(target.verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate key and portfolio identities without writing another scoped secret', async () => {
    const target = fixture();
    const first = credentials('duplicate-key');
    expect((await target.service.connect('main', first)).ok).toBe(true);

    const sameKey = await target.service.connect(OTHER_ID, first);
    expect(sameKey).toEqual({
      ok: false,
      issues: [{ path: [], code: 'duplicate_coinbase_connection' }],
    });

    const differentKey = credentials('other-key');
    const samePortfolio = await target.service.connect(OTHER_ID, differentKey);
    expect(samePortfolio).toEqual(sameKey);
    expect(await target.secretStore.read('coinbase-credentials', OTHER_ID)).toEqual({
      ok: true, value: null,
    });
  });

  it('restores the prior scoped credential after manifest publication conflict', async () => {
    const base = fixture();
    await base.secretStore.write('coinbase-credentials', 'previous-secret', 'main');
    const conflictStore: ProfileManifestStore = {
      read: base.fileStore.read,
      replace: () => ({ ok: false, code: 'conflict' }),
    };
    const target = fixture({ manifestStore: conflictStore, secretStore: base.secretStore });

    expect(await target.service.connect('main', credentials('replacement'))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_store_conflict' }],
    });
    expect(await base.secretStore.read('coinbase-credentials', 'main')).toEqual({
      ok: true, value: 'previous-secret',
    });
    const loaded = base.fileStore.read();
    if (!loaded.ok || !loaded.value) throw new Error('Expected manifest.');
    expect(loaded.value.manifest.profiles[0]).not.toHaveProperty('coinbaseKeyFingerprint');
  });

  it('reports recovery required when a failed publication cannot restore the prior secret', async () => {
    const base = fixture();
    let writes = 0;
    const secretStore: SecretStore = {
      read: async () => ({ ok: true, value: 'previous-secret' }),
      write: async () => {
        writes += 1;
        return writes === 1
          ? { ok: true }
          : { ok: false, code: 'unavailable', message: 'safe' };
      },
      remove: async () => ({ ok: true }),
    };
    const conflictStore: ProfileManifestStore = {
      read: base.fileStore.read,
      replace: () => ({ ok: false, code: 'conflict' }),
    };
    const target = fixture({ manifestStore: conflictStore, secretStore });

    expect(await target.service.connect('main', credentials('ambiguous'))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'coinbase_connection_recovery_required' }],
    });
  });

  it('derives credential/manifest mismatch states without returning stored bytes', async () => {
    const target = fixture();
    const loaded = target.fileStore.read();
    if (!loaded.ok || !loaded.value) throw new Error('Expected manifest.');
    expect(target.fileStore.replace(loaded.value.revision, {
      ...loaded.value.manifest,
      profiles: loaded.value.manifest.profiles.map((item) => item.id === 'main'
        ? {
          ...item,
          coinbaseKeyFingerprint: 'a'.repeat(64),
          coinbasePortfolioFingerprint: 'b'.repeat(64),
        }
        : item),
    }).ok).toBe(true);

    expect(await target.service.status('main')).toEqual({
      ok: true,
      value: expect.objectContaining({
        state: 'attention_required', reasonCode: 'credential_missing',
        permissionMode: 'unknown', portfolioIdentityVerified: false,
      }),
    });
    const stored = credentials('mismatch-secret');
    await target.secretStore.write('coinbase-credentials', JSON.stringify(stored), 'main');
    const mismatch = await target.service.status('main');
    expect(mismatch).toEqual({
      ok: true,
      value: expect.objectContaining({
        state: 'attention_required', reasonCode: 'identity_mismatch',
      }),
    });
    expect(JSON.stringify(mismatch)).not.toContain(stored.keyName);
  });

  it('disconnects only the scoped secret and manifest identity, with an idempotent result', async () => {
    const target = fixture();
    const input = credentials('disconnect-key');
    expect((await target.service.connect('main', input)).ok).toBe(true);

    const disconnected = await target.service.disconnect('main');

    expect(disconnected).toEqual({
      ok: true,
      value: expect.objectContaining({
        profileId: 'main', state: 'disconnected', reasonCode: null,
        executionAuthority: false,
      }),
    });
    expect(await target.secretStore.read('coinbase-credentials', 'main')).toEqual({
      ok: true, value: null,
    });
    const loaded = target.fileStore.read();
    if (!loaded.ok || !loaded.value) throw new Error('Expected manifest.');
    expect(loaded.value.manifest.profiles[0]).not.toHaveProperty('coinbaseKeyFingerprint');
    expect(loaded.value.manifest.profiles[0]).not.toHaveProperty('coinbasePortfolioFingerprint');
    expect(await target.service.disconnect('main')).toEqual(disconnected);
  });

  it('restores the scoped secret when disconnect manifest publication conflicts', async () => {
    const base = fixture();
    const input = credentials('disconnect-conflict');
    expect((await base.service.connect('main', input)).ok).toBe(true);
    const before = await base.secretStore.read('coinbase-credentials', 'main');
    const conflictStore: ProfileManifestStore = {
      read: base.fileStore.read,
      replace: () => ({ ok: false, code: 'conflict' }),
    };
    const target = fixture({ manifestStore: conflictStore, secretStore: base.secretStore });

    expect(await target.service.disconnect('main')).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_store_conflict' }],
    });
    expect(await base.secretStore.read('coinbase-credentials', 'main')).toEqual(before);
    expect(await base.service.status('main')).toEqual({
      ok: true,
      value: expect.objectContaining({ state: 'connected', reasonCode: null }),
    });
  });

  it('distinguishes an unavailable secret backend from corrupt stored credential state', async () => {
    const base = fixture();
    const storeWith = (code: 'unavailable' | 'corrupt'): SecretStore => ({
      read: async () => ({ ok: false, code, message: 'safe' }),
      write: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
    });
    const unavailable = fixture({
      manifestStore: base.fileStore,
      secretStore: storeWith('unavailable'),
    });
    const corrupt = fixture({
      manifestStore: base.fileStore,
      secretStore: storeWith('corrupt'),
    });

    expect(await unavailable.service.status('main')).toEqual({
      ok: true,
      value: expect.objectContaining({
        state: 'unavailable', reasonCode: 'secret_store_unavailable',
      }),
    });
    expect(await corrupt.service.status('main')).toEqual({
      ok: true,
      value: expect.objectContaining({
        state: 'attention_required', reasonCode: 'credential_invalid',
      }),
    });
  });

  it('fails validation, missing profile, and pre-aborted requests before secret mutation', async () => {
    const target = fixture();
    const invalid = credentials('invalid');
    invalid.privateKey = 'secret-invalid-key';

    expect(await target.service.connect('main', invalid)).toEqual({
      ok: false,
      issues: [{ path: ['privateKey'], code: 'invalid_private_key' }],
    });
    expect(await target.service.connect(
      '00000000-0000-4000-8000-000000000099',
      credentials('missing'),
    )).toEqual({
      ok: false,
      issues: [{ path: ['profileId'], code: 'profile_not_found' }],
    });
    const controller = new AbortController();
    controller.abort();
    expect(await target.service.connect('main', credentials('cancelled'), controller.signal))
      .toEqual({
        ok: false,
        issues: [{ path: [], code: 'coinbase_verification_cancelled' }],
      });
    expect(target.verifier.verify).not.toHaveBeenCalled();
    expect(await target.secretStore.read('coinbase-credentials', 'main')).toEqual({
      ok: true, value: null,
    });
  });
});

describe('Coinbase view-only verifier adapter', () => {
  it('requires the official four permission flags, forwards cancellation, and destroys the client', async () => {
    const calls: Array<{ url: string; signal: AbortSignal | null }> = [];
    const controller = new AbortController();
    const responses: HttpResult<unknown>[] = [
      {
        ok: true,
        status: 200,
        data: {
          can_view: true, can_trade: false, can_transfer: false, can_receive: false,
          portfolio_uuid: PORTFOLIO_B,
        },
      },
      { ok: true, status: 200, data: { accounts: [] } },
    ];
    const destroy = vi.fn();
    const client: CoinbaseReadHttpClient = {
      getJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, signal: init?.signal ?? null });
        return responses.shift() as HttpResult<T>;
      },
      destroy,
    };
    const verifier = createCoinbaseViewOnlyVerifier(() => client);

    expect(await verifier.verify(credentials('probe'), controller.signal)).toEqual({
      ok: true, portfolioUuid: PORTFOLIO_B,
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.signal === controller.signal)).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('contains client exceptions and rejects missing portfolio identity', async () => {
    const invalidIdentity: CoinbaseReadHttpClient = {
      getJson: async <T>(url: string) => ({
        ok: true,
        status: 200,
        data: (url.includes('key_permissions')
          ? { can_view: true, can_trade: false, can_transfer: false, can_receive: false }
          : { accounts: [] }) as T,
      }),
      destroy: vi.fn(),
    };
    expect(await createCoinbaseViewOnlyVerifier(() => invalidIdentity)
      .verify(credentials('no-portfolio'))).toEqual({
      ok: false, reasonCode: 'invalid_portfolio_identity',
    });
    expect(await createCoinbaseViewOnlyVerifier(() => {
      throw new Error('secret factory error');
    }).verify(credentials('throw'))).toEqual({
      ok: false, reasonCode: 'unexpected_failure',
    });
  });
});
