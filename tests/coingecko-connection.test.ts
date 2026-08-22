import { describe, expect, it } from 'vitest';

import { createMemorySecretStore, type SecretStore } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  CoinGeckoConnectionService,
  type CoinGeckoKeyVerifier,
  type CoinGeckoVerificationResult,
} from '../packages/services/src/index.js';

const T0 = 1_800_000_000_000;
const KEY = 'CG-abcdefgh12345678';

function verifier(result: CoinGeckoVerificationResult = { ok: true }): CoinGeckoKeyVerifier & {
  readonly seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    async verify(apiKey) {
      seen.push(apiKey);
      return result;
    },
  };
}

function service(
  store: SecretStore = createMemorySecretStore(),
  keyVerifier: CoinGeckoKeyVerifier = verifier(),
): CoinGeckoConnectionService {
  return new CoinGeckoConnectionService({
    clock: new FixedClock(T0),
    secretStore: store,
    verifier: keyVerifier,
  });
}

describe('status reports presence and nothing else', () => {
  it('is public with no key', async () => {
    const result = await service().status();
    expect(result).toMatchObject({ ok: true, value: { connected: false, tier: 'public' } });
  });

  it('is demo once a key is stored', async () => {
    const store = createMemorySecretStore();
    await service(store).connect(KEY);

    expect(await service(store).status()).toMatchObject({
      ok: true,
      value: { connected: true, tier: 'demo' },
    });
  });

  it('carries nothing derived from the key', async () => {
    const store = createMemorySecretStore();
    await service(store).connect(KEY);
    const result = await service(store).status();

    // Invariant 3 as a property of the shape: presence is a boolean, and there
    // is no field a length, prefix or hash could hide in.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('CG-');
    expect(serialized).not.toContain(String(KEY.length));
  });
});

describe('a key is verified before it is stored', () => {
  it('stores a key that authenticates', async () => {
    const store = createMemorySecretStore();
    expect(await service(store).connect(KEY)).toMatchObject({ ok: true });
    expect(await store.read('coingecko-api-key', null)).toEqual({ ok: true, value: KEY });
  });

  it('stores nothing when verification is refused', async () => {
    const store = createMemorySecretStore();
    const result = await service(store, verifier({ ok: false, reasonCode: 'unauthorized' }))
      .connect(KEY);

    expect(result).toMatchObject({ ok: false, issues: [{ code: 'verification_unauthorized' }] });
    // A stored key that does not work leaves a "connected" application that
    // cannot fetch anything — a state the user then has to diagnose.
    expect(await store.read('coingecko-api-key', null)).toEqual({ ok: true, value: null });
  });

  it('distinguishes a rate limit from a bad key', async () => {
    // Same refusal to store, different cause. Telling a user their key is
    // invalid when the venue was merely busy sends them to regenerate it.
    expect(
      await service(createMemorySecretStore(), verifier({ ok: false, reasonCode: 'rate_limited' }))
        .connect(KEY),
    ).toMatchObject({ ok: false, issues: [{ code: 'verification_rate_limited' }] });
  });
});

describe('a malformed key never reaches the venue', () => {
  it('refuses locally', async () => {
    const check = verifier();
    const result = await service(createMemorySecretStore(), check).connect('not-a-key');

    expect(result).toMatchObject({ ok: false, issues: [{ code: 'key_malformed' }] });
    // Sending it would put a credential-shaped string in front of a third party
    // for no possible benefit.
    expect(check.seen).toEqual([]);
  });

  it('refuses an empty key distinctly', async () => {
    expect(await service().connect('   ')).toMatchObject({
      ok: false,
      issues: [{ code: 'key_missing' }],
    });
  });
});

describe('disconnecting returns to the public tier', () => {
  it('removes the key', async () => {
    const store = createMemorySecretStore();
    await service(store).connect(KEY);

    expect(await service(store).disconnect()).toMatchObject({
      ok: true,
      value: { connected: false, tier: 'public' },
    });
    expect(await store.read('coingecko-api-key', null)).toEqual({ ok: true, value: null });
  });

  it('succeeds when there was nothing to remove', async () => {
    // The end state is what was asked for, and it is already true.
    expect(await service().disconnect()).toMatchObject({ ok: true, value: { connected: false } });
  });
});
