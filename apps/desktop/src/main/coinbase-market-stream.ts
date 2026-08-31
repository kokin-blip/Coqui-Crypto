import type { InstrumentIdentity } from '@coqui/core';

const PUBLIC_FEED = 'wss://ws-feed.exchange.coinbase.com';
const PRODUCT_ID = /^[A-Z0-9][A-Z0-9._-]{0,31}-USD$/u;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const MAX_PRODUCTS = 100;
const STALE_AFTER_MS = 15_000;
const MAX_RECONNECT_MS = 30_000;
const DISPLAY_INTERVAL_MS = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000,
  '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000,
} as const;
export type LiveCandleInterval = keyof typeof DISPLAY_INTERVAL_MS;

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

export interface ProvisionalMarketCandle {
  readonly productId: string;
  readonly interval: LiveCandleInterval;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly isComplete: false;
  readonly observedAtMs: number;
  readonly informationalOnly: true;
  readonly decisionEligible: false;
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

function compareDecimal(left: string, right: string): number {
  const [leftWhole = '0', leftFraction = ''] = left.split('.');
  const [rightWhole = '0', rightFraction = ''] = right.split('.');
  if (leftWhole.length !== rightWhole.length) return leftWhole.length - rightWhole.length;
  const whole = leftWhole.localeCompare(rightWhole);
  if (whole !== 0) return whole;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction.padEnd(width, '0').localeCompare(rightFraction.padEnd(width, '0'));
}

function addDecimal(left: string, right: string): string {
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const width = Math.max(leftParts[1]?.length ?? 0, rightParts[1]?.length ?? 0);
  const integer = (value: string): bigint => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(`${whole}${fraction.padEnd(width, '0')}`);
  };
  const value = (integer(left) + integer(right)).toString().padStart(width + 1, '0');
  if (width === 0) return value;
  const whole = value.slice(0, -width);
  const fraction = value.slice(-width).replace(/0+$/u, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
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
  readonly #candles = new Map<string, ProvisionalMarketCandle>();
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
    for (const key of this.#candles.keys()) {
      if (!retained.has(key.slice(key.indexOf(':') + 1))) this.#candles.delete(key);
    }
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

  snapshotCandles(products: readonly string[], interval: LiveCandleInterval): {
    readonly connection: LiveMarketView['connection'];
    readonly candles: readonly ProvisionalMarketCandle[];
    readonly informationalOnly: true;
    readonly decisionEligible: false;
    readonly asOfMs: number;
  } {
    if (products.length > 12) throw new RangeError('Live candle subscription exceeds 12 products.');
    this.configure([...new Set([...this.#products, ...products])]);
    const view = this.snapshot();
    return Object.freeze({
      connection: view.connection,
      candles: Object.freeze(products.flatMap((product) => {
        const candle = this.#candles.get(`${interval}:${product}`);
        return candle === undefined ? [] : [candle];
      })),
      informationalOnly: true,
      decisionEligible: false,
      asOfMs: view.asOfMs,
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
          channels: ['ticker_batch', 'matches', 'heartbeat'],
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
    if (message['type'] === 'match' || message['type'] === 'last_match') {
      this.#receiveTrade(message, now);
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

  #receiveTrade(message: Record<string, unknown>, now: number): void {
    const product = message['product_id'];
    const price = decimal(message['price']);
    const size = decimal(message['size']);
    if (typeof product !== 'string' || !this.#products.includes(product) ||
      price === null || size === null) return;
    const observedAtMs = eventTime(message['time'], now);
    for (const [interval, intervalMs] of Object.entries(DISPLAY_INTERVAL_MS) as
      Array<[LiveCandleInterval, number]>) {
      const startTimeMs = Math.floor(observedAtMs / intervalMs) * intervalMs;
      const key = `${interval}:${product}`;
      const prior = this.#candles.get(key);
      const candle = prior === undefined || prior.startTimeMs !== startTimeMs
        ? {
            productId: product, interval, startTimeMs, endTimeMs: startTimeMs + intervalMs,
            open: price, high: price, low: price, close: price, volume: size,
            isComplete: false as const, observedAtMs,
            informationalOnly: true as const, decisionEligible: false as const,
          }
        : {
            ...prior,
            high: compareDecimal(price, prior.high) > 0 ? price : prior.high,
            low: compareDecimal(price, prior.low) < 0 ? price : prior.low,
            close: price,
            volume: addDecimal(prior.volume, size),
            observedAtMs,
          };
      this.#candles.set(key, Object.freeze(candle));
    }
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
