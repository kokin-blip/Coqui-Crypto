import { AlpacaPaperError, withinDeadline, type RequestDeadline, type createAlpacaPaperClient } from '@coqui/adapters';
import { Decimal } from 'decimal.js';
import { acquireExecutionLease, getAuthoritativeHost, validateExecutionLease, releaseExecutionLease,
  type Db } from '@coqui/storage';

export function parallelExecutionClaim(profileId: string, hostId: string, db: Db,
  now: () => number, deadline?: RequestDeadline, hostKind?: 'desktop' | 'headless') {
  const authority = getAuthoritativeHost(profileId, db);
  if ((hostKind === 'headless' || hostId.startsWith('headless')) && (authority?.status !== 'active' || authority.hostId !== hostId))
    throw new Error('stale_host_authority');
  if (authority?.status === 'active' && authority.hostId !== hostId) throw new Error('stale_host_authority');
  const generation = authority?.fencingGeneration ?? 0;
  const lease = acquireExecutionLease(profileId, hostId, now(), 30_000, db);
  if (!lease) throw new Error('execution_lease_unavailable');
  return {
    check() {
      deadline?.check();
      const current = getAuthoritativeHost(profileId, db);
      if ((current?.fencingGeneration ?? 0) !== generation ||
          !validateExecutionLease(profileId, hostId, lease.fencingToken, now(), db)) throw new Error('stale_host_authority');
    },
    release() { releaseExecutionLease(profileId, hostId, lease.fencingToken, now(), db); },
  };
}

type Client = ReturnType<typeof createAlpacaPaperClient>;
function quoteTimestamps(raw: unknown, requested: unknown): { symbol: string; atMs: number | null }[] {
  const source = raw && typeof raw === 'object' && 'quotes' in raw && raw.quotes && typeof raw.quotes === 'object'
    ? raw.quotes as Record<string, Record<string, unknown>> : {};
  const symbols = Array.isArray(requested) ? requested : ['BTC/USD', 'ETH/USD', 'LTC/USD'];
  return ['BTC/USD', 'ETH/USD', 'LTC/USD'].filter(symbol => symbols.includes(symbol)).map(symbol => {
    let atMs: number | null = null;
    try {
      const quote = source[symbol]!, bid = new Decimal(String(quote['bp'])), ask = new Decimal(String(quote['ap']));
      const time = Date.parse(String(quote['t']));
      if (bid.isFinite() && ask.isFinite() && bid.gt(0) && ask.gte(bid) && Number.isSafeInteger(time) && time >= 0) atMs = time;
    } catch { /* Malformed prices remain unavailable evidence. */ }
    return { symbol, atMs };
  });
}
/** Capture only operation outcomes, never credential values or raw broker bodies. */
export function observedParallelClient(client: Client, now: () => number, append:
  (kind: string, key: string, detail: Record<string, unknown>) => void, deadline?: RequestDeadline, keyPrefix = 'read'): Client {
  let sequence = 0;
  const wrap = <A extends unknown[], R>(operation: string, method: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const startedAtMs = now(), started = performance.now(), budgetMs = deadline?.remainingMs() ?? null;
      const key = `readiness:${keyPrefix}:${startedAtMs}:${operation}:${sequence++}`;
      try {
        deadline?.check();
        const result = await withinDeadline(method(...args), deadline);
        const quotes = operation === 'quote' ? quoteTimestamps(result, args[0]) : [];
        const times = quotes.flatMap(row => row.atMs === null ? [] : [row.atMs]);
        const quoteAtMs = times.length && times.length === quotes.length ? Math.min(...times) : null;
        append('readiness', key, { operation, status: 'received', startedAtMs, observedAtMs: now(),
          ...(quoteAtMs === null ? {} : { oldestQuoteAtMs: quoteAtMs }),
          ...(operation === 'quote' ? { quoteTimestamps: quotes } : {}),
          durationMs: performance.now() - started, budgetMs, remainingMs: deadline?.remainingMs() ?? null });
        return result;
      } catch (error) {
        const failure = error instanceof AlpacaPaperError ? new AlpacaPaperError(error.code, operation,
          error.httpStatus, error.attemptCount, error.elapsedMs, error.budgetMs, error.remainingMs) : new AlpacaPaperError(
          error instanceof Error && error.message === 'deadline_exceeded' ? 'deadline_exceeded' :
          error instanceof TypeError ? 'invalid_response' : 'unavailable', operation, null, 0, performance.now() - started,
          budgetMs, deadline?.remainingMs() ?? null);
        append('readiness', key, { operation, status: 'unavailable', startedAtMs, observedAtMs: now(),
          durationMs: performance.now() - started, budgetMs, remainingMs: deadline?.remainingMs() ?? null,
          reason: `alpaca_${failure.code}`, httpStatus: failure.httpStatus, attemptCount: failure.attemptCount,
          ...(operation === 'quote' ? { quoteSymbols: args[0] ?? ['BTC/USD', 'ETH/USD', 'LTC/USD'] } : {}) });
        throw failure;
      }
    };
  return Object.freeze({
    account: wrap('account', client.account), positions: wrap('positions', client.positions),
    orders: wrap('orders', client.orders), orderByClientId: wrap('order_lookup', client.orderByClientId),
    asset: wrap('asset', client.asset), activities: wrap('activities', client.activities),
    latestCryptoQuotes: wrap('quote', client.latestCryptoQuotes), cryptoAssets: wrap('assets', client.cryptoAssets),
    latestCryptoOrderbooks: wrap('orderbook', client.latestCryptoOrderbooks),
    submit: wrap('submit', client.submit), cancel: wrap('cancel', client.cancel),
  });
}
