import { clearTimeout, setTimeout } from 'node:timers';

import {
  createRateLimiterRegistry,
  type RateLimiterRegistry,
} from './rate-limiter.js';

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}

export interface HttpSuccess<T> {
  ok: true;
  data: T;
  status: number;
}

export interface HttpFailure {
  ok: false;
  status: number;
  reason: 'timeout' | 'network' | 'http' | 'parse' | 'serialize' | 'invalid-url';
  retried: number;
  /** Secret-safe correlation ID supplied by the remote service. */
  traceId?: string;
}

export type HttpResult<T> = HttpSuccess<T> | HttpFailure;

export interface HttpClient {
  getJson<T>(url: string, init?: RequestInit): Promise<HttpResult<T>>;
  postJson<T>(url: string, body: unknown, init?: RequestInit): Promise<HttpResult<T>>;
  getText(url: string, init?: RequestInit): Promise<HttpResult<string>>;
  /** Optional for lightweight test doubles created before binary archives existed. */
  getBytes?(url: string, init?: RequestInit): Promise<HttpResult<Uint8Array>>;
  /** Release rate-limiter timers owned by this client. */
  destroy(): void;
}

export interface HttpClientOptions {
  /** Milliseconds before one network attempt is aborted. Default: 10 seconds. */
  timeoutMs?: number;
  /** Retry count for idempotent requests after transient failures. Default: 3. */
  maxRetries?: number;
  /** Base exponential-backoff delay. Default: 200ms. */
  baseDelayMs?: number;
  /** Maximum accepted Retry-After delay. Default: 60 seconds. */
  maxRetryAfterMs?: number;
  fetch?: FetchLike;
  /** Injectable for deterministic tests. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Injectable for deterministic backoff jitter. */
  random?: () => number;
  /** Injectable for HTTP-date Retry-After parsing. */
  now?: () => number;
  /** Injectable shared registry. The client does not destroy an injected registry. */
  rateLimiters?: RateLimiterRegistry;
  /** Runs immediately before every network attempt, including retries. */
  prepareAttempt?: (
    url: string,
    init: RequestInit,
  ) => RequestInit | Promise<RequestInit>;
}

interface RequestSpec<T> {
  url: string;
  init: RequestInit;
  parse(response: FetchLikeResponse): Promise<T>;
  retryable: boolean;
}

const TIMEOUT = Symbol('http-timeout');

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function traceId(response: FetchLikeResponse): string | undefined {
  return response.headers.get('trace-id') ??
    response.headers.get('x-request-id') ??
    undefined;
}

function failure(
  reason: HttpFailure['reason'],
  status: number,
  retried: number,
  response?: FetchLikeResponse,
): HttpFailure {
  const remoteTraceId = response ? traceId(response) : undefined;
  return remoteTraceId === undefined
    ? { ok: false, reason, status, retried }
    : { ok: false, reason, status, retried, traceId: remoteTraceId };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMilliseconds(
  response: FetchLikeResponse,
  now: () => number,
): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - now());
}

function retryDelay(
  response: FetchLikeResponse | undefined,
  attempt: number,
  baseDelayMs: number,
  maxRetryAfterMs: number,
  random: () => number,
  now: () => number,
): number {
  const requested = response
    ? retryAfterMilliseconds(response, now)
    : undefined;
  if (requested !== undefined) return Math.min(requested, maxRetryAfterMs);
  return baseDelayMs * 2 ** attempt + random() * baseDelayMs;
}

function postInit(body: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return { ...init, method: 'POST', headers, body };
}

/**
 * Create the only application HTTP boundary. Every network attempt, including
 * retries, acquires a token for the destination host. Methods that may mutate
 * state are never retried automatically.
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertNonNegativeInteger(maxRetries, 'maxRetries');
  assertNonNegativeInteger(baseDelayMs, 'baseDelayMs');
  assertNonNegativeInteger(maxRetryAfterMs, 'maxRetryAfterMs');

  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const prepareAttempt = options.prepareAttempt;
  const ownedRateLimiters = options.rateLimiters === undefined
    ? createRateLimiterRegistry()
    : undefined;
  const rateLimiters = options.rateLimiters ?? ownedRateLimiters!;

  async function attempt(
    url: string,
    hostname: string,
    init: RequestInit,
  ): Promise<FetchLikeResponse | typeof TIMEOUT> {
    await rateLimiters.forDomain(hostname).acquire();
    const prepared = prepareAttempt
      ? await prepareAttempt(url, init)
      : init;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMEOUT);
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        fetchImpl(url, { ...prepared, signal: controller.signal }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function request<T>(spec: RequestSpec<T>): Promise<HttpResult<T>> {
    let hostname: string;
    try {
      hostname = new URL(spec.url).hostname;
      if (hostname.length === 0) return failure('invalid-url', 0, 0);
    } catch {
      return failure('invalid-url', 0, 0);
    }

    let retried = 0;
    for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
      let response: FetchLikeResponse | undefined;
      try {
        const outcome = await attempt(spec.url, hostname, spec.init);
        if (outcome === TIMEOUT) {
          if (spec.retryable && attemptIndex < maxRetries) {
            retried += 1;
            await sleep(retryDelay(
              undefined,
              attemptIndex,
              baseDelayMs,
              maxRetryAfterMs,
              random,
              now,
            ));
            continue;
          }
          return failure('timeout', 0, retried);
        }
        response = outcome;
      } catch {
        if (spec.retryable && attemptIndex < maxRetries) {
          retried += 1;
          await sleep(retryDelay(
            undefined,
            attemptIndex,
            baseDelayMs,
            maxRetryAfterMs,
            random,
            now,
          ));
          continue;
        }
        return failure('network', 0, retried);
      }

      if (!response.ok) {
        if (
          spec.retryable &&
          isTransientStatus(response.status) &&
          attemptIndex < maxRetries
        ) {
          retried += 1;
          await sleep(retryDelay(
            response,
            attemptIndex,
            baseDelayMs,
            maxRetryAfterMs,
            random,
            now,
          ));
          continue;
        }
        return failure('http', response.status, retried, response);
      }

      try {
        return { ok: true, data: await spec.parse(response), status: response.status };
      } catch {
        return failure('parse', response.status, retried, response);
      }
    }
    return failure('network', 0, retried);
  }

  return {
    getJson: <T>(url: string, init: RequestInit = {}) => request<T>({
      url,
      init: { ...init, method: 'GET' },
      parse: async (response) => await response.json() as T,
      retryable: true,
    }),
    postJson: async <T>(url: string, body: unknown, init: RequestInit = {}) => {
      let serialized: string;
      try {
        serialized = JSON.stringify(body);
      } catch {
        return failure('serialize', 0, 0);
      }
      return request<T>({
        url,
        init: postInit(serialized, init),
        parse: async (response) => await response.json() as T,
        retryable: false,
      });
    },
    getText: (url: string, init: RequestInit = {}) => request<string>({
      url,
      init: { ...init, method: 'GET' },
      parse: (response) => response.text(),
      retryable: true,
    }),
    getBytes: (url: string, init: RequestInit = {}) => request<Uint8Array>({
      url,
      init: { ...init, method: 'GET' },
      parse: async (response) => {
        if (!response.arrayBuffer) throw new TypeError('Binary response body is unavailable.');
        return new Uint8Array(await response.arrayBuffer());
      },
      retryable: true,
    }),
    destroy: () => ownedRateLimiters?.destroyAll(),
  };
}
