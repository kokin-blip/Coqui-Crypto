import { Decimal } from 'decimal.js';

import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';
import type { PaperDecisionPreparation } from './runtime-model.js';

const RECOVERABLE_TRANSIENT_REASONS = new Set([
  'market_fetch_failed', 'invalid_market_data', 'market_alignment_failed',
  'insufficient_history', 'stale_market_data', 'stale_product_rules',
  'credentials_unavailable', 'secret_store_unavailable',
]);

export function isRecoverableParallelTransientPause(reason: unknown): boolean {
  return typeof reason === 'string' && RECOVERABLE_TRANSIENT_REASONS.has(reason);
}

export function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function shouldResumeParallelTransientPause(events: readonly ParallelPaperEvent[],
  preparation: PaperDecisionPreparation, nowMs: number): boolean {
  const latestState = [...events].reverse().find((event) =>
    ['paused', 'resumed', 'stopped', 'started'].includes(event.kind));
  const latestDay = preparation.ok ? preparation.dataset.dayKeys.at(-1) : undefined;
  return isRecoverableParallelTransientPause(latestState?.detail['reason']) && latestDay !== undefined &&
    dayAfter(latestDay) === new Date(nowMs).toISOString().slice(0, 10);
}

export function projectParallelPaperActivity(events: readonly ParallelPaperEvent[]) {
  const latest = [...events].reverse().find((event) => event.kind === 'decision');
  const day = latest === undefined ? null : String(latest.detail['day']);
  const filterEvents = events.filter((event) => event.kind === 'decision' &&
    typeof event.detail['filters'] === 'object' && event.detail['filters'] !== null);
  const filterSummary = { observedDecisions: filterEvents.length,
    negativeMomentumDays: 0, assetVolScaledDays: 0, portfolioVolScaledDays: 0, trendCapDays: 0 };
  for (const event of filterEvents) {
    const filters = event.detail['filters'] as Record<string, unknown>;
    if (Array.isArray(filters['negativeMomentumAssets']) && filters['negativeMomentumAssets'].length > 0) filterSummary.negativeMomentumDays += 1;
    if (Array.isArray(filters['assetVolScaledAssets']) && filters['assetVolScaledAssets'].length > 0) filterSummary.assetVolScaledDays += 1;
    if (filters['portfolioVolScaled'] === true) filterSummary.portfolioVolScaledDays += 1;
    if (filters['trendCapApplied'] === true) filterSummary.trendCapDays += 1;
  }
  const latestFilters = latest?.detail['filters'] as Record<string, unknown> | undefined;
  const latestDecision = latest === undefined ? null : {
    day: day!,
    exposurePct: new Decimal(String(latest.detail['exposure'])).mul(100).toFixed(1),
    cashPct: new Decimal(String(latest.detail['cashWeight'])).mul(100).toFixed(1),
    mixVolPct: new Decimal(String(latest.detail['mixVolPct'])).toFixed(1),
    belowTrend: latest.detail['belowTrend'] === true,
    filters: latestFilters === undefined ? null : {
      negativeMomentumAssets: Array.isArray(latestFilters['negativeMomentumAssets']) ? latestFilters['negativeMomentumAssets'].length : 0,
      assetVolScaledAssets: Array.isArray(latestFilters['assetVolScaledAssets']) ? latestFilters['assetVolScaledAssets'].length : 0,
      portfolioVolScaled: latestFilters['portfolioVolScaled'] === true,
      trendCapApplied: latestFilters['trendCapApplied'] === true,
    },
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
      case 'execution_policy_started': return item('policy', 'Intraday paper rebalances enabled',
        'The daily TrendVol target is unchanged; Alpaca may rebalance at five later UTC slots');
      case 'daily_window_missed': return item('missed', 'Daily order window missed',
        'Daily targets remain available for later intraday paper rebalance checks');
      case 'intraday_check': return item('check', 'Intraday rebalance checked',
        `Alpaca US crypto quotes observed ${new Date(Number(event.detail['quoteAtMs'])).toISOString()} · slot ${String(event.detail['slot'])} UTC · 1% drift band`);
      case 'intraday_skipped': return item('skip', 'Intraday rebalance skipped',
        `${String(event.detail['reason']).replaceAll('_', ' ')} · slot ${String(event.detail['slot'])} UTC`);
      case 'intraday_complete': return item(event.detail['orderCount'] === 0 ? 'no_trade' : 'complete',
        event.detail['orderCount'] === 0 ? 'No intraday order needed' : 'Intraday Alpaca pass complete',
        `${String(event.detail['orderCount'])} paper orders · slot ${String(event.detail['slot'])} UTC`);
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
  return { latestDecision, lastDecisionAtMs: latest?.at ?? null, decisionDay: day, activity, filterSummary };
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
  readonly dailyWindowMissed?: boolean;
  readonly intradayPending?: boolean;
}) {
  if (!input.exists) return 'none' as const;
  if (input.status === 'stopped') return 'stopped' as const;
  if (input.status === 'paused') return input.pauseReason === 'user_action' ? 'paused' as const : 'attention' as const;
  if (input.lastCheckAtMs === null) return 'awaiting' as const;
  if (input.nowMs - input.lastCheckAtMs > 180_000) return 'attention' as const;
  if (input.checking) return 'evaluating' as const;
  if (input.intradayPending) return 'order_pending' as const;
  const expectedDay = new Date(input.nowMs - 86_400_000).toISOString().slice(0, 10);
  if (input.decisionDay !== expectedDay) return 'awaiting' as const;
  if (input.dailyWindowMissed) return 'intraday' as const;
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
