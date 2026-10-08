import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAlpacaPaperTradeStream, parseAlpacaPaperTradeUpdate, type PaperTradeSocket } from '../packages/adapters/src/http/alpaca-paper-stream.js';

class Socket implements PaperTradeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; }
  message(data: unknown) { this.onmessage?.({ data }); }
}
const update = { stream: 'trade_updates', data: { event: 'fill', execution_id: 'exec-1',
  timestamp: '2026-10-05T00:00:00Z', qty: '0.000100001', price: '60000.00', position_qty: '0.999749999',
  order: { id: 'order-1', client_order_id: 'client-1', symbol: 'BTC/USD', side: 'buy', filled_qty: '0.000100001' } } };
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
afterEach(() => vi.useRealTimers());

describe('paper execution evidence stream', () => {
  it('keeps decimals exact and never forwards raw account fields', () => {
    const parsed = parseAlpacaPaperTradeUpdate({ ...update, secret: 'must-not-escape' });
    expect(parsed).toMatchObject({ quantity: '0.000100001', positionQty: '0.999749999', price: '60000.00', symbol: 'BTCUSD' });
    expect(JSON.stringify(parsed)).not.toContain('must-not-escape');
    expect(parseAlpacaPaperTradeUpdate({stream:'account_updates'})).toBeNull();
    for (const value of ['NaN', 'Infinity', '-1', 1]) expect(() => parseAlpacaPaperTradeUpdate({ ...update,
      data: { ...update.data, position_qty: value } })).toThrow();
    expect(() => parseAlpacaPaperTradeUpdate({ ...update, data: { ...update.data, execution_id: undefined } })).toThrow();
  });

  it('requires authorization and subscription acknowledgment, including binary paper frames', async () => {
    const socket = new Socket(), onUpdate = vi.fn(), onStatus = vi.fn();
    const stream = createAlpacaPaperTradeStream({credentials:{keyId:'key',secretKey:'secret'},onUpdate,onStatus,
      createSocket: (url) => { expect(url).toBe('wss://paper-api.alpaca.markets/stream'); return socket; } });
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]!)).toEqual({action:'auth',key:'key',secret:'secret'});
    socket.message(JSON.stringify(update)); await flush(); expect(onUpdate).not.toHaveBeenCalled();
    socket.message(new TextEncoder().encode(JSON.stringify({stream:'authorization',data:{status:'authorized'}})).buffer);
    await flush(); expect(JSON.parse(socket.sent[1]!)).toEqual({action:'listen',data:{streams:['trade_updates']}});
    socket.message(JSON.stringify({stream:'listening',data:{streams:['trade_updates']}})); await flush();
    socket.message(new Blob([JSON.stringify(update)])); await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(onStatus).toHaveBeenLastCalledWith('listening');
    expect(socket.sent).toHaveLength(2);
    stream.close(); expect(socket.closed).toBe(true);
  });

  it('reconnects without order messages and cancels reconnects on suspension', async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [], onUpdate = vi.fn();
    const stream = createAlpacaPaperTradeStream({credentials:{keyId:'key',secretKey:'secret'},onUpdate,onStatus:vi.fn(),
      createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
    sockets[0]!.onclose?.(); await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    const staleCallback = sockets[1]!.onmessage!;
    const staleOpen = sockets[1]!.onopen!;
    stream.close(); staleOpen(); staleCallback({data:JSON.stringify(update)}); await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2); expect(onUpdate).not.toHaveBeenCalled();
    expect(sockets[1]!.sent).toHaveLength(0);
  });

  it('recovers from socket construction failure and rejects oversized frames before decoding', async () => {
    vi.useFakeTimers();
    const socket=new Socket(), onStatus=vi.fn(); let attempt=0;
    const stream=createAlpacaPaperTradeStream({credentials:{keyId:'key',secretKey:'secret'},onUpdate:vi.fn(),onStatus,
      createSocket:()=>{if(attempt++===0)throw new Error('transport');return socket;}});
    expect(onStatus).toHaveBeenLastCalledWith('unavailable');
    await vi.advanceTimersByTimeAsync(1000);
    socket.message(new ArrayBuffer(262_145)); await flush();
    expect(socket.closed).toBe(true); stream.close();
  });

  it('fails closed on rejected authentication and malformed evidence without leaking error contents', async () => {
    vi.useFakeTimers();
    const socket = new Socket(), onStatus = vi.fn(), onUpdate = vi.fn();
    const stream = createAlpacaPaperTradeStream({credentials:{keyId:'key',secretKey:'secret'},onUpdate,onStatus,createSocket:()=>socket});
    socket.message(JSON.stringify({stream:'authorization',data:{status:'unauthorized',detail:'secret'}})); await flush();
    expect(socket.closed).toBe(true); expect(onUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('secret'); stream.close();
  });
});
