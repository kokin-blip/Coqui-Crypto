import { Decimal } from 'decimal.js';
import type { AlpacaPaperCredentials } from './alpaca-paper.js';

export interface AlpacaPaperTradeUpdate {
  readonly executionId: string;
  readonly orderId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly at: string;
  readonly quantity: string;
  readonly price: string;
  readonly filledQty: string;
  readonly positionQty: string;
}

/** Allowlist execution evidence; never persist a raw account message. */
export function parseAlpacaPaperTradeUpdate(raw: unknown): AlpacaPaperTradeUpdate | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  if (message['stream'] !== 'trade_updates') return null;
  const data = message['data'] as Record<string, unknown> | undefined;
  if (!data || !['fill', 'partial_fill'].includes(String(data['event']))) return null;
  const order = data['order'] as Record<string, unknown> | undefined;
  if (!order || !['buy', 'sell'].includes(String(order['side']))) throw new Error('invalid_trade_update');
  const text = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw new Error('invalid_trade_update');
    return value;
  };
  const decimal = (value: unknown, zero = false) => {
    const result = text(value), parsed = new Decimal(result);
    if (!parsed.isFinite() || (zero ? parsed.lt(0) : parsed.lte(0))) throw new Error('invalid_trade_update');
    return result;
  };
  const at = text(data['timestamp']);
  if (!Number.isFinite(Date.parse(at))) throw new Error('invalid_trade_update');
  const quantity = decimal(data['qty']), filledQty = decimal(order['filled_qty']);
  if (new Decimal(filledQty).lt(quantity)) throw new Error('invalid_trade_update');
  const symbol = text(order['symbol']).replaceAll('/', '');
  if (!['BTCUSD', 'ETHUSD', 'LTCUSD'].includes(symbol)) throw new Error('invalid_trade_update');
  return { executionId: text(data['execution_id']), orderId: text(order['id']),
    clientOrderId: text(order['client_order_id']), symbol, side: order['side'] as 'buy' | 'sell', at,
    quantity, price: decimal(data['price']), filledQty, positionQty: decimal(data['position_qty'], true) };
}

export interface PaperTradeSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(value: string): void;
  close(): void;
}

/** Paper-only execution stream. Reconnects never submit or replay an order. */
export function createAlpacaPaperTradeStream(input: {
  credentials: AlpacaPaperCredentials;
  onUpdate(update: AlpacaPaperTradeUpdate): void;
  onStatus(status: 'connecting' | 'listening' | 'unavailable'): void;
  createSocket?: (url: string) => PaperTradeSocket;
}) {
  let socket: PaperTradeSocket | null = null, stopped = false, attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  const retry = () => { timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5))); };
  const connect = () => {
    if (stopped) return;
    input.onStatus('connecting');
    let current: PaperTradeSocket;
    try { current = (input.createSocket ?? ((url) => new WebSocket(url) as unknown as PaperTradeSocket))('wss://paper-api.alpaca.markets/stream'); }
    catch { input.onStatus('unavailable'); retry(); return; }
    socket = current;
    let authorized = false, listening = false;
    const disconnect = () => {
      if (socket !== current || stopped) return;
      socket = null;
      if (timer) clearTimeout(timer);
      current.onopen = null; current.onmessage = null; current.onclose = null; current.onerror = null;
      try { current.close(); } catch { /* A failed close cannot prevent reconnection. */ }
      input.onStatus('unavailable');
      retry();
    };
    timer = setTimeout(disconnect, 10_000);
    current.onopen = () => { if (socket !== current || stopped) return; try { current.send(JSON.stringify({ action: 'auth', key: input.credentials.keyId, secret: input.credentials.secretKey })); } catch { disconnect(); } };
    current.onclose = disconnect; current.onerror = disconnect;
    current.onmessage = ({ data }) => {
      queue = queue.then(async () => {
        if (socket !== current || stopped) return;
        const size = typeof data === 'string' ? data.length : data instanceof Blob ? data.size :
          data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.byteLength : Infinity;
        if (size > 262_144) throw new Error('invalid_trade_update');
        let text: string;
        if (typeof data === 'string') text = data;
        else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
        else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        else if (data instanceof Blob) text = await data.text();
        else throw new Error('invalid_trade_update');
        if (socket !== current || stopped) return;
        if (text.length > 262_144) throw new Error('invalid_trade_update');
        const raw = JSON.parse(text) as { stream?: string; data?: { status?: string; streams?: string[] } };
        if (raw.stream === 'authorization') {
          if (raw.data?.status !== 'authorized') throw new Error('stream_unauthorized');
          authorized = true;
          current.send(JSON.stringify({ action: 'listen', data: { streams: ['trade_updates'] } }));
        } else if (raw.stream === 'listening') {
          if (!authorized || !raw.data?.streams?.includes('trade_updates')) throw new Error('stream_unavailable');
          listening = true; attempts = 0; if (timer) clearTimeout(timer);
          input.onStatus('listening');
        } else {
          if (!listening) return;
          const update = parseAlpacaPaperTradeUpdate(raw);
          if (update) input.onUpdate(update);
        }
      }).catch(disconnect);
    };
  };
  connect();
  return { close() {
    stopped = true; if (timer) clearTimeout(timer);
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; try { socket.close(); } catch { /* Shutdown remains final even if the transport fails. */ } socket = null; }
  } };
}
