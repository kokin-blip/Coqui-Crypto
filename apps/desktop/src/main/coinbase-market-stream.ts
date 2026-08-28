import type { InstrumentIdentity } from '@coqui/core';

const PUBLIC_FEED = 'wss://ws-feed.exchange.coinbase.com';
const PRODUCT_ID = /^[A-Z0-9][A-Z0-9._-]{0,31}-USD$/u;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const MAX_PRODUCTS = 100;
const STALE_AFTER_MS = 15_000;
const MAX_RECONNECT_MS = 30_000;

export interface MarketSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface CoinbaseMarketStreamDependencies {
  readonly nowMs: () => number;
  readonly createSocket?: (url: string) => MarketSocket;
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

export interface LiveMarketQuote {
  readonly instrument: InstrumentIdentity;
  readonly priceUsd: string;
  readonly bestBidUsd: string | null;
  readonly bestAskUsd: string | null;
  readonly volume24h: string | null;
  readonly observedAtMs: number;
  readonly sequence: number | null;
}

export interface LiveMarketView {
  readonly connection: 'offline' | 'connecting' | 'live' | 'stale' | 'reconnecting';
  readonly source: 'coinbase_exchange_ws';
  readonly endpointKind: 'public_production';
  readonly informationalOnly: true;
  readonly decisionEligible: false;
  readonly subscribedProducts: readonly string[];
  readonly quotes: readonly LiveMarketQuote[];
  readonly lastMessageAtMs: number | null;
  readonly asOfMs: number;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function decimal(value: unknown): string | null {
  return typeof value === 'string' && DECIMAL.test(value) ? value : null;
}

function eventTime(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Date.parse(value);
  return validTime(parsed) ? parsed : fallback;
}

function sequence(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function productList(products: readonly string[]): readonly string[] {
  if (products.length > MAX_PRODUCTS) throw new RangeError('Live market subscription exceeds 100 products.');
  const unique = [...new Set(products)];
  if (unique.some((product) => !PRODUCT_ID.test(product))) {
    throw new TypeError('Live market subscription contains an invalid Coinbase USD product.');
  }
  return Object.freeze(unique);
}

/**
 * Display-only Coinbase streaming owned by Electron's main process.
 * Raw socket messages never cross IPC and never become completed decision bars.
 */
export class CoinbaseMarketStreamService {
  readonly #nowMs: () => number;
  readonly #createSocket: (url: string) => MarketSocket;
  readonly #schedule: NonNullable<CoinbaseMarketStreamDependencies['schedule']>;
  readonly #cancel: NonNullable<CoinbaseMarketStreamDependencies['cancel']>;
  readonly #onUnexpectedError: (context: string, error: unknown) => void;
  readonly #quotes = new Map<string, LiveMarketQuote>();
  readonly #sequences = new Map<string, number>();
  #products: readonly string[] = [];
  #socket: MarketSocket | null = null;
  #reconnect: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #lastMessageAtMs: number | null = null;
  #started = false;
  #disposed = false;
  #state: LiveMarketView['connection'] = 'offline';

  constructor(dependencies: CoinbaseMarketStreamDependencies) {
    this.#nowMs = dependencies.nowMs;
    this.#createSocket = dependencies.createSocket ?? ((url) => new WebSocket(url) as unknown as MarketSocket);
    this.#schedule = dependencies.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#cancel = dependencies.cancel ?? ((handle) => clearTimeout(handle));
    this.#onUnexpectedError = dependencies.onUnexpectedError ?? (() => undefined);
  }

  start(products?: readonly string[]): void {
    if (this.#disposed || this.#started) return;
    if (products !== undefined) this.configure(products);
    this.#started = true;
    if (this.#products.length > 0) this.#connect();
  }

  configure(products: readonly string[]): void {
    const next = productList(products);
    if (JSON.stringify(next) === JSON.stringify(this.#products)) return;
    this.#products = next;
    const retained = new Set(next);
    for (const key of this.#quotes.keys()) if (!retained.has(key)) this.#quotes.delete(key);
    for (const key of this.#sequences.keys()) if (!retained.has(key)) this.#sequences.delete(key);
    if (!this.#started || this.#disposed) return;
    this.#disconnect();
    if (next.length > 0) this.#connect();
  }

  snapshot(products?: readonly string[]): LiveMarketView {
    if (products !== undefined) this.configure(products);
    const now = this.#nowMs();
    if (!validTime(now)) throw new TypeError('Live market clock returned an invalid time.');
    let connection = this.#state;
    if (connection === 'live' && (this.#lastMessageAtMs === null || now - this.#lastMessageAtMs > STALE_AFTER_MS)) {
      connection = 'stale';
    }
    return Object.freeze({
      connection,
      source: 'coinbase_exchange_ws',
      endpointKind: 'public_production',
      informationalOnly: true,
      decisionEligible: false,
      subscribedProducts: this.#products,
      quotes: Object.freeze(this.#products.flatMap((product) => {
        const quote = this.#quotes.get(product);
        return quote === undefined ? [] : [quote];
      })),
      lastMessageAtMs: this.#lastMessageAtMs,
      asOfMs: now,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#started = false;
    this.#disconnect();
    this.#state = 'offline';
  }

  #connect(): void {
    if (this.#disposed || !this.#started || this.#products.length === 0) return;
    this.#state = this.#reconnectAttempt === 0 ? 'connecting' : 'reconnecting';
    let socket: MarketSocket;
    try {
      socket = this.#createSocket(PUBLIC_FEED);
    } catch (error) {
      this.#onUnexpectedError('market_stream_connect', error);
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      if (socket !== this.#socket) return;
      try {
        socket.send(JSON.stringify({
          type: 'subscribe',
          product_ids: this.#products,
          channels: ['ticker_batch', 'heartbeat'],
        }));
      } catch (error) {
        this.#onUnexpectedError('market_stream_subscribe', error);
        socket.close();
      }
    };
    socket.onmessage = (event) => this.#receive(event.data);
    socket.onerror = () => this.#onUnexpectedError('market_stream_socket', new Error('socket_error'));
    socket.onclose = () => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#scheduleReconnect();
    };
  }

  #receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const now = this.#nowMs();
    if (!validTime(now)) return;
    if (message['type'] === 'heartbeat') {
      this.#lastMessageAtMs = now;
      this.#state = 'live';
      this.#reconnectAttempt = 0;
      return;
    }
    if (message['type'] !== 'ticker') return;
    const product = message['product_id'];
    const price = decimal(message['price']);
    if (typeof product !== 'string' || !this.#products.includes(product) || price === null) return;
    const nextSequence = sequence(message['sequence']);
    const prior = this.#sequences.get(product);
    if (nextSequence !== null && prior !== undefined && nextSequence <= prior) return;
    if (nextSequence !== null) this.#sequences.set(product, nextSequence);
    this.#quotes.set(product, Object.freeze({
      instrument: Object.freeze({ venue: 'coinbase' as const, productId: product, productType: 'spot' as const }),
      priceUsd: price,
      bestBidUsd: decimal(message['best_bid']),
      bestAskUsd: decimal(message['best_ask']),
      volume24h: decimal(message['volume_24h']),
      observedAtMs: eventTime(message['time'], now),
      sequence: nextSequence,
    }));
    this.#lastMessageAtMs = now;
    this.#state = 'live';
    this.#reconnectAttempt = 0;
  }

  #scheduleReconnect(): void {
    if (this.#disposed || !this.#started || this.#products.length === 0 || this.#reconnect !== null) {
      if (this.#products.length === 0) this.#state = 'offline';
      return;
    }
    this.#state = 'reconnecting';
    const delay = Math.min(MAX_RECONNECT_MS, 1_000 * (2 ** this.#reconnectAttempt));
    this.#reconnectAttempt = Math.min(this.#reconnectAttempt + 1, 5);
    this.#reconnect = this.#schedule(() => {
      this.#reconnect = null;
      this.#connect();
    }, delay);
  }

  #disconnect(): void {
    if (this.#reconnect !== null) {
      this.#cancel(this.#reconnect);
      this.#reconnect = null;
    }
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.#state = this.#products.length === 0 ? 'offline' : 'connecting';
  }
}
