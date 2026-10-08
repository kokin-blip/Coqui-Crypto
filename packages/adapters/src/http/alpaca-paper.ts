import { Decimal } from 'decimal.js';
import type { RequestDeadline } from './deadline.js';
import { alpacaUniverseSymbols, parseAlpacaUniverseAssets } from './alpaca-universe.js';
/** Alpaca Trading API client. The host is intentionally not configurable: paper only. */
export const ALPACA_PAPER_ORIGIN = 'https://paper-api.alpaca.markets/v2' as const;
const ALPACA_CRYPTO_DATA_ORIGIN = 'https://data.alpaca.markets' as const;

export interface AlpacaPaperCredentials {
  readonly keyId: string;
  readonly secretKey: string;
}

export interface AlpacaPaperAccount {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly cash: string;
  readonly equity: string;
  readonly trading_blocked: boolean;
  readonly account_blocked: boolean;
}

export interface AlpacaPaperPosition {
  readonly symbol: string;
  readonly qty: string;
  readonly market_value: string;
}

export interface AlpacaPaperOrder {
  readonly id: string;
  readonly client_order_id: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly status: string;
  readonly qty: string | null;
  readonly filled_qty: string;
  readonly filled_avg_price: string | null;
  readonly submitted_at: string | null;
  readonly filled_at: string | null;
}

export interface AlpacaPaperActivity {
  readonly id: string;
  readonly activity_type: string;
  readonly order_id?: string;
  readonly symbol?: string;
  readonly qty?: string;
  readonly price?: string;
  readonly transaction_time?: string;
  readonly date?: string;
  readonly net_amount?: string;
  readonly status?: string;
  readonly created_at?: string;
  readonly side?: string;
}

export interface AlpacaPaperAsset {
  readonly symbol: string;
  readonly tradable: boolean;
  readonly status: string;
  readonly min_order_size?: string;
  readonly min_trade_increment?: string;
}

export class AlpacaPaperError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable' | 'invalid_response' | 'timeout' | 'deadline_exceeded',
    readonly operation: string = 'unknown', readonly httpStatus: number | null = null, readonly attemptCount = 0,
    readonly elapsedMs = 0, readonly budgetMs: number | null = null, readonly remainingMs: number | null = null) {
    super(`Alpaca paper ${code}`);
  }
}

export interface AlpacaPaperReadAttempt {
  readonly operation: string;
  readonly attemptCount: number;
  readonly status: 'received' | 'unavailable';
  readonly reason: string | null;
  readonly httpStatus: number | null;
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly remainingMs: number;
}

type Fetcher = typeof fetch;

export function createAlpacaPaperClient(credentials: AlpacaPaperCredentials, fetcher: Fetcher = fetch, deadline?: RequestDeadline, onReadAttempt?: (attempt: AlpacaPaperReadAttempt) => void) {
  if (!credentials.keyId.trim() || !credentials.secretKey.trim() ||
      credentials.keyId.length > 256 || credentials.secretKey.length > 512) {
    throw new AlpacaPaperError('unauthorized');
  }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; data?: boolean; operation: string }): Promise<T> {
    // Callers supply only relative paths assembled in this module.
    if (!path.startsWith('/') || path.startsWith('//')) throw new AlpacaPaperError('invalid_response');
    const started = performance.now(), budgetMs = Math.min(10_000, deadline?.remainingMs() ?? 10_000);
    const method = options.method ?? 'GET';
    let attemptCount = 0, status: number | null = null;
    const remaining = () => Math.max(0, Math.min(budgetMs - (performance.now() - started), deadline?.remainingMs() ?? Infinity));
    const fail = (code: AlpacaPaperError['code']) => new AlpacaPaperError(code, options.operation, status,
      attemptCount, performance.now() - started, budgetMs, remaining());
    for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt += 1) {
      if (deadline?.signal.aborted || (deadline && deadline.remainingMs() <= 0)) throw fail('deadline_exceeded');
      if (remaining() <= 0) throw fail('timeout');
      status = null; attemptCount += 1;
      const controller = new AbortController();
      const signal = deadline ? AbortSignal.any([controller.signal, deadline.signal]) : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let removeAbort = () => {};
      try {
        const expired = new Promise<never>((_resolve, reject) => {
          const abort = () => reject(fail(deadline?.signal.aborted ? 'deadline_exceeded' : 'timeout'));
          signal.addEventListener('abort', abort, { once: true });
          removeAbort = () => signal.removeEventListener('abort', abort);
          timer = setTimeout(() => controller.abort(), Math.max(1, Math.floor(Math.min(5_000, remaining()))));
        });
        const operation = (async () => {
          const response = await fetcher(`${options.data ? ALPACA_CRYPTO_DATA_ORIGIN : ALPACA_PAPER_ORIGIN}${path}`, {
            method, headers: { 'APCA-API-KEY-ID': credentials.keyId, 'APCA-API-SECRET-KEY': credentials.secretKey,
              ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), cache: 'no-store', signal,
          });
          if (signal.aborted) throw fail(deadline?.signal.aborted ? 'deadline_exceeded' : 'timeout');
          status = response.status;
          if (!response.ok) throw fail(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
            : response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'unavailable');
          if (response.status === 204) return undefined as T;
          try { return await response.json() as T; }
          catch { throw fail('invalid_response'); }
        })();
        const result = await Promise.race([operation, expired]);
        if (deadline?.signal.aborted || (deadline && deadline.remainingMs() <= 0)) throw fail('deadline_exceeded');
        if (method === 'GET') onReadAttempt?.({ operation: options.operation, attemptCount, status: 'received',
          reason: null, httpStatus: status, elapsedMs: performance.now() - started, budgetMs, remainingMs: remaining() });
        return result;
      } catch (error) {
        const failure = deadline && (deadline.signal.aborted || deadline.remainingMs() <= 0) ? fail('deadline_exceeded') :
          error instanceof AlpacaPaperError ? error : fail('unavailable');
        if (method === 'GET') onReadAttempt?.({ operation: options.operation, attemptCount, status: 'unavailable',
          reason: `alpaca_${failure.code}`, httpStatus: failure.httpStatus,
          elapsedMs: performance.now() - started, budgetMs, remainingMs: remaining() });
        if (method === 'GET' && attempt === 0 && remaining() > 0 && !deadline?.signal.aborted &&
            (failure.code === 'timeout' || (failure.code === 'unavailable' && (status === null || status >= 500)))) continue;
        throw failure;
      } finally { if (timer !== undefined) clearTimeout(timer); removeAbort(); controller.abort(); }
    }
    throw fail('unavailable');
  }

  return Object.freeze({
    account: () => request<AlpacaPaperAccount>('/account', { operation: 'account' }),
    positions: () => request<AlpacaPaperPosition[]>('/positions', { operation: 'positions' }),
    orders: (status: 'open' | 'all' = 'open') => request<AlpacaPaperOrder[]>(`/orders?status=${status}&limit=500`, { operation: 'orders' }),
    orderByClientId: (clientOrderId: string) => request<AlpacaPaperOrder>(`/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, { operation: 'order_lookup' }),
    asset: async (symbol: string): Promise<AlpacaPaperAsset> => {
      const asset = await request<AlpacaPaperAsset>(`/assets/${encodeURIComponent(symbol)}`, { operation: 'asset' });
      try {
        if (!asset || typeof asset.symbol !== 'string' || asset.symbol.replace('/', '') !== symbol.replace('/', '') ||
            typeof asset.tradable !== 'boolean' || typeof asset.status !== 'string' ||
            ![asset.min_order_size,asset.min_trade_increment].every((value) => typeof value === 'string' &&
              new Decimal(value).isFinite() && new Decimal(value).gt(0))) throw new Error('invalid_asset');
      } catch { throw new AlpacaPaperError('invalid_response', 'asset', 200); }
      return asset;
    },
    latestCryptoQuotes: (symbols: readonly string[] = ['BTC/USD', 'ETH/USD', 'LTC/USD']) => request<unknown>(`/v1beta3/crypto/us/latest/quotes?symbols=${alpacaUniverseSymbols(symbols)}`, { data: true, operation: 'quote' }),
    cryptoAssets: async () => parseAlpacaUniverseAssets(await request<unknown>('/assets?asset_class=crypto', { operation: 'assets' })),
    latestCryptoOrderbooks: (symbols: readonly string[]) => request<unknown>(`/v1beta3/crypto/us/latest/orderbooks?symbols=${alpacaUniverseSymbols(symbols)}`, { data: true, operation: 'orderbook' }),
    activities: (after: string, pageToken?: string) => request<AlpacaPaperActivity[]>(`/account/activities?activity_types=FILL%2CCFEE%2CFEE&direction=asc&page_size=100&after=${encodeURIComponent(after)}${pageToken === undefined ? '' : `&page_token=${encodeURIComponent(pageToken)}`}`, { operation: 'activities' }),
    submit: (order: { readonly symbol: string; readonly side: 'buy' | 'sell'; readonly qty: string; readonly client_order_id: string }) =>
      request<AlpacaPaperOrder>('/orders', { operation: 'submit', method: 'POST', body: { ...order, type: 'market', time_in_force: 'gtc' } }),
    cancel: (orderId: string) => request<undefined>(`/orders/${encodeURIComponent(orderId)}`, { operation: 'cancel', method: 'DELETE' }),
  });
}
