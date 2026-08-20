import { clearTimeout, setTimeout } from 'node:timers';
import { performance } from 'node:perf_hooks';

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
  reason:
    | 'timeout'
    | 'network'
    | 'http'
    | 'parse'
    | 'serialize'
    | 'invalid-url'
    | 'canceled'
    | 'shutdown'
    | 'elapsed-budget';
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
  /** Total elapsed budget across attempts and delays. Default: 5 minutes. */
  maxElapsedMs?: number;
  fetch?: FetchLike;
  /** Injectable for deterministic tests. */
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable for deterministic backoff jitter. */
  random?: () => number;
  /** Injectable for HTTP-date Retry-After parsing. */
  now?: () => number;
  /** Injectable monotonic source for total elapsed-budget tests. */
  elapsedNow?: () => number;
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
const CANCELED = Symbol('http-canceled');
const SHUTDOWN = Symbol('http-shutdown');
const ELAPSED_BUDGET = Symbol('http-elapsed-budget');
const PARSE_FAILURE = Symbol('http-parse-failure');

type ControlledOutcome =
  | typeof TIMEOUT
  | typeof CANCELED
  | typeof SHUTDOWN
  | typeof ELAPSED_BUDGET;

interface AttemptResponse {
  readonly response: FetchLikeResponse;
  /** Abort an unread or still-streaming response body without touching the caller signal. */
  discard(): void;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
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
  const maxElapsedMs = options.maxElapsedMs ?? 300_000;
  assertPositiveInteger(timeoutMs, 'timeoutMs');
  assertNonNegativeInteger(maxRetries, 'maxRetries');
  assertNonNegativeInteger(baseDelayMs, 'baseDelayMs');
  assertNonNegativeInteger(maxRetryAfterMs, 'maxRetryAfterMs');
  assertPositiveInteger(maxElapsedMs, 'maxElapsedMs');

  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const elapsedNow = options.elapsedNow ?? (() => performance.now());
  const prepareAttempt = options.prepareAttempt;
  const ownedRateLimiters = options.rateLimiters === undefined
    ? createRateLimiterRegistry()
    : undefined;
  const rateLimiters = options.rateLimiters ?? ownedRateLimiters!;
  const shutdown = new AbortController();
  let destroyed = false;

  function combinedSignal(
    caller?: AbortSignal | null,
    local?: AbortSignal | null,
  ): AbortSignal {
    const signals = [caller, local, shutdown.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined && signal !== null,
    );
    return signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
  }

  function abortOutcome(caller?: AbortSignal | null): typeof CANCELED | typeof SHUTDOWN {
    return destroyed || shutdown.signal.aborted ? SHUTDOWN : caller?.aborted ? CANCELED : SHUTDOWN;
  }

  async function attempt(
    url: string,
    hostname: string,
    init: RequestInit,
    remainingMs: number,
  ): Promise<AttemptResponse | ControlledOutcome> {
    if (destroyed) return SHUTDOWN;
    if (init.signal?.aborted) return CANCELED;
    if (remainingMs <= 0) return ELAPSED_BUDGET;
    const admission = await rateLimiters
      .forDomain(hostname)
      .acquire(combinedSignal(init.signal));
    if (admission === 'aborted') return abortOutcome(init.signal);
    if (admission === 'destroyed') return SHUTDOWN;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controlSignal = combinedSignal(init.signal);
    const attemptSignal = combinedSignal(controlSignal, controller.signal);
    const operationTimeoutMs = Math.min(timeoutMs, remainingMs);
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMEOUT);
      }, operationTimeoutMs);
    });
    let removeControlAbort = (): void => {};
    const aborted = new Promise<typeof CANCELED | typeof SHUTDOWN>((resolve) => {
      if (controlSignal.aborted) {
        resolve(abortOutcome(init.signal));
        return;
      }
      const onAbort = (): void => resolve(abortOutcome(init.signal));
      controlSignal.addEventListener('abort', onAbort, { once: true });
      removeControlAbort = () => controlSignal.removeEventListener('abort', onAbort);
    });
    try {
      const operation = (async (): Promise<FetchLikeResponse> => {
        const prepared = prepareAttempt
          ? await prepareAttempt(url, init)
          : init;
        return await fetchImpl(url, { ...prepared, signal: attemptSignal });
      })();
      const result = await Promise.race([
        operation,
        timeout,
        aborted,
      ]);
      return typeof result === 'symbol'
        ? result
        : { response: result, discard: () => controller.abort() };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeControlAbort();
    }
  }

  async function request<T>(spec: RequestSpec<T>): Promise<HttpResult<T>> {
    if (destroyed) return failure('shutdown', 0, 0);
    if (spec.init.signal?.aborted) return failure('canceled', 0, 0);
    let hostname: string;
    try {
      hostname = new URL(spec.url).hostname;
      if (hostname.length === 0) return failure('invalid-url', 0, 0);
    } catch {
      return failure('invalid-url', 0, 0);
    }

    let retried = 0;
    const startedAt = elapsedNow();
    const remaining = (): number => maxElapsedMs - (elapsedNow() - startedAt);

    const waitBeforeRetry = async (milliseconds: number): Promise<ControlledOutcome | null> => {
      if (destroyed) return SHUTDOWN;
      if (spec.init.signal?.aborted) return CANCELED;
      if (milliseconds > remaining()) return ELAPSED_BUDGET;
      const signal = combinedSignal(spec.init.signal);
      await sleep(milliseconds, signal);
      if (signal.aborted) return abortOutcome(spec.init.signal);
      return remaining() <= 0 ? ELAPSED_BUDGET : null;
    };

    for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
      if (remaining() <= 0) return failure('elapsed-budget', 0, retried);
      let response: FetchLikeResponse | undefined;
      let discardResponse: (() => void) | undefined;
      try {
        const outcome = await attempt(spec.url, hostname, spec.init, remaining());
        if (outcome === CANCELED) return failure('canceled', 0, retried);
        if (outcome === SHUTDOWN) return failure('shutdown', 0, retried);
        if (outcome === ELAPSED_BUDGET) return failure('elapsed-budget', 0, retried);
        if (outcome === TIMEOUT) {
          if (spec.retryable && attemptIndex < maxRetries) {
            retried += 1;
            const waited = await waitBeforeRetry(retryDelay(
              undefined,
              attemptIndex,
              baseDelayMs,
              maxRetryAfterMs,
              random,
              now,
            ));
            if (waited === CANCELED) return failure('canceled', 0, retried);
            if (waited === SHUTDOWN) return failure('shutdown', 0, retried);
            if (waited === ELAPSED_BUDGET) return failure('elapsed-budget', 0, retried);
            continue;
          }
          return failure('timeout', 0, retried);
        }
        response = outcome.response;
        discardResponse = outcome.discard;
      } catch {
        if (spec.retryable && attemptIndex < maxRetries) {
          retried += 1;
          const waited = await waitBeforeRetry(retryDelay(
            undefined,
            attemptIndex,
            baseDelayMs,
            maxRetryAfterMs,
            random,
            now,
          ));
          if (waited === CANCELED) return failure('canceled', 0, retried);
          if (waited === SHUTDOWN) return failure('shutdown', 0, retried);
          if (waited === ELAPSED_BUDGET) return failure('elapsed-budget', 0, retried);
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
          discardResponse?.();
          retried += 1;
          const waited = await waitBeforeRetry(retryDelay(
            response,
            attemptIndex,
            baseDelayMs,
            maxRetryAfterMs,
            random,
            now,
          ));
          if (waited === CANCELED) return failure('canceled', 0, retried);
          if (waited === SHUTDOWN) return failure('shutdown', 0, retried);
          if (waited === ELAPSED_BUDGET) return failure('elapsed-budget', 0, retried);
          continue;
        }
        discardResponse?.();
        return failure('http', response.status, retried, response);
      }

      const parseRemainingMs = remaining();
      if (parseRemainingMs <= 0) {
        discardResponse?.();
        return failure('elapsed-budget', 0, retried);
      }
      const parseSignal = combinedSignal(spec.init.signal);
      let parseTimer: ReturnType<typeof setTimeout> | undefined;
      const parseTimeout = new Promise<typeof ELAPSED_BUDGET>((resolve) => {
        parseTimer = setTimeout(() => resolve(ELAPSED_BUDGET), parseRemainingMs);
      });
      let removeParseAbort = (): void => {};
      const parseAborted = new Promise<typeof CANCELED | typeof SHUTDOWN>((resolve) => {
        if (parseSignal.aborted) {
          resolve(abortOutcome(spec.init.signal));
          return;
        }
        const onAbort = (): void => resolve(abortOutcome(spec.init.signal));
        parseSignal.addEventListener('abort', onAbort, { once: true });
        removeParseAbort = () => parseSignal.removeEventListener('abort', onAbort);
      });
      const parsed = await Promise.race([
        spec.parse(response).then(
          (data) => ({ data }),
          () => PARSE_FAILURE,
        ),
        parseTimeout,
        parseAborted,
      ]);
      if (parseTimer !== undefined) clearTimeout(parseTimer);
      removeParseAbort();
      if (parsed === CANCELED) {
        discardResponse?.();
        return failure('canceled', 0, retried);
      }
      if (parsed === SHUTDOWN) {
        discardResponse?.();
        return failure('shutdown', 0, retried);
      }
      if (parsed === ELAPSED_BUDGET) {
        discardResponse?.();
        return failure('elapsed-budget', 0, retried);
      }
      if (typeof parsed === 'symbol') {
        discardResponse?.();
        return failure('parse', response.status, retried, response);
      }
      return { ok: true, data: parsed.data, status: response.status };
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
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      shutdown.abort();
      ownedRateLimiters?.destroyAll();
    },
  };
}
