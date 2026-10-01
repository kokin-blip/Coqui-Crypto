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
}

export interface AlpacaPaperAsset {
  readonly symbol: string;
  readonly tradable: boolean;
  readonly status: string;
  readonly min_order_size?: string;
  readonly min_trade_increment?: string;
}

export class AlpacaPaperError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable' | 'invalid_response',
    readonly operation: string = 'unknown', readonly httpStatus: number | null = null) {
    super(`Alpaca paper ${code}`);
  }
}

type Fetcher = typeof fetch;

export function createAlpacaPaperClient(credentials: AlpacaPaperCredentials, fetcher: Fetcher = fetch, deadline?: RequestDeadline) {
  if (!credentials.keyId.trim() || !credentials.secretKey.trim() ||
      credentials.keyId.length > 256 || credentials.secretKey.length > 512) {
    throw new AlpacaPaperError('unauthorized');
  }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; data?: boolean; operation: string }): Promise<T> {
    // Callers supply only relative paths assembled in this module.
    if (!path.startsWith('/') || path.startsWith('//')) throw new AlpacaPaperError('invalid_response');
    deadline?.check();
    const method = options.method ?? 'GET';
    const retrySafeRead = method === 'GET';
    let response: Response | undefined;
    for (let attempt = 0; attempt < (retrySafeRead ? 2 : 1); attempt += 1) {
      deadline?.check();
      try {
        response = await fetcher(`${options.data ? ALPACA_CRYPTO_DATA_ORIGIN : ALPACA_PAPER_ORIGIN}${path}`, {
          method,
          headers: {
            'APCA-API-KEY-ID': credentials.keyId,
            'APCA-API-SECRET-KEY': credentials.secretKey,
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          cache: 'no-store',
          signal: deadline ? AbortSignal.any([deadline.signal, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(15_000, deadline.remainingMs()))))]) : AbortSignal.timeout(15_000),
        });
      } catch {
        deadline?.check();
        if (retrySafeRead && attempt === 0) continue;
        throw new AlpacaPaperError('unavailable', options.operation);
      }
      // Reads are safe to retry once after transient network or server errors.
      // Never retry writes: a timed-out order submission has an ambiguous result.
      if (retrySafeRead && attempt === 0 && response.status >= 500 && response.status < 600) continue;
      break;
    }
    deadline?.check();
    if (response === undefined) throw new AlpacaPaperError('unavailable', options.operation);
    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
        : response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'unavailable';
      throw new AlpacaPaperError(code, options.operation, response.status);
    }
    if (response.status === 204) return undefined as T;
    try { const body = await response.json() as T; deadline?.check(); return body; } catch { deadline?.check(); throw new AlpacaPaperError('invalid_response', options.operation, response.status); }
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
