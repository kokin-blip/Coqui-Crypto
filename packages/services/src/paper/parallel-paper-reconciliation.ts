import { parallelExecutionMeasurements } from './parallel-execution-measurement.js';
import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import { Decimal } from 'decimal.js';
import { AlpacaPaperError, type createAlpacaPaperClient } from '@coqui/adapters';
import { activeParallelEvents } from './parallel-paper-plans.js';
import { ParallelReconciliationError } from './parallel-paper-utils.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';

/** Reconcile persisted intents before allowing another paper submission. */
export async function reconcileParallelPaper(input: {
  experiment: ParallelPaperExperiment;
  fullAudit?: boolean;
  client: ReturnType<typeof createAlpacaPaperClient>;
  events: () => readonly ParallelPaperEvent[];
  now: () => number;
  append: (kind: string, key: string, detail: Record<string, unknown>) => void;
}): Promise<void> {
  const { experiment, client } = input;
  const DAY_MS = 86_400_000;
  const events = activeParallelEvents(input.events());
  const intents = events.filter((event) => event.kind === 'external_intent');
  for (const intent of intents) {
    const id = String(intent.detail['clientOrderId']);
    const attempted = events.some((event) => event.kind === 'submit_attempt' && event.detail['clientOrderId'] === id);
    if (!attempted) continue;
    const last = [...events].reverse().find((event) => event.kind === 'external_order' && event.detail['clientOrderId'] === id);
    if (last?.detail['status'] === 'filled' && events.filter((event) => event.kind === 'external_fill' &&
        event.detail['orderId'] === last.detail['orderId'])
      .reduce((sum, event) => sum.plus(String(event.detail['quantity'] ?? '0')), new Decimal(0))
      .equals(String(last.detail['filledQty']))) continue;
    let order;
    try { order = await client.orderByClientId(id); }
    catch (error) {
      if (error instanceof AlpacaPaperError && error.code === 'not_found') {
        throw new ParallelReconciliationError('submission_outcome_unknown', 'order_lookup', error);
      }
      throw error;
    }
    if (order.client_order_id !== id || order.symbol.replace('/', '') !== String(intent.detail['symbol']).replace('/', '') ||
        order.side !== intent.detail['side']) throw new ParallelReconciliationError('broker_order_identity_mismatch', 'order_lookup');
    input.append('external_order', `order:${order.id}:${order.status}:${order.filled_qty}`,
      { clientOrderId: id, orderId: order.id, status: order.status, filledQty: order.filled_qty,
        filledAvgPrice: order.filled_avg_price, symbol: order.symbol, side: order.side });
    const cancelRequested = events.some((event) => event.kind === 'cancel_requested' && event.detail['orderId'] === order.id);
    if (['rejected', 'expired', 'suspended'].includes(order.status) ||
        (order.status === 'canceled' && !cancelRequested)) throw new ParallelReconciliationError('alpaca_order_failed', 'order_lookup');
  }
  const latestFill = [...events].reverse().find((event) => event.kind === 'external_fill' &&
    typeof event.detail['at'] === 'string');
  const auditDay = new Date(input.now()).toISOString().slice(0, 10);
  const fullAudit = input.fullAudit === true || !events.some((event) => event.kind === 'activity_audit' && event.detail['day'] === auditDay);
  const afterMs = fullAudit || latestFill === undefined ? Date.parse(new Date(experiment.startedAt).toISOString().slice(0, 10))
    : Math.max(experiment.startedAt, Date.parse(String(latestFill.detail['at'])) - DAY_MS);
  if (!Number.isFinite(afterMs)) throw new Error('invalid_activity_timestamp');
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const activities = await client.activities(new Date(afterMs).toISOString(), cursor);
    if (!Array.isArray(activities)) throw new ParallelReconciliationError('invalid_alpaca_activity', 'activities');
    for (const item of activities) {
      if (['CFEE', 'FEE'].includes(item.activity_type)) {
        input.append('external_fee', `fee:${item.id}`, {
          activityId: item.id, activityType: item.activity_type, orderId: item.order_id ?? null,
          symbol: item.symbol ?? null, quantity: item.qty ?? null, price: item.price ?? null,
          netAmount: item.net_amount ?? null, date: item.date ?? null,
          at: item.transaction_time ?? null, status: item.status ?? null,
          attribution: 'account_activity_not_necessarily_order_linked' });
      }
      if (item.activity_type === 'FILL' && intents.some((intent) => input.events().some((event) => event.kind === 'external_order' &&
          event.detail['clientOrderId'] === intent.detail['clientOrderId'] && event.detail['orderId'] === item.order_id))) {
        input.append('external_fill', `fill:${item.id}`,
          { activityId: item.id, orderId: item.order_id ?? null, symbol: item.symbol ?? null,
            quantity: item.qty ?? null, price: item.price ?? null, at: item.transaction_time ?? null });
      }
    }
    if (activities.length < 100) {
      if (fullAudit) input.append('activity_audit', `activity-audit:${auditDay}`,
        { day: auditDay, afterMs, feeStatus: 'queried_not_proof_of_zero_fees' });
      break;
    }
    if (page === 19) throw new ParallelReconciliationError('alpaca_activity_page_limit', 'activities');
    cursor = activities.at(-1)?.id;
    if (cursor === undefined) throw new ParallelReconciliationError('alpaca_activity_page_limit', 'activities');
  }
  input.append('readiness', `reconciled:${input.now()}:${input.events().length}`, { operation: 'activity_reconciliation',
    status: 'validated', observedAtMs: input.now(), intentCount: intents.length });
  for (const measurement of parallelExecutionMeasurements(input.events())) {
    const key = sha256Hex(canonicalJson(measurement as unknown as CanonicalJsonValue));
    if (!input.events().some((event) => event.kind === 'execution_measurement' && event.detail['measurementId'] === key))
      input.append('execution_measurement', key, { ...measurement, measurementId: key });
  }
}
