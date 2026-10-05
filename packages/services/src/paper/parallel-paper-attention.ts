import type { ParallelPaperEvent } from '@coqui/storage';
import { parallelAttemptsResolved } from './parallel-paper-recovery.js';
import { parallelPaperFailureDetail, parallelSafeOperation } from './parallel-paper-utils.js';
import type { PaperPositionDifference } from './parallel-paper-utils.js';

/** Persistent projection independent of the short activity timeline. */
export function parallelReconciliationAttention(events: readonly ParallelPaperEvent[], state: string) {
  const successful = events.findLast((event) => event.kind === 'readiness' &&
    event.detail['operation'] === 'broker_reconciliation' && event.detail['status'] === 'validated');
  const failure = events.findLast((event) => event.kind === 'reconciliation_error' || (event.kind === 'paused' && event.detail['reason'] !== 'user_action'));
  const pause = events.findLast((event) => ['paused', 'resumed', 'started', 'stopped'].includes(event.kind));
  const unknown = (!successful || (pause !== undefined && events.indexOf(successful) < events.indexOf(pause))) && state === 'paused' && ['paper_execution_unknown', 'submission_outcome_unknown', 'broker_positions_mismatch'].includes(String(pause?.detail['reason']));
  const failedAfterSuccess = failure !== undefined && events.indexOf(failure) > (successful ? events.indexOf(successful) : -1);
  const unresolvedOrders = events.filter((event) => event.kind === 'submit_attempt').flatMap((attempt) => {
    const order = events.findLast((event) => event.kind === 'external_order' && event.detail['clientOrderId'] === attempt.detail['clientOrderId']);
    const fills = events.filter((event) => event.kind === 'external_fill' && event.detail['orderId'] === order?.detail['orderId']);
    if (parallelAttemptsResolved([attempt, ...(order ? [order] : []), ...fills])) return [];
    return [{ clientOrderId: String(attempt.detail['clientOrderId']),
      orderId: typeof order?.detail['orderId'] === 'string' ? order.detail['orderId'] : null }];
  });
  const number = (key: string) => typeof failure?.detail[key] === 'number' ? failure.detail[key] as number : null;
  // Reasons and operations were written by the safe diagnostic boundary; old generic rows remain unknown.
  const operation = typeof failure?.detail['operation'] === 'string' ? parallelSafeOperation(failure.detail['operation']) : null;
  const reason = typeof failure?.detail['reason'] === 'string'
    ? parallelPaperFailureDetail(new Error(failure.detail['reason']), 'reconciliation_unavailable').reason : null;
  const positionDifferences = Array.isArray(failure?.detail['positionDifferences'])
    ? (failure.detail['positionDifferences'] as PaperPositionDifference[]).slice(0, 100) : [];
  return { blocked: state !== 'stopped' && (unknown || failedAfterSuccess || unresolvedOrders.length > 0),
    lastSuccessfulAtMs: successful?.at ?? null,
    latestFailure: failure ? { atMs: failure.at, operation, reason,
      httpStatus: number('httpStatus'), attemptCount: number('attemptCount'), remainingMs: number('remainingMs'), positionDifferences } : null,
    unresolvedOrders };
}
