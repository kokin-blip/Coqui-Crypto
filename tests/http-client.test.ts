import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import {
  createHttpClient,
  type FetchLikeResponse,
  type RateLimiterRegistry,
} from '../packages/adapters/src/index.js';

function response(
  ok: boolean,
  status: number,
  body: unknown = {},
  headers: Readonly<Record<string, string>> = {},
): FetchLikeResponse {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
  return {
    ok,
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => String(body),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

function passThroughRegistry(acquire = vi.fn(async () => 'acquired' as const)): {
  registry: RateLimiterRegistry;
  acquire: typeof acquire;
} {
  return {
    acquire,
    registry: {
      forDomain: () => ({
        acquire,
        available: () => 1,
        pending: () => 0,
        destroy: () => {},
      }),
      destroyAll: () => {},
    },
  };
}

function testClient(
  options: Parameters<typeof createHttpClient>[0],
): ReturnType<typeof createHttpClient> {
  return createHttpClient({
    random: () => 0,
    sleep: async () => {},
    rateLimiters: passThroughRegistry().registry,
    ...options,
  });
}

describe('createHttpClient', () => {
  it('returns parsed JSON, raw text, and binary successes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(true, 200, { value: 1 }))
      .mockResolvedValueOnce(response(true, 200, 'market-feed'))
      .mockResolvedValueOnce(response(true, 200, new Uint8Array([1, 2, 3])));
    const client = testClient({ fetch, maxRetries: 0 });

    await expect(client.getJson('https://api.example/data')).resolves.toEqual({
      ok: true,
      data: { value: 1 },
      status: 200,
    });
    await expect(client.getText('https://api.example/feed')).resolves.toEqual({
      ok: true,
      data: 'market-feed',
      status: 200,
    });
    await expect(client.getBytes?.('https://api.example/archive')).resolves.toEqual({
      ok: true,
      data: new Uint8Array([1, 2, 3]),
      status: 200,
    });
  });

  it('sends JSON while preserving caller headers', async () => {
    let captured: RequestInit | undefined;
    const client = testClient({
      fetch: async (_url, init) => {
        captured = init;
        return response(true, 200, { accepted: true });
      },
      maxRetries: 0,
    });

    const result = await client.postJson('https://api.example/query', { id: 4 }, {
      headers: { 'x-client': 'coqui' },
    });

    expect(result.ok).toBe(true);
    expect(captured?.method).toBe('POST');
    expect(captured?.body).toBe('{"id":4}');
    expect(new Headers(captured?.headers).get('x-client')).toBe('coqui');
    expect(new Headers(captured?.headers).get('content-type')).toBe('application/json');
  });

  it('counts every GET attempt against the destination limiter', async () => {
    const limiter = passThroughRegistry();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(false, 503))
      .mockResolvedValueOnce(response(true, 200, { recovered: true }));
    const client = createHttpClient({
      fetch,
      maxRetries: 1,
      sleep: async () => {},
      random: () => 0,
      rateLimiters: limiter.registry,
    });

    const result = await client.getJson('https://api.coinbase.com/data');

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(limiter.acquire).toHaveBeenCalledTimes(2);
  });

  it('prepares every retry independently for request-bound authentication', async () => {
    const authorizations: string[] = [];
    let nonce = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      return authorizations.length === 1
        ? response(false, 503)
        : response(true, 200, { recovered: true });
    });
    const client = testClient({
      fetch,
      maxRetries: 1,
      prepareAttempt: (_url, init) => ({
        ...init,
        headers: { authorization: `Bearer attempt-${nonce += 1}` },
      }),
    });

    await expect(client.getJson('https://api.example/data')).resolves.toMatchObject({
      ok: true,
    });
    expect(authorizations).toEqual(['Bearer attempt-1', 'Bearer attempt-2']);
  });

  it('retries 429 and 5xx GET responses using capped Retry-After delays', async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(false, 429, {}, { 'retry-after': '3600' }))
      .mockResolvedValueOnce(response(false, 500))
      .mockResolvedValueOnce(response(true, 200, { recovered: true }));
    const client = testClient({
      fetch,
      maxRetries: 2,
      baseDelayMs: 25,
      maxRetryAfterMs: 60_000,
      sleep,
    });

    const result = await client.getJson('https://api.example/data');

    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenNthCalledWith(1, 60_000, expect.any(AbortSignal));
    expect(sleep).toHaveBeenNthCalledWith(2, 50, expect.any(AbortSignal));
  });

  it('keeps generated exponential jitter within the deterministic retry bound', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 10_000 }),
      fc.double({ min: 0, max: 0.999_999, noNaN: true, noDefaultInfinity: true }),
      async (baseDelayMs, jitter) => {
        const delays: number[] = [];
        let calls = 0;
        const client = testClient({
          fetch: async () => calls++ === 0
            ? response(false, 503)
            : response(true, 200, { recovered: true }),
          maxRetries: 1,
          baseDelayMs,
          random: () => jitter,
          sleep: async (milliseconds) => { delays.push(milliseconds); },
        });
        await expect(client.getJson('https://api.example/data')).resolves.toMatchObject({ ok: true });
        expect(delays).toEqual([baseDelayMs + jitter * baseDelayMs]);
        expect(delays[0]!).toBeGreaterThanOrEqual(baseDelayMs);
        expect(delays[0]!).toBeLessThanOrEqual(baseDelayMs * 2);
      },
    ), { seed: 2_026_080_9, numRuns: 100 });
  });

  it('does not retry authentication or ordinary client errors', async () => {
    const fetch = vi.fn(async () => response(false, 401, {}, {
      'trace-id': 'safe-correlation-id',
    }));
    const client = testClient({ fetch, maxRetries: 3 });

    await expect(client.getJson('https://api.example/private')).resolves.toEqual({
      ok: false,
      reason: 'http',
      status: 401,
      retried: 0,
      traceId: 'safe-correlation-id',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('never retries POST because it may not be idempotent', async () => {
    const fetch = vi.fn(async () => response(false, 503));
    const client = testClient({ fetch, maxRetries: 3 });

    const result = await client.postJson('https://api.example/action', { value: 1 });

    expect(result).toEqual({
      ok: false,
      reason: 'http',
      status: 503,
      retried: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retries transient GET network failures and then degrades safely', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('secret-bearing network message');
    });
    const client = testClient({ fetch, maxRetries: 2 });

    await expect(client.getJson('https://api.example/data')).resolves.toEqual({
      ok: false,
      reason: 'network',
      status: 0,
      retried: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('returns timeout even when a fetch implementation ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const client = testClient({
        fetch: async () => await new Promise<FetchLikeResponse>(() => {}),
        timeoutMs: 100,
        maxRetries: 0,
      });
      const pending = client.getJson('https://api.example/slow');
      await vi.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toEqual({
        ok: false,
        reason: 'timeout',
        status: 0,
        retried: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds authentication preparation and response parsing', async () => {
    vi.useFakeTimers();
    try {
      const preparationClient = testClient({
        fetch: async () => response(true, 200),
        prepareAttempt: async () => await new Promise<RequestInit>(() => {}),
        timeoutMs: 50,
        maxElapsedMs: 100,
        maxRetries: 0,
      });
      const preparing = preparationClient.getJson('https://api.example/preparing');
      await vi.advanceTimersByTimeAsync(50);
      await expect(preparing).resolves.toEqual({
        ok: false,
        reason: 'timeout',
        status: 0,
        retried: 0,
      });

      let attemptSignal: AbortSignal | null | undefined;
      const body = response(true, 200);
      body.json = async () => await new Promise<unknown>(() => {});
      const parsingClient = testClient({
        fetch: async (_url, init) => {
          attemptSignal = init?.signal;
          return body;
        },
        timeoutMs: 100,
        maxElapsedMs: 40,
        maxRetries: 0,
      });
      const parsing = parsingClient.getJson('https://api.example/parsing');
      await vi.advanceTimersByTimeAsync(40);
      await expect(parsing).resolves.toEqual({
        ok: false,
        reason: 'elapsed-budget',
        status: 0,
        retried: 0,
      });
      expect(attemptSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors caller cancellation before and during an attempt', async () => {
    const before = new AbortController();
    before.abort();
    const client = testClient({ fetch: vi.fn(), maxRetries: 0 });
    await expect(client.getJson('https://api.example/data', { signal: before.signal }))
      .resolves.toEqual({ ok: false, reason: 'canceled', status: 0, retried: 0 });

    const duringClient = testClient({
      fetch: async () => await new Promise<FetchLikeResponse>(() => {}),
      maxRetries: 0,
    });
    const during = new AbortController();
    const pending = duringClient.getJson('https://api.example/data', { signal: during.signal });
    during.abort();
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'canceled',
      status: 0,
      retried: 0,
    });

    const nullSignalClient = testClient({
      fetch: async () => response(true, 200, { value: 'ok' }),
      maxRetries: 0,
    });
    await expect(nullSignalClient.getJson('https://api.example/data', { signal: null }))
      .resolves.toEqual({ ok: true, status: 200, data: { value: 'ok' } });
  });

  it('distinguishes client shutdown and total elapsed-budget exhaustion', async () => {
    const shutdownClient = testClient({
      fetch: async () => await new Promise<FetchLikeResponse>(() => {}),
      maxRetries: 0,
    });
    const pending = shutdownClient.getJson('https://api.example/data');
    shutdownClient.destroy();
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'shutdown',
      status: 0,
      retried: 0,
    });

    const budgetClient = testClient({
      fetch: async () => response(false, 503),
      maxRetries: 1,
      baseDelayMs: 50,
      maxElapsedMs: 25,
    });
    await expect(budgetClient.getJson('https://api.example/data')).resolves.toEqual({
      ok: false,
      reason: 'elapsed-budget',
      status: 0,
      retried: 1,
    });
  });

  it('returns parse, serialization, and invalid URL failures without throwing', async () => {
    const malformed = response(true, 200);
    malformed.json = async () => {
      throw new SyntaxError('private response body');
    };
    const fetch = vi.fn(async () => malformed);
    const client = testClient({ fetch, maxRetries: 0 });
    const circular: { self?: unknown } = {};
    circular.self = circular;

    await expect(client.getJson('https://api.example/data')).resolves.toEqual({
      ok: false,
      reason: 'parse',
      status: 200,
      retried: 0,
    });
    await expect(client.postJson('https://api.example/data', circular)).resolves.toEqual({
      ok: false,
      reason: 'serialize',
      status: 0,
      retried: 0,
    });
    await expect(client.getJson('not a URL')).resolves.toEqual({
      ok: false,
      reason: 'invalid-url',
      status: 0,
      retried: 0,
    });
  });

  it('validates finite request timing options', () => {
    expect(() => createHttpClient({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => createHttpClient({ maxRetries: -1 })).toThrow(RangeError);
    expect(() => createHttpClient({ baseDelayMs: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => createHttpClient({ maxElapsedMs: 0 })).toThrow(RangeError);
  });
});
