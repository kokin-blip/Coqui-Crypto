import { describe, expect, it } from 'vitest';
import { aggregateDepth } from '../apps/desktop/src/main/market-depth.js';
import { CoinbaseMicrostructure } from '../apps/desktop/src/main/coinbase-microstructure.js';
import { CoinbaseMarketStreamService, type MarketSocket } from '../apps/desktop/src/main/coinbase-market-stream.js';
import { marketMicrostructureChannelSchemas } from '../packages/contracts/src/schemas/market-microstructure.js';

describe('terminal exact market depth', () => {
  it('aggregates bids down and asks up, preserves exact sizes and cumulative totals', () => {
    const levels = [{ price: '100.01', size: '0.1' }, { price: '100.09', size: '0.2' }, { price: '99.98', size: '0.00000001' }];
    expect(aggregateDepth(levels, '0.1', 'bid', 10)).toEqual([
      { price: '100', size: '0.3', total: '0.3' }, { price: '99.9', size: '0.00000001', total: '0.30000001' },
    ]);
    expect(aggregateDepth(levels, '0.1', 'ask', 10)).toEqual([
      { price: '100', size: '0.00000001', total: '0.00000001' }, { price: '100.1', size: '0.3', total: '0.30000001' },
    ]);
  });

  it('handles values above floating-point integer precision without rounding', () => {
    expect(aggregateDepth([{ price: '9007199254740993.01', size: '9007199254740993.00000001' },
      { price: '9007199254740993.02', size: '0.00000001' }], '1', 'bid', 1)).toEqual([
      { price: '9007199254740993', size: '9007199254740993.00000002', total: '9007199254740993.00000002' },
    ]);
  });

  it('rejects zero and negative aggregation at the contract boundary', () => {
    const schema = marketMicrostructureChannelSchemas['market-data.order-book'].request;
    for (const aggregation of ['0', '0.00', '-1', 'NaN', '1e-3']) expect(schema.safeParse({ productId: 'BTC-USD', aggregation, limit: 10 }).success).toBe(false);
    expect(schema.safeParse({ productId: 'BTC-USD', aggregation: '0.01', limit: 51 }).success).toBe(false);
  });
});

describe('terminal streaming cache', () => {
  const snapshot = { type: 'snapshot', product_id: 'BTC-USD', bids: [['100.00', '0.1']], asks: [['101.00', '0.2']] };

  it('awaits a snapshot, replaces absolute sizes, removes zeros and resets on reconnect', () => {
    const cache = new CoinbaseMicrostructure();
    cache.receive({ type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '100', '1']] }, 1);
    expect(cache.book('BTC-USD', '0.01', 10, 'live', 1).state).toBe('unavailable');
    cache.receive(snapshot, 2);
    cache.receive({ type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '100.0', '0.3']] }, 3);
    expect(cache.book('BTC-USD', '0.01', 10, 'live', 3).bids[0]?.size).toBe('0.3');
    cache.receive({ type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '100', '0.000']] }, 4);
    expect(cache.book('BTC-USD', '0.01', 10, 'live', 4).bids).toEqual([]);
    expect(cache.book('BTC-USD', '0.01', 10, 'reconnecting', 4).state).toBe('stale');
    cache.reset();
    expect(cache.book('BTC-USD', '0.01', 10, 'live', 5).state).toBe('unavailable');
  });

  it('invalidates malformed updates and crossed books rather than inventing depth', () => {
    const cache = new CoinbaseMicrostructure(); cache.receive(snapshot, 1);
    cache.receive({ type: 'l2update', product_id: 'BTC-USD', changes: [['buy', '102', '1']] }, 2);
    expect(cache.book('BTC-USD', '0.01', 10, 'live', 2).state).toBe('unavailable');
    cache.receive(snapshot, 3);
    cache.receive({ type: 'l2update', product_id: 'BTC-USD', changes: [['invalid', '100', '1']] }, 4);
    expect(cache.book('BTC-USD', '0.01', 10, 'live', 4).bids).toEqual([]);
  });

  it('deduplicates trades, inverts maker side, bounds the tape and exposes gaps', () => {
    const cache = new CoinbaseMicrostructure();
    const trade = { type: 'match', product_id: 'BTC-USD', trade_id: 1, price: '100.01', size: '0.1', side: 'sell' };
    expect(cache.receive(trade, 1)).toBe(true); expect(cache.receive(trade, 2)).toBe(false);
    expect(cache.trades('BTC-USD', 10, 'live', 2).trades).toEqual([{ tradeId: '1', price: '100.01', size: '0.1', takerSide: 'buy', observedAtMs: 1 }]);
    cache.receive({ type: 'heartbeat', product_id: 'BTC-USD', last_trade_id: 3 }, 3);
    expect(cache.trades('BTC-USD', 10, 'live', 3).incomplete).toBe(true);
    for (let trade_id = 2; trade_id < 250; trade_id++) cache.receive({ ...trade, trade_id }, trade_id);
    expect(cache.trades('BTC-USD', 200, 'live', 250).trades).toHaveLength(200);
    expect(cache.trades('ETH-USD', 10, 'live', 250).trades).toEqual([]);
    cache.reset(); expect(cache.trades('BTC-USD', 10, 'live', 251).incomplete).toBe(false);
  });

  it('subscribes to selected-product depth through the existing main-process socket', () => {
    const sent: string[] = [];
    const socket: MarketSocket = { readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null,
      send: (data) => sent.push(data), close: () => undefined };
    const stream = new CoinbaseMarketStreamService({ nowMs: () => 1000, createSocket: () => socket });
    stream.start(['BTC-USD']); socket.onopen?.();
    stream.snapshotBook('BTC-USD', '0.01', 10);
    expect(sent.map((s) => JSON.parse(s))).toContainEqual({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['level2_batch'] });
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    const book = stream.snapshotBook('BTC-USD', '0.01', 10);
    expect(book.state).toBe('ready');
    expect(marketMicrostructureChannelSchemas['market-data.order-book'].response.safeParse(book).success).toBe(true);
    socket.onclose?.();
    expect(stream.snapshotBook('BTC-USD', '0.01', 10).state).toBe('unavailable');
    stream.dispose();
  });

  it('recovers invalid depth with a new snapshot and ignores superseded sockets and products', () => {
    const sockets: MarketSocket[] = [], retries: Array<() => void> = [], sent: string[] = [];
    const stream = new CoinbaseMarketStreamService({ nowMs: () => 1000,
      schedule: (callback) => { retries.push(callback); return {} as ReturnType<typeof setTimeout>; },
      cancel: () => undefined,
      createSocket: () => {
        const socket: MarketSocket = { readyState: 1, onopen: null, onclose: null, onerror: null,
          onmessage: null, send: (data) => sent.push(data), close: () => undefined };
        sockets.push(socket); return socket;
      },
    });
    const receive = (socket: MarketSocket, message: object): void => socket.onmessage?.({ data: JSON.stringify(message) });
    stream.start(['BTC-USD']); stream.snapshotBook('BTC-USD', '0.01', 10);
    sockets[0]!.onopen?.(); receive(sockets[0]!, snapshot);
    receive(sockets[0]!, { type: 'l2update', product_id: 'BTC-USD', changes: [['buy', 'bad', '1']] });
    expect(stream.snapshotBook('BTC-USD', '0.01', 10).state).toBe('unavailable');
    expect(stream.snapshot().connection).toBe('reconnecting');
    retries[0]?.(); sockets[1]!.onopen?.();
    receive(sockets[0]!, snapshot);
    expect(stream.snapshotBook('BTC-USD', '0.01', 10).state).toBe('unavailable');
    receive(sockets[1]!, snapshot);
    expect(stream.snapshotBook('BTC-USD', '0.01', 10).state).toBe('ready');
    stream.snapshotBook('ETH-USD', '0.01', 10);
    sockets.at(-1)!.onopen?.();
    receive(sockets.at(-1)!, snapshot);
    expect(stream.snapshotBook('ETH-USD', '0.01', 10).state).toBe('unavailable');
    receive(sockets.at(-1)!, { ...snapshot, product_id: 'ETH-USD' });
    expect(stream.snapshotBook('ETH-USD', '0.01', 10).state).toBe('ready');
    expect(sent.map((value) => JSON.parse(value))).toContainEqual({ type: 'subscribe', product_ids: ['ETH-USD'], channels: ['level2_batch'] });
    stream.dispose();
  });
});
