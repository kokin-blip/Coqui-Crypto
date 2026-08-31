import { describe, expect, it } from 'vitest';

import {
  CoinbaseMarketStreamService,
  type MarketSocket,
} from '../apps/desktop/src/main/coinbase-market-stream.js';

class FakeSocket implements MarketSocket {
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
  open(): void { this.onopen?.(); }
  message(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
  disconnect(): void { this.onclose?.(); }
}

describe('CoinbaseMarketStreamService', () => {
  it('subscribes only to bounded public display channels and returns exact decimals', () => {
    let now = 1_800_000_000_000;
    const sockets: FakeSocket[] = [];
    const service = new CoinbaseMarketStreamService({
      nowMs: () => now,
      createSocket: (url) => {
        expect(url).toBe('wss://ws-feed.exchange.coinbase.com');
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    service.configure(['BTC-USD', 'ETH-USD', 'BTC-USD']);
    service.start();
    const socket = sockets[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'subscribe',
      product_ids: ['BTC-USD', 'ETH-USD'],
      channels: ['ticker_batch', 'matches', 'heartbeat'],
    });

    socket.message({
      type: 'ticker', product_id: 'BTC-USD', price: '61234.1200',
      best_bid: '61234.11', best_ask: '61234.13', volume_24h: '103.500',
      sequence: 7, time: new Date(now).toISOString(),
    });
    const view = service.snapshot();
    expect(view.connection).toBe('live');
    expect(view.informationalOnly).toBe(true);
    expect(view.decisionEligible).toBe(false);
    expect(view.quotes[0]).toMatchObject({
      priceUsd: '61234.1200', bestBidUsd: '61234.11', bestAskUsd: '61234.13',
      volume24h: '103.500', sequence: 7,
    });

    now += 15_001;
    expect(service.snapshot().connection).toBe('stale');
    service.dispose();
  });

  it('ignores malformed, unsupported, foreign, and duplicate messages', () => {
    const socket = new FakeSocket();
    const service = new CoinbaseMarketStreamService({
      nowMs: () => 1_800_000_000_000,
      createSocket: () => socket,
    });
    service.configure(['BTC-USD']);
    service.start();
    socket.message({ type: 'ticker', product_id: 'ETH-USD', price: '1', sequence: 1 });
    socket.message({ type: 'ticker', product_id: 'BTC-USD', price: 'NaN', sequence: 1 });
    socket.message({ type: 'new_future_message', product_id: 'BTC-USD', price: '2' });
    expect(service.snapshot().quotes).toEqual([]);

    socket.message({ type: 'ticker', product_id: 'BTC-USD', price: '2.00', sequence: 2 });
    socket.message({ type: 'ticker', product_id: 'BTC-USD', price: '1.00', sequence: 2 });
    expect(service.snapshot().quotes[0]?.priceUsd).toBe('2.00');
    service.dispose();
  });

  it('reconnects with backoff and rebinds when the active profile universe changes', () => {
    const sockets: FakeSocket[] = [];
    let reconnect: (() => void) | null = null;
    let delay = 0;
    const service = new CoinbaseMarketStreamService({
      nowMs: () => 1_800_000_000_000,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (callback, delayMs) => {
        reconnect = callback;
        delay = delayMs;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
    });
    service.configure(['BTC-USD']);
    service.start();
    sockets[0]!.disconnect();
    expect(service.snapshot().connection).toBe('reconnecting');
    expect(delay).toBe(1_000);
    expect(reconnect).not.toBeNull();
    (reconnect as unknown as () => void)();
    expect(sockets).toHaveLength(2);

    service.configure(['ETH-USD']);
    expect(sockets[1]?.closed).toBe(true);
    expect(sockets).toHaveLength(3);
    expect(service.snapshot().subscribedProducts).toEqual(['ETH-USD']);
    service.dispose();
  });

  it('refuses invalid or excessive product subscriptions', () => {
    const service = new CoinbaseMarketStreamService({ nowMs: () => 1 });
    expect(() => service.configure(['../BTC-USD'])).toThrow(TypeError);
    expect(() => service.configure(Array.from({ length: 101 }, (_, index) => `A${index}-USD`)))
      .toThrow(RangeError);
    service.dispose();
  });
});
