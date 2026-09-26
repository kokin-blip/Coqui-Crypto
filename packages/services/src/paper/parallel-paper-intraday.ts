import { Decimal } from 'decimal.js';

import { AlpacaPaperError, type AlpacaPaperAsset, createAlpacaPaperClient } from '@coqui/adapters';
import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import { PARALLEL_INSTRUMENTS, PARALLEL_SYMBOLS } from './parallel-signal.js';

type Client = ReturnType<typeof createAlpacaPaperClient>;
type Append = (kind: string, key: string, detail: Record<string, unknown>) => void;
const BAND = new Decimal('0.01');
const MIN_TRADE = new Decimal(25);
const SYMBOLS = [...PARALLEL_SYMBOLS];

function amount(value: unknown, code = 'invalid_amount'): Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(code);
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error(code);
  return result;
}

function quotes(raw: unknown, nowMs: number): { prices: Record<string, Decimal>; observedAtMs: number } {
  if (typeof raw !== 'object' || raw === null || !('quotes' in raw) ||
      typeof raw.quotes !== 'object' || raw.quotes === null) throw new Error('invalid_alpaca_quote');
  const source = raw.quotes as Record<string, unknown>;
  const observedAt: number[] = [];
  const prices = Object.fromEntries(SYMBOLS.map((symbol) => {
    const quote = source[`${symbol.slice(0, -3)}/USD`];
    if (typeof quote !== 'object' || quote === null || !('bp' in quote) || !('ap' in quote) || !('t' in quote)) {
      throw new Error('invalid_alpaca_quote');
    }
    const bid = amount(quote.bp, 'invalid_alpaca_quote'), ask = amount(quote.ap, 'invalid_alpaca_quote');
    const atMs = typeof quote.t === 'string' ? Date.parse(quote.t) : NaN;
    if (!bid.isPositive() || ask.lessThan(bid) || !Number.isFinite(atMs) ||
        nowMs - atMs > 60_000 || atMs - nowMs > 5_000) throw new Error('stale_alpaca_quote');
    observedAt.push(atMs);
    return [symbol, bid.plus(ask).div(2)];
  })) as Record<string, Decimal>;
  return { prices, observedAtMs: Math.min(...observedAt) };
}

function slotAt(nowMs: number): string | null {
  const date = new Date(nowMs);
  const hour = date.getUTCHours();
  if (hour === 0 || hour % 4 !== 0 || date.getUTCMinutes() >= 15) return null;
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}`;
}

function sizedQuantity(value: Decimal, asset: AlpacaPaperAsset): Decimal {
  const increment = amount(asset.min_trade_increment ?? '0');
  const minimum = amount(asset.min_order_size ?? '0');
  if (!increment.isPositive() || !minimum.isPositive() || !asset.tradable || asset.status !== 'active') {
    throw new Error('alpaca_asset_rules_unavailable');
  }
  const rounded = value.abs().div(increment).floor().mul(increment);
  return rounded.lessThan(minimum) ? new Decimal(0) : rounded;
}

/** Rebalance the current completed-bar target at most once per four-hour paper slot. */
export async function executeParallelIntraday(input: {
  readonly nowMs: number;
  readonly experimentId: string;
  readonly decision: ParallelPaperEvent;
  readonly events: () => readonly ParallelPaperEvent[];
  readonly append: Append;
  readonly client: Client;
}): Promise<void> {
  const slot = slotAt(input.nowMs);
  if (slot === null) return;
  const events = input.events();
  if (events.some((event) => event.kind === 'intraday_complete' && event.detail['slot'] === slot)) return;
  const decisionDay = String(input.decision.detail['day']);
  if (decisionDay !== new Date(input.nowMs - 86_400_000).toISOString().slice(0, 10)) return;
  if (!events.some((event) => event.kind === 'execution_policy_started')) {
    input.append('execution_policy_started', 'execution-policy:intraday-v1', {
      policy: 'daily-target-four-hour-rebalance-v1', driftBandPct: '1', minimumTradeUsd: '25',
      slotsUtc: ['04:00', '08:00', '12:00', '16:00', '20:00'] });
  }
  const weights = input.decision.detail['weights'] as Record<string, number>;
  const hasPending = events.some((event) => event.kind === 'external_intent' &&
    event.detail['slot'] !== slot &&
    !events.some((other) => other.kind === 'external_order' &&
      other.detail['clientOrderId'] === event.detail['clientOrderId'] && other.detail['status'] === 'filled'));
  const open = await input.client.orders('open');
  const knownIds = new Set(events.filter((event) => event.kind === 'external_intent')
    .map((event) => event.detail['clientOrderId']));
  if (open.some((order) => !knownIds.has(order.client_order_id))) throw new Error('unexpected_alpaca_order');
  if (hasPending || open.length > 0) return;
  let quoteRead: ReturnType<typeof quotes>;
  try { quoteRead = quotes(await input.client.latestCryptoQuotes(), input.nowMs); }
  catch (error) {
    const reason = error instanceof AlpacaPaperError ? `alpaca_quote_${error.code}`
      : error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'alpaca_quote_unavailable';
    input.append('intraday_skipped', `intraday-skip:${slot}:${reason}`, { slot, reason });
    return;
  }
  input.append('intraday_check', `intraday-check:${slot}`, { slot, decisionDay,
    quoteSource: 'alpaca_crypto_us', quoteAtMs: quoteRead.observedAtMs, driftBandPct: '1' });
  const prices = quoteRead.prices;
  const planStage = async (stage: 'sell' | 'buy'): Promise<boolean> => {
    const existing = input.events().find((event) => event.kind === 'intraday_plan' &&
      event.detail['slot'] === slot && event.detail['stage'] === stage);
    let planned: { symbol: string; side: 'buy' | 'sell'; qty: string; clientOrderId: string }[];
    if (existing === undefined) {
      const [account, positions, ...assets] = await Promise.all([input.client.account(), input.client.positions(),
        ...SYMBOLS.map((symbol) => input.client.asset(symbol))]);
      const equity = amount(account.equity);
      if (!equity.isPositive()) throw new Error('alpaca_equity_unavailable');
      let available = amount(account.cash);
      const bySymbol = new Map(assets.map((asset) => [asset.symbol.replace('/', ''), asset]));
      planned = [];
      for (const symbol of SYMBOLS) {
        const position = positions.find((item) => item.symbol.replace('/', '') === symbol);
        const held = amount(position?.qty ?? '0');
        const actual = held.mul(prices[symbol]!);
        const assetId = instrumentKey(PARALLEL_INSTRUMENTS.find((item) => item.productId.replace('-', '') === symbol)!);
        const target = equity.mul(String(weights[assetId] ?? 0));
        if (target.minus(actual).abs().div(equity).lessThan(BAND)) continue;
        let delta = target.div(prices[symbol]!).minus(held);
        if ((stage === 'sell' && !delta.isNegative()) || (stage === 'buy' && !delta.isPositive())) continue;
        if (stage === 'sell') delta = Decimal.max(delta, held.neg());
        if (stage === 'buy') delta = Decimal.min(delta, available.div(prices[symbol]!.mul('1.01')));
        const asset = bySymbol.get(symbol);
        if (asset === undefined) throw new Error('alpaca_asset_rules_unavailable');
        const qty = sizedQuantity(delta, asset);
        if (qty.mul(prices[symbol]!).lessThan(MIN_TRADE)) continue;
        if (stage === 'buy') available = available.minus(qty.mul(prices[symbol]!).mul('1.01'));
        planned.push({ symbol, side: stage, qty: qty.toString(),
          clientOrderId: `coqui-${input.experimentId.slice(0, 12)}-${slot.replaceAll(/[^0-9]/gu, '')}-${stage}-${symbol}` });
      }
      input.append('intraday_plan', `intraday-plan:${slot}:${stage}`, { slot, stage, count: planned.length, orders: planned });
    } else {
      planned = existing.detail['orders'] as typeof planned;
    }
    for (const item of planned) input.append('external_intent', `intent:${item.clientOrderId}`,
      { day: slot, slot, ...item });
    const intents = input.events().filter((event) => event.kind === 'external_intent' &&
      event.detail['slot'] === slot && event.detail['side'] === stage);
    for (const intent of intents) {
      const clientOrderId = String(intent.detail['clientOrderId']);
      if (input.events().some((event) => event.kind === 'submit_attempt' &&
          event.detail['clientOrderId'] === clientOrderId)) continue;
      input.append('submit_attempt', `attempt:${clientOrderId}`, { clientOrderId, day: slot });
      const order = await input.client.submit({ client_order_id: clientOrderId,
        symbol: String(intent.detail['symbol']), side: stage, qty: String(intent.detail['qty']) });
      input.append('external_order', `order:${order.id}:${order.status}:${order.filled_qty}`,
        { clientOrderId, orderId: order.id, status: order.status,
          filledQty: order.filled_qty, filledAvgPrice: order.filled_avg_price,
          symbol: order.symbol, side: order.side });
    }
    for (const intent of intents) {
      const order = await input.client.orderByClientId(String(intent.detail['clientOrderId']));
      if (order.status !== 'filled') return false;
    }
    return true;
  };
  if (!await planStage('sell') || !await planStage('buy')) return;
  input.append('intraday_complete', `intraday-complete:${slot}`, { slot, decisionDay,
    orderCount: input.events().filter((event) => event.kind === 'external_intent' && event.detail['slot'] === slot).length });
}
