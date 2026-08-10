import {
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCoinbaseJwt,
  createCoinbaseReadHttpClient,
  fetchCoinbaseClockOffset,
  MAX_COINBASE_KEY_FILE_BYTES,
  parseCoinbaseKeyFileJson,
  validateCoinbaseCredentials,
  type FetchLikeResponse,
  type HttpResult,
  type RateLimiterRegistry,
} from '../packages/adapters/src/index.js';

const NOW = 1_700_000_000_000;
const PATH = '/api/v3/brokerage/accounts';
const KEY_NAME = 'organizations/example/apiKeys/key-id';

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>;
}

function ecdsaCredentials(): {
  credentials: { keyName: string; privateKey: string };
  publicKey: ReturnType<typeof createPublicKey>;
} {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    credentials: {
      keyName: KEY_NAME,
      privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    },
    publicKey: pair.publicKey,
  };
}

function passThroughRateLimiters(): RateLimiterRegistry {
  return {
    forDomain: () => ({
      acquire: async () => {},
      available: () => 1,
      pending: () => 0,
      destroy: () => {},
    }),
    destroyAll: () => {},
  };
}

function response(ok: boolean, status: number, body: unknown): FetchLikeResponse {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => vi.useRealTimers());

describe('Coinbase App JWT authentication', () => {
  it('builds the official ES256 request-bound claim shape and signature', () => {
    const { credentials, publicKey } = ecdsaCredentials();
    const jwt = buildCoinbaseJwt(credentials, PATH, NOW, 'fixture-nonce');
    const [header, payload, signature] = jwt.split('.');

    expect(decode(header!)).toEqual({
      alg: 'ES256',
      typ: 'JWT',
      kid: KEY_NAME,
      nonce: 'fixture-nonce',
    });
    expect(decode(payload!)).toEqual({
      sub: KEY_NAME,
      iss: 'cdp',
      nbf: 1_700_000_000,
      exp: 1_700_000_120,
      uri: `GET api.coinbase.com${PATH}`,
    });
    expect(verify(
      'SHA256',
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    )).toBe(true);
  });

  it('signs every retry freshly and excludes query parameters from the JWT URI', async () => {
    const { credentials } = ecdsaCredentials();
    const authorizations: string[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      return authorizations.length === 1
        ? response(false, 503, {})
        : response(true, 200, { accounts: [] });
    });
    let nonce = 0;
    const client = createCoinbaseReadHttpClient(credentials, {
      fetch,
      maxRetries: 1,
      sleep: async () => {},
      random: () => 0,
      nowMs: () => NOW,
      nonce: () => `nonce-${nonce += 1}`,
      rateLimiters: passThroughRateLimiters(),
    });

    const result = await client.getJson(
      `https://api.coinbase.com${PATH}?limit=1`,
    );

    expect(result.ok).toBe(true);
    const tokens = authorizations.map((header) => header.slice('Bearer '.length));
    expect(tokens).toHaveLength(2);
    expect(decode(tokens[0]!.split('.')[0]!)['nonce']).toBe('nonce-1');
    expect(decode(tokens[1]!.split('.')[0]!)['nonce']).toBe('nonce-2');
    expect(decode(tokens[0]!.split('.')[1]!)['uri']).toBe(
      `GET api.coinbase.com${PATH}`,
    );
  });

  it('never attaches credentials to another host or insecure URL', async () => {
    const { credentials } = ecdsaCredentials();
    const fetch = vi.fn(async () => response(true, 200, {}));
    const client = createCoinbaseReadHttpClient(credentials, {
      fetch,
      maxRetries: 0,
      nowMs: () => NOW,
      rateLimiters: passThroughRateLimiters(),
    });

    for (const url of [
      'https://evil.example/api/v3/brokerage/accounts',
      'http://api.coinbase.com/api/v3/brokerage/accounts',
    ]) {
      const result = await client.getJson(url);
      expect(result).toMatchObject({ ok: false, reason: 'network', status: 0 });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Coinbase credential validation', () => {
  it('normalizes escaped ECDSA PEM without signing a validation payload', () => {
    const { credentials } = ecdsaCredentials();
    const escaped = `"${credentials.privateKey.trim().replace(/\n/g, '\\n')}"`;

    const result = validateCoinbaseCredentials({
      keyName: `"${KEY_NAME}"`,
      privateKey: escaped,
    });

    expect(result).toEqual({
      ok: true,
      credentials: {
        keyName: KEY_NAME,
        privateKey: credentials.privateKey.trim(),
      },
      algorithm: 'ES256',
      keyFormat: 'ecdsa-pkcs8-pem',
    });
  });

  it('rejects Ed25519 because Coinbase App currently requires ECDSA', () => {
    const seed = Buffer.alloc(32, 7).toString('base64');
    const result = validateCoinbaseCredentials({ keyName: KEY_NAME, privateKey: seed });
    expect(result).toMatchObject({ ok: false, code: 'unsupported_algorithm' });
    if (!result.ok) expect(result.error).toContain('ECDSA P-256');
  });

  it('returns secret-safe errors for malformed keys and identifiers', () => {
    const secret = 'not@a-private-key';
    const invalidKey = validateCoinbaseCredentials({ keyName: KEY_NAME, privateKey: secret });
    expect(invalidKey).toMatchObject({ ok: false, code: 'invalid_private_key' });
    expect(JSON.stringify(invalidKey)).not.toContain(secret);
    expect(validateCoinbaseCredentials({
      keyName: '{"name":"bad"}',
      privateKey: secret,
    })).toMatchObject({ ok: false, code: 'invalid_key_name' });
  });

  it('parses bounded Coinbase key-file JSON without retaining unrelated fields', () => {
    const { credentials } = ecdsaCredentials();
    expect(parseCoinbaseKeyFileJson(JSON.stringify({
      name: ` ${KEY_NAME} `,
      privateKey: ` ${credentials.privateKey} `,
      nickname: 'not authentication material',
    }))).toEqual({
      ok: true,
      credentials: {
        keyName: KEY_NAME,
        privateKey: credentials.privateKey.trim(),
      },
    });
    expect(parseCoinbaseKeyFileJson(
      'x'.repeat(MAX_COINBASE_KEY_FILE_BYTES + 1),
    )).toEqual({ ok: false, error: 'The Coinbase key file is too large.' });
  });
});

describe('Coinbase server clock', () => {
  it('uses the local request midpoint and degrades safely', async () => {
    const times = [10_000, 10_040];
    const success = await fetchCoinbaseClockOffset({
      getJson: async <T>() => ({
        ok: true,
        status: 200,
        data: { epochMillis: '10100' } as T,
      }),
    }, () => times.shift()!);
    expect(success).toEqual({ offsetMs: 80, httpStatus: 200, traceId: null });

    const failed = await fetchCoinbaseClockOffset({
      getJson: async <T>() => ({
        ok: false,
        status: 0,
        reason: 'network',
        retried: 3,
      }) as HttpResult<T>,
    }, () => 1);
    expect(failed).toEqual({ offsetMs: null, httpStatus: null, traceId: null });

    const malformed = await fetchCoinbaseClockOffset({
      getJson: async <T>() => ({
        ok: true,
        status: 200,
        data: { epochMillis: null } as T,
      }),
    }, () => 10);
    expect(malformed.offsetMs).toBeNull();
  });
});
