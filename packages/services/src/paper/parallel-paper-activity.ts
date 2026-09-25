import { Decimal } from 'decimal.js';

import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';

export function projectParallelPaperActivity(events: readonly ParallelPaperEvent[]) {
  const latest = [...events].reverse().find((event) => event.kind === 'decision');
  const day = latest === undefined ? null : String(latest.detail['day']);
  const latestDecision = latest === undefined ? null : {
    day: day!,
    exposurePct: new Decimal(String(latest.detail['exposure'])).mul(100).toFixed(1),
    cashPct: new Decimal(String(latest.detail['cashWeight'])).mul(100).toFixed(1),
    mixVolPct: new Decimal(String(latest.detail['mixVolPct'])).toFixed(1),
    belowTrend: latest.detail['belowTrend'] === true,
    targets: PARALLEL_INSTRUMENTS.map((instrument) => ({
      symbol: instrument.productId.replace('-', ''),
      weightPct: new Decimal(String((latest.detail['weights'] as Record<string, number>)[instrumentKey(instrument)] ?? 0)).mul(100).toFixed(1),
    })),
  };
  const intents = new Map(events.filter((event) => event.kind === 'external_intent')
    .map((event) => [String(event.detail['clientOrderId']), event]));
  const orders = new Map(events.filter((event) => event.kind === 'external_order')
    .map((event) => [String(event.detail['orderId']), event]));
  const activity = events.flatMap((event) => {
    const eventDay = String(event.detail['day'] ?? '');
    const id = String(event.detail['clientOrderId'] ?? '');
    const intent = intents.get(id);
    const symbol = String(event.detail['symbol'] ?? intent?.detail['symbol'] ?? '');
    const side = String(event.detail['side'] ?? intent?.detail['side'] ?? '');
    const qty = String(event.detail['qty'] ?? intent?.detail['qty'] ?? '');
    const orderId = event.detail['orderId'] === undefined ? null : String(event.detail['orderId']);
    const item = (kind: string, title: string, detail: string, alpacaOrderId: string | null = null) =>
      [{ id: event.id, atMs: event.at, kind, title, detail, alpacaOrderId }];
    switch (event.kind) {
      case 'decision': return item('decision', 'Daily targets evaluated', `Completed Coinbase bar ${eventDay}`);
      case 'external_intent': return item('intent', `Planned Alpaca paper ${side} · ${symbol}`, `${qty} units · client ID ${id}`);
      case 'submit_attempt': return item('submission', `Submitting Alpaca paper ${side} · ${symbol}`, `Client ID ${id}; Alpaca acknowledgement pending`);
      case 'external_order': return item('order', `Alpaca order ${String(event.detail['status']).replaceAll('_', ' ')} · ${symbol}`,
        `${side} ${qty} units · filled ${String(event.detail['filledQty'])} · client ID ${id}`, orderId);
      case 'external_fill': {
        const related = orders.get(String(event.detail['orderId']));
        return item('fill', `Alpaca paper fill · ${String(event.detail['symbol'] ?? '')}`,
          `${String(related?.detail['side'] ?? '')} ${String(event.detail['quantity'] ?? '')} units at ${String(event.detail['price'] ?? '')}`, orderId);
      }
      case 'external_complete': {
        const noTrade = !events.some((candidate) => candidate.kind === 'external_intent' && candidate.detail['day'] === eventDay);
        return item(noTrade ? 'no_trade' : 'complete', noTrade ? 'No Alpaca order needed' : 'Alpaca order pass complete',
          noTrade ? `Targets held within the drift and minimum-trade rules for ${eventDay}` : `All planned Alpaca orders filled for ${eventDay}`);
      }
      case 'paused': return item('paused', 'New Alpaca orders paused', String(event.detail['reason']).replaceAll('_', ' '));
      case 'resumed': return item('resumed', 'Alpaca paper experiment resumed', 'Daily checks may submit new paper orders');
      case 'stopped': return item('stopped', 'Alpaca paper experiment stopped', 'Existing paper holdings remain in Alpaca');
      default: return [];
    }
  }).slice(-20).reverse();
  return { latestDecision, lastDecisionAtMs: latest?.at ?? null, decisionDay: day, activity };
}

export function parallelRuntimeState(input: {
  readonly exists: boolean;
  readonly status: 'none' | 'active' | 'paused' | 'stopped';
  readonly pauseReason: unknown;
  readonly lastCheckAtMs: number | null;
  readonly checking: boolean;
  readonly nowMs: number;
  readonly decisionDay: string | null;
  readonly completed: boolean;
}) {
  if (!input.exists) return 'none' as const;
  if (input.status === 'stopped') return 'stopped' as const;
  if (input.status === 'paused') return input.pauseReason === 'user_action' ? 'paused' as const : 'attention' as const;
  if (input.lastCheckAtMs === null) return 'awaiting' as const;
  if (input.nowMs - input.lastCheckAtMs > 180_000) return 'attention' as const;
  if (input.checking) return 'evaluating' as const;
  const expectedDay = new Date(input.nowMs - 86_400_000).toISOString().slice(0, 10);
  if (input.decisionDay !== expectedDay) return 'awaiting' as const;
  return input.completed ? 'reconciled' as const : 'order_pending' as const;
}

export function parallelDayReconciled(events: readonly ParallelPaperEvent[], day: string | null): boolean {
  if (day === null || !events.some((event) => event.kind === 'external_complete' && event.detail['day'] === day)) return false;
  const intents = events.filter((event) => event.kind === 'external_intent' && event.detail['day'] === day);
  return intents.every((intent) => {
    const order = [...events].reverse().find((event) => event.kind === 'external_order' &&
      event.detail['clientOrderId'] === intent.detail['clientOrderId']);
    if (order === undefined || order.detail['status'] !== 'filled') return false;
    const filled = events.filter((event) => event.kind === 'external_fill' && event.detail['orderId'] === order.detail['orderId'])
      .reduce((sum, event) => sum.plus(String(event.detail['quantity'] ?? '0')), new Decimal(0));
    return filled.greaterThanOrEqualTo(String(order.detail['filledQty']));
  });
}
