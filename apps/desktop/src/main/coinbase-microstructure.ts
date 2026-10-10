import { tracePerformance } from './performance-trace.js';
import { aggregateDepth, canonicalPrice, comparePrice, validDecimal } from './market-depth.js';

type Message = Readonly<Record<string, unknown>>;
type Connection = 'offline' | 'connecting' | 'live' | 'stale' | 'reconnecting';
interface Book {
  readonly bids: Map<string, string>;
  readonly asks: Map<string, string>;
  observedAtMs: number;
}
export interface Trade {
  readonly tradeId: string;
  readonly price: string;
  readonly size: string;
  readonly takerSide: 'buy' | 'sell';
  readonly observedAtMs: number;
}

const MAX_LEVELS = 50_000;
const MAX_TRADES = 200;
const instrument = (productId: string) => ({ venue: 'coinbase' as const, productId, productType: 'spot' as const });
const provenance = { source: 'coinbase_exchange_ws' as const, informationalOnly: true as const, decisionEligible: false as const };

/** Bounded display cache. Nothing here participates in strategy decisions. */
export class CoinbaseMicrostructure {
  readonly #books = new Map<string, Book>();
  readonly #trades = new Map<string, Trade[]>();
  readonly #lastTradeIds = new Map<string, number>();
  readonly #gaps = new Set<string>();

  reset(): void {
    this.#books.clear(); this.#trades.clear(); this.#lastTradeIds.clear(); this.#gaps.clear();
  }

  clearBooks(): void { this.#books.clear(); }

  receive(message: Message, now: number): boolean {
    const productId = message['product_id'];
    if (typeof productId !== 'string') return true;
    const parsedTime = typeof message['time'] === 'string' ? Date.parse(message['time']) : now;
    const observedAtMs = Number.isSafeInteger(parsedTime) && parsedTime >= 0 ? parsedTime : now;
    if (message['type'] === 'snapshot') {
      const bids = this.#levels(message['bids']), asks = this.#levels(message['asks']);
      if (bids === null || asks === null) { this.#books.delete(productId); return false; }
      this.#books.set(productId, { bids, asks, observedAtMs });
      return true;
    }
    if (message['type'] === 'l2update') {
      const book = this.#books.get(productId), changes = message['changes'];
      if (book === undefined) return false;
      if (!Array.isArray(changes) || changes.length > MAX_LEVELS) { this.#books.delete(productId); return false; }
      for (const change of changes) {
        if (!Array.isArray(change) || !['buy', 'sell'].includes(change[0] as string) ||
          !validDecimal(change[1]) || !validDecimal(change[2]) || comparePrice(change[1], '0') <= 0) {
          this.#books.delete(productId); return false;
        }
        const side = change[0] === 'buy' ? book.bids : book.asks;
        const price = canonicalPrice(change[1]);
        if (comparePrice(change[2], '0') === 0) side.delete(price);
        else side.set(price, change[2]);
        if (side.size > MAX_LEVELS) { this.#books.delete(productId); return false; }
      }
      book.observedAtMs = observedAtMs;
    }
    if (message['type'] === 'heartbeat') {
      const last = this.#lastTradeIds.get(productId), reported = message['last_trade_id'];
      if (last !== undefined && typeof reported === 'number' && reported > last) this.#gaps.add(productId);
    }
    if (message['type'] === 'match' || message['type'] === 'last_match') {
      const id = message['trade_id'];
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return true;
      const last = this.#lastTradeIds.get(productId);
      if (last !== undefined && id <= last) return false;
      if (!validDecimal(message['price']) || !validDecimal(message['size']) ||
        comparePrice(message['price'], '0') <= 0 || comparePrice(message['size'], '0') <= 0 ||
        (message['side'] !== 'buy' && message['side'] !== 'sell')) return false;
      if (last !== undefined && id > last + 1) this.#gaps.add(productId);
      this.#lastTradeIds.set(productId, id);
      const trades = this.#trades.get(productId) ?? [];
      // Coinbase match.side describes the maker; the tape shows aggressor side.
      trades.unshift({ tradeId: String(id), price: message['price'], size: message['size'],
        takerSide: message['side'] === 'buy' ? 'sell' : 'buy', observedAtMs });
      trades.length = Math.min(trades.length, MAX_TRADES);
      this.#trades.set(productId, trades);
    }
    return true;
  }

  book(productId: string, aggregation: string, limit: number, connection: Connection, asOfMs: number) {
    const started = performance.now();
    const book = this.#books.get(productId);
    const bids = book === undefined ? [] : aggregateDepth([...book.bids].map(([price, size]) => ({ price, size })), aggregation, 'bid', limit);
    const asks = book === undefined ? [] : aggregateDepth([...book.asks].map(([price, size]) => ({ price, size })), aggregation, 'ask', limit);
    tracePerformance('book.aggregate',productId,started,(book?.bids.size ?? 0)+(book?.asks.size ?? 0));
    const crossed = bids[0] !== undefined && asks[0] !== undefined && comparePrice(bids[0].price, asks[0].price) >= 0;
    return { instrument: instrument(productId), aggregation, bids: crossed ? [] : bids, asks: crossed ? [] : asks,
      state: book === undefined || crossed ? 'unavailable' as const : connection === 'live' ? 'ready' as const : 'stale' as const,
      observedAtMs: book?.observedAtMs ?? null, connection, asOfMs, ...provenance };
  }

  trades(productId: string, limit: number, connection: Connection, asOfMs: number) {
    return { instrument: instrument(productId), trades: (this.#trades.get(productId) ?? []).slice(0, limit),
      incomplete: this.#gaps.has(productId), connection, asOfMs, ...provenance };
  }

  #levels(value: unknown): Map<string, string> | null {
    if (!Array.isArray(value) || value.length > MAX_LEVELS) return null;
    const levels = new Map<string, string>();
    for (const entry of value) {
      if (!Array.isArray(entry) || !validDecimal(entry[0]) || !validDecimal(entry[1]) || comparePrice(entry[0], '0') <= 0) return null;
      if (comparePrice(entry[1], '0') > 0) levels.set(canonicalPrice(entry[0]), entry[1]);
    }
    return levels;
  }
}
