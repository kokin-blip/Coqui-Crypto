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
}

export interface AlpacaPaperAsset {
  readonly symbol: string;
  readonly tradable: boolean;
  readonly status: string;
  readonly min_order_size?: string;
  readonly min_trade_increment?: string;
}

export class AlpacaPaperError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable' | 'invalid_response') {
    super(`Alpaca paper ${code}`);
  }
}

type Fetcher = typeof fetch;

export function createAlpacaPaperClient(credentials: AlpacaPaperCredentials, fetcher: Fetcher = fetch) {
  if (!credentials.keyId.trim() || !credentials.secretKey.trim() ||
      credentials.keyId.length > 256 || credentials.secretKey.length > 512) {
    throw new AlpacaPaperError('unauthorized');
  }

  async function request<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; data?: boolean } = {}): Promise<T> {
    // Callers supply only relative paths assembled in this module.
    if (!path.startsWith('/') || path.startsWith('//')) throw new AlpacaPaperError('invalid_response');
    let response: Response;
    try {
      response = await fetcher(`${options.data ? ALPACA_CRYPTO_DATA_ORIGIN : ALPACA_PAPER_ORIGIN}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          'APCA-API-KEY-ID': credentials.keyId,
          'APCA-API-SECRET-KEY': credentials.secretKey,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        cache: 'no-store',
      });
    } catch {
      throw new AlpacaPaperError('unavailable');
    }
    if (!response.ok) {
      const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden'
        : response.status === 404 ? 'not_found' : response.status === 429 ? 'rate_limited' : 'unavailable';
      throw new AlpacaPaperError(code);
    }
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new AlpacaPaperError('invalid_response'); }
  }

  return Object.freeze({
    account: () => request<AlpacaPaperAccount>('/account'),
    positions: () => request<AlpacaPaperPosition[]>('/positions'),
    orders: (status: 'open' | 'all' = 'open') => request<AlpacaPaperOrder[]>(`/orders?status=${status}&limit=500`),
    orderByClientId: (clientOrderId: string) => request<AlpacaPaperOrder>(`/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`),
    asset: (symbol: string) => request<AlpacaPaperAsset>(`/assets/${encodeURIComponent(symbol)}`),
    latestCryptoQuotes: () => request<unknown>('/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD%2CETH%2FUSD%2CLTC%2FUSD', { data: true }),
    activities: (after: string, pageToken?: string) => request<AlpacaPaperActivity[]>(`/account/activities/FILL?direction=asc&page_size=100&after=${encodeURIComponent(after)}${pageToken === undefined ? '' : `&page_token=${encodeURIComponent(pageToken)}`}`),
    submit: (order: { readonly symbol: string; readonly side: 'buy' | 'sell'; readonly qty: string; readonly client_order_id: string }) =>
      request<AlpacaPaperOrder>('/orders', { method: 'POST', body: { ...order, type: 'market', time_in_force: 'gtc' } }),
    cancel: (orderId: string) => request<undefined>(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
  });
}
