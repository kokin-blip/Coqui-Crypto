import { Decimal } from 'decimal.js';
import { instrumentKey } from '@coqui/core';
import type { createAlpacaPaperClient } from '@coqui/adapters';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import type { PaperDecisionPreparation } from './runtime-model.js';
import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';
import { activeParallelEvents } from './parallel-paper-plans.js';
import { alpacaQuantity, eventFor, money, quantity, symbolFor } from './parallel-paper-utils.js';
import { recordParallelPreOrder } from './parallel-paper-intraday.js';

const ASSET_IDS = PARALLEL_INSTRUMENTS.map(instrumentKey);
const CUTOFF_MS = 900_000, MIN_TRADE = new Decimal(25), BAND = new Decimal('0.05');

export async function executeParallelDaily(input: {
  experiment: ParallelPaperExperiment; client: ReturnType<typeof createAlpacaPaperClient>;
  preparation: Extract<PaperDecisionPreparation, { ok: true }>; day: string; today: string;
  events(): readonly ParallelPaperEvent[]; now(): number; beforeSubmit(): void;
  append(kind: string, key: string, detail: Record<string, unknown>): void;
}): Promise<void> {
  const { experiment, client, preparation, day, today } = input;
  if (eventFor(activeParallelEvents(input.events()), 'external_complete', day) !== undefined) return;
  if (input.now() - Date.parse(`${today}T00:00:00Z`) > CUTOFF_MS) {
    throw new Error('execution_window_missed');
  }
  let events = activeParallelEvents(input.events());
  const decision = eventFor(events, 'decision', day)!;
  const weights = decision.detail['weights'] as Record<string, number>;
  const account = await client.account();
  const openOrders = await client.orders('open');
  const ourIds = new Set(events.filter((event) => event.kind === 'external_intent').map((event) => event.detail['clientOrderId']));
  if (openOrders.some((order) => !ourIds.has(order.client_order_id))) throw new Error('unexpected_alpaca_order');
  if (openOrders.length > 0 || events.some((event) => event.kind === 'external_intent' && event.detail['day'] !== day &&
      !events.some((other) => other.kind === 'external_order' && other.detail['clientOrderId'] === event.detail['clientOrderId'] && other.detail['status'] === 'filled'))) return;
  const prices = Object.fromEntries(ASSET_IDS.map((id) => [symbolFor(id),
    money(String(preparation.dataset.closesById[id]?.at(-1)))])) as Record<string, Decimal>;
  const equity = money(account.equity);
  if (!equity.isPositive()) throw new Error('alpaca_equity_unavailable');
  const planStage = async (stage: 'sell' | 'buy'): Promise<void> => {
    events = activeParallelEvents(input.events());
    if (eventFor(events, `${stage}_plan`, day) === undefined) {
      const [freshPositions, ...assets] = await Promise.all([client.positions(),
        ...['BTCUSD', 'ETHUSD', 'LTCUSD'].map((symbol) => client.asset(symbol))]);
      const assetBySymbol = new Map(assets.map((asset) => [asset.symbol.replace('/', ''), asset]));
      const freshAccount = await client.account();
      let available = money(freshAccount.cash);
      const planned: { symbol: string; qty: string; side: 'buy' | 'sell'; clientOrderId: string }[] = [];
      const revision = events.filter((event) => event.kind === 'plan_superseded' && event.detail['day'] === day && event.detail['stage'] === stage).length;
      for (const id of ASSET_IDS) {
        const symbol = symbolFor(id);
        if (events.some((intent) => intent.kind === 'external_intent' && intent.detail['day'] === day &&
            intent.detail['side'] === stage && intent.detail['symbol'] === symbol && events.some((attempt) =>
              attempt.kind === 'submit_attempt' && attempt.detail['clientOrderId'] === intent.detail['clientOrderId']))) continue;
        const position = freshPositions.find((item) => item.symbol.replace('/', '') === symbol);
        const heldQty = money(position?.qty ?? '0');
        const actualValue = money(position?.market_value ?? '0');
        const targetValue = equity.mul(String(weights[id]));
        if (targetValue.minus(actualValue).abs().div(equity).lessThan(BAND)) continue;
        let delta = money(quantity(targetValue.div(prices[symbol]!).minus(heldQty)));
        if ((stage === 'sell' && !delta.isNegative()) || (stage === 'buy' && !delta.isPositive())) continue;
        if (stage === 'sell') delta = Decimal.max(delta, heldQty.neg());
        if (stage === 'buy') {
          const cap = money(quantity(available.div(prices[symbol]!.mul('1.01'))));
          delta = Decimal.min(delta, cap);
          available = available.minus(delta.mul(prices[symbol]!).mul('1.01'));
        }
        const rules = assetBySymbol.get(symbol);
        if (rules === undefined) throw new Error('alpaca_asset_rules_unavailable');
        const sized = alpacaQuantity(delta, rules);
        if (sized.mul(prices[symbol]!).lessThan(MIN_TRADE)) continue;
        planned.push({ symbol, qty: sized.toString(), side: stage,
          clientOrderId: `coqui-${experiment.id.slice(0,12)}-${day.replaceAll('-', '')}-${stage}-${symbol}${revision ? `-r${revision}` : ''}` });
      }
      input.append(`${stage}_plan`, `${stage}-plan:${day}:${revision}`, { day, count: planned.length, orders: planned,
        targetWeights: weights, sizingPrices: Object.fromEntries(Object.entries(prices).map(([symbol, price]) => [symbol, price.toString()])),
        accountBefore: { equityUsd: freshAccount.equity, cashUsd: freshAccount.cash,
          positions: freshPositions.map((item) => ({ symbol: item.symbol, quantity: item.qty, marketValueUsd: item.market_value })) } });
      for (const item of planned) input.append('external_intent', `intent:${item.clientOrderId}`,
        { day, ...item });
    }
    const savedPlan = eventFor(activeParallelEvents(input.events()), `${stage}_plan`, day)?.detail['orders'];
    if (Array.isArray(savedPlan)) for (const item of savedPlan as { clientOrderId: string; symbol: string; side: string; qty: string }[]) {
      input.append('external_intent', `intent:${item.clientOrderId}`, { day, ...item });
    }
    events = activeParallelEvents(input.events());
    const intents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day && event.detail['side'] === stage);
    for (const intent of intents) {
      const clientOrderId = String(intent.detail['clientOrderId']);
      if (!events.some((event) => event.kind === 'submit_attempt' && event.detail['clientOrderId'] === clientOrderId)) {
        if (input.now() - Date.parse(`${today}T00:00:00Z`) > CUTOFF_MS) throw new Error('execution_window_missed');
        await recordParallelPreOrder(client, () => input.now(),
          (kind, key, detail) => input.append(kind, key, detail),
          { clientOrderId, symbol: String(intent.detail['symbol']), side: stage, qty: String(intent.detail['qty']) }, weights, day, experiment.alpacaAccountId);
        if (input.now() - Date.parse(`${today}T00:00:00Z`) > CUTOFF_MS) throw new Error('execution_window_missed');
        input.beforeSubmit();
        input.append('submit_attempt', `attempt:${clientOrderId}`, { clientOrderId, day });
        const order = await client.submit({ client_order_id: clientOrderId,
          symbol: String(intent.detail['symbol']), side: stage, qty: String(intent.detail['qty']) });
        input.append('external_order', `order:${order.id}:${order.status}:${order.filled_qty}`,
          { clientOrderId, orderId: order.id, status: order.status, filledQty: order.filled_qty,
            filledAvgPrice: order.filled_avg_price, symbol: order.symbol, side: order.side });
      }
    }
  };
  await planStage('sell');
  events = activeParallelEvents(input.events());
  const sellIntents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day && event.detail['side'] === 'sell');
  for (const intent of sellIntents) {
    const order = await client.orderByClientId(String(intent.detail['clientOrderId']));
    if (order.status !== 'filled') return;
  }
  await planStage('buy');
  events = activeParallelEvents(input.events());
  const buyIntents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day && event.detail['side'] === 'buy');
  for (const intent of buyIntents) {
    const order = await client.orderByClientId(String(intent.detail['clientOrderId']));
    if (order.status !== 'filled') return;
  }
  input.append('external_complete', `external-complete:${day}`, { day });
}
