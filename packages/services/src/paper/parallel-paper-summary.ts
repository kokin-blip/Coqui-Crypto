import { activeParallelEvents } from './parallel-paper-plans.js';
import { parallelReconciliationAttention } from './parallel-paper-attention.js';
import { EXECUTION_COST_MODELS } from '@coqui/core';
import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';
import type { ParallelPaperDependencies } from './parallel-paper-service.js';
import { parallelDayReconciled, parallelRuntimeState, projectParallelPaperActivity } from './parallel-paper-activity.js';
import { projectParallelMlStatus, readParallelMlSignal } from './parallel-ml-status.js';
import { hourlyShadowStatus } from './parallel-hourly-shadow.js';
import { parallelFeeAccounting } from './parallel-fee-accounting.js';
import { money } from './parallel-paper-utils.js';
export function parallelPaperSummary(current: {experiment: ParallelPaperExperiment | null; status: 'none' | 'active' | 'paused' | 'stopped'; events: readonly ParallelPaperEvent[]}, input: ParallelPaperDependencies, lastCheckAtMs: number | null, checking: boolean) {
    const experiment = current.experiment, events = current.events;
    const mark = [...events].reverse().find((event) => event.kind === 'account_mark');
    const latestState = [...events].reverse().find((event) => ['paused', 'resumed', 'stopped', 'started'].includes(event.kind));
    const { latestDecision, lastDecisionAtMs, decisionDay, activity, filterSummary } = projectParallelPaperActivity(events), completed = parallelDayReconciled(events, decisionDay);
    const runtimeState = parallelRuntimeState({ exists: experiment !== null, status: current.status,
      pauseReason: latestState?.detail['reason'], lastCheckAtMs: lastCheckAtMs, checking: checking,
      nowMs: input.clock.nowMs(), decisionDay, completed,
      dailyWindowMissed: events.some((event) => event.kind === 'daily_window_missed' && event.detail['day'] === decisionDay),
      intradayPending: activeParallelEvents(events).some((event) => event.kind === 'external_intent' && event.detail['slot'] !== undefined &&
        !events.some((other) => other.kind === 'external_order' &&
          other.detail['clientOrderId'] === event.detail['clientOrderId'] && other.detail['status'] === 'filled')) });
    const coquiEquity = mark === undefined ? null : String(mark.detail['coquiEquityUsd']),
      alpacaEquity = mark === undefined ? null : String(mark.detail['alpacaEquityUsd']);
    const percent = (currentValue: string | null, opening: string): string | null => currentValue === null
      ? null : money(currentValue).div(opening).minus(1).mul(100).toDecimalPlaces(2).toFixed(2);
    return {
      experimentId: experiment?.id ?? null, state: current.status,
      startedAtMs: experiment?.startedAt ?? null,
      coquiOpeningUsd: experiment?.openingCoquiCash ?? null,
      alpacaOpeningUsd: experiment?.openingAlpacaEquity ?? null,
      coquiEquityUsd: coquiEquity, alpacaEquityUsd: alpacaEquity,
      coquiReturnPct: experiment === null ? null : percent(coquiEquity, experiment.openingCoquiCash),
      alpacaReturnPct: experiment === null ? null : percent(alpacaEquity, experiment.openingAlpacaEquity),
      lastMarkDay: mark === undefined ? null : String(mark.detail['markKey'] ?? mark.detail['day']),
      decisionCount: events.filter((event) => event.kind === 'decision').length,
      reconciliationAttention: parallelReconciliationAttention(events, current.status),
      slotOutcomes: events.filter((event) => event.kind === 'slot_finalized').slice(-18).reverse().map((event) => ({
        slotMs: Number(event.detail['slotMs']), outcome: String(event.detail['outcome']),
        reason: typeof event.detail['reason'] === 'string' ? event.detail['reason'] : null,
        inferred: event.detail['inferred'] === true })),
      runtimeState, lastCheckAtMs: lastCheckAtMs,
      lastDecisionAtMs, latestDecision, activity, filterSummary,
      mlSignal: projectParallelMlStatus(events, readParallelMlSignal(input.mlSignal)),
      hourlyShadow: hourlyShadowStatus(input.profileId, input.database),
      coquiFillCount: events.filter((event) => event.kind === 'local_fill').length,
      alpacaFillCount: events.filter((event) => event.kind === 'external_fill').length,
      alpacaOrderCount: events.filter((event) => event.kind === 'external_intent').length,
      coquiFeesUsd: events.filter((event) => event.kind === 'local_fill')
        .reduce((sum, event) => sum.plus(String(event.detail['fee'])), new Decimal(0)).toFixed(2),
      alpacaBookedFeesUsd: null,
      feeAccounting: parallelFeeAccounting(events, experiment),
      alpacaModeledFrictionUsd: events.filter((event) => event.kind === 'external_fill')
        .reduce((sum, event) => event.detail['quantity'] === null || event.detail['price'] === null
          ? sum : sum.plus(money(String(event.detail['quantity'])).abs()
            .mul(String(event.detail['price'])).mul(new Decimal(EXECUTION_COST_MODELS.legacyLocal.fee)
              .plus(EXECUTION_COST_MODELS.legacyLocal.spread).plus(EXECUTION_COST_MODELS.legacyLocal.slippage))), new Decimal(0)).toFixed(2),
      positions: mark === undefined ? [] : mark.detail['positions'],
      targets: mark === undefined ? [] : mark.detail['targets'],
      recentTrades: events.filter((event) => ['local_fill', 'external_fill'].includes(event.kind))
        .slice(-20).map((event) => ({ source: event.kind === 'local_fill' ? 'coqui' as const : 'alpaca_paper' as const,
          atMs: event.at, symbol: String(event.detail['symbol'] ?? ''),
          quantity: String(event.detail['qty'] ?? event.detail['quantity'] ?? ''),
          price: String(event.detail['fillPrice'] ?? event.detail['price'] ?? ''),
          feeUsd: event.kind === 'local_fill' ? String(event.detail['fee']) : null })),
      lastReason: latestState?.kind === 'paused' ? String(latestState.detail['reason']) : null,
      paperOnly: true as const,
    };
  }

