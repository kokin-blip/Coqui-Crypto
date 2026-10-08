import { parallelExecutionMeasurements } from './parallel-execution-measurement.js';
import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import { Decimal } from 'decimal.js';
import { AlpacaPaperError, type RequestDeadline, type createAlpacaPaperClient } from '@coqui/adapters';
import { activeParallelEvents } from './parallel-paper-plans.js';
import { ParallelReconciliationError } from './parallel-paper-utils.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';

/** Reconcile persisted intents before allowing another paper submission. */
export async function reconcileParallelPaper(input: {
  experiment: ParallelPaperExperiment;
  fullAudit?: boolean;
  deadline?: RequestDeadline;
  client: ReturnType<typeof createAlpacaPaperClient>;
  events: () => readonly ParallelPaperEvent[];
  now: () => number;
  append: (kind: string, key: string, detail: Record<string, unknown>) => void;
}): Promise<void> {
  const { experiment, client } = input;
  const DAY_MS = 86_400_000;
  const events = activeParallelEvents(input.events());
  const intents = events.filter((event) => event.kind === 'external_intent');
  const attempts = new Set(events.filter(e => e.kind === 'submit_attempt').map(e => e.detail['clientOrderId']));
  const orders = new Map(events.filter(e => e.kind === 'external_order').map(e => [e.detail['clientOrderId'], e]));
  const canceled = new Set(events.filter(e => e.kind === 'cancel_requested').map(e => e.detail['orderId']));
  const filled = new Map<unknown, Decimal>();
  for (const event of events) if (event.kind === 'external_fill') {
    const id = event.detail['orderId'];
    filled.set(id, (filled.get(id) ?? new Decimal(0)).plus(String(event.detail['quantity'] ?? '0')));
  }
  for (const intent of intents) {
    const id = String(intent.detail['clientOrderId']);
    if (!attempts.has(id)) continue;
    const last = orders.get(id);
    if (last?.detail['status'] === 'filled' && (filled.get(last.detail['orderId']) ?? new Decimal(0))
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
    const cancelRequested = canceled.has(order.id);
    if (['rejected', 'expired', 'suspended'].includes(order.status) ||
        (order.status === 'canceled' && !cancelRequested)) throw new ParallelReconciliationError('alpaca_order_failed', 'order_lookup');
  }
  const auditDay = new Date(input.now()).toISOString().slice(0, 10);
  const openingDayMs = Date.parse(new Date(experiment.startedAt).toISOString().slice(0, 10));
  const lastAudit = events.findLast(event => ['activity_audit_started', 'activity_audit_progress', 'activity_audit'].includes(event.kind));
  const pendingAudit = lastAudit && lastAudit.kind !== 'activity_audit' && lastAudit.detail['day'] === auditDay &&
    lastAudit.detail['afterMs'] === openingDayMs ? lastAudit : undefined;
  const fullAudit = input.fullAudit === true || pendingAudit !== undefined ||
    !events.some((event) => event.kind === 'activity_audit' && event.detail['day'] === auditDay);
  const lastReconciled = events.findLast(event => event.kind === 'readiness' &&
    event.detail['operation'] === 'activity_reconciliation' && event.detail['status'] === 'validated');
  // Re-read a day of overlap for delayed publication; the daily audit still covers all history.
  const afterMs = fullAudit ? openingDayMs : Math.max(experiment.startedAt, (lastReconciled?.at ?? input.now()) - DAY_MS);
  if (!Number.isFinite(afterMs)) throw new Error('invalid_activity_timestamp');
  const intentIds = new Set(intents.map(intent => intent.detail['clientOrderId']));
  const orderEvents = input.events().filter(event => event.kind === 'external_order');
  const knownOrderIds = new Set(orderEvents.map(event => event.detail['orderId']));
  const ownedOrderIds = new Set(orderEvents.filter(event => intentIds.has(event.detail['clientOrderId']))
    .map(event => event.detail['orderId']));
  const auditId = fullAudit ? String(pendingAudit?.detail['auditId'] ?? `activity-audit:${auditDay}:${events.length}`) : undefined;
  let cursor = typeof pendingAudit?.detail['pageToken'] === 'string' ? pendingAudit.detail['pageToken'] : undefined;
  const pagesCompleted = pendingAudit ? Number(pendingAudit.detail['pagesCompleted']) : 0;
  if (!Number.isSafeInteger(pagesCompleted) || pagesCompleted < 0 || pagesCompleted >= 20)
    throw new ParallelReconciliationError('alpaca_activity_page_limit', 'activities');
  if (fullAudit && !pendingAudit) input.append('activity_audit_started', auditId!,
    { auditId, day: auditDay, afterMs, pagesCompleted: 0 });
  for (let page = pagesCompleted; page < 20; page += 1) {
    input.deadline?.check();
    const previousCursor = cursor;
    const activities = await client.activities(new Date(afterMs).toISOString(), cursor);
    if (!Array.isArray(activities)) throw new ParallelReconciliationError('invalid_alpaca_activity', 'activities');
    for (const item of activities) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 256 || typeof item.activity_type !== 'string')
        throw new ParallelReconciliationError('invalid_alpaca_activity', 'activities');
      // Separate evidence records keep previously booked immutable fills/fees identical on replay.
      if (['FILL', 'CFEE', 'FEE'].includes(item.activity_type)) {
        for (const value of [item.created_at, item.transaction_time, item.date, item.side, item.order_id])
          if (value != null && (typeof value !== 'string' || value.length > 128))
            throw new ParallelReconciliationError('invalid_alpaca_activity', 'activities');
        const metadata = { activityId: item.id, activityType: item.activity_type, createdAt: item.created_at ?? null,
          transactionAt: item.transaction_time ?? null, billingDate: item.date ?? null,
          side: item.side ?? null, orderId: item.order_id ?? null };
        // Provider metadata can be enriched later without rewriting the booked financial activity.
        input.append('broker_activity_metadata', `activity-metadata:${item.id}:${sha256Hex(canonicalJson(metadata))}`, metadata);
      }
      if (['CFEE', 'FEE'].includes(item.activity_type)) {
        input.append('external_fee', `fee:${item.id}`, {
          activityId: item.id, activityType: item.activity_type, orderId: item.order_id ?? null,
          symbol: item.symbol ?? null, quantity: item.qty ?? null, price: item.price ?? null,
          netAmount: item.net_amount ?? null, date: item.date ?? null,
          at: item.transaction_time ?? null, status: item.status ?? null,
          attribution: 'account_activity_not_necessarily_order_linked' });
      }
      if (item.activity_type === 'FILL' && ownedOrderIds.has(item.order_id)) {
        input.append('external_fill', `fill:${item.id}`,
          { activityId: item.id, orderId: item.order_id ?? null, symbol: item.symbol ?? null,
            quantity: item.qty ?? null, price: item.price ?? null, at: item.transaction_time ?? null });
      }
      // A position checkpoint may never hide another client's completed trade.
      if (item.activity_type === 'FILL' && typeof item.transaction_time === 'string' &&
          Date.parse(item.transaction_time) >= experiment.startedAt &&
          !knownOrderIds.has(item.order_id))
        throw new ParallelReconciliationError('unexpected_alpaca_order', 'activities');
    }
    if (activities.length < 100) {
      input.deadline?.check();
      if (fullAudit) input.append('activity_audit', `${auditId}:complete`,
        { auditId, day: auditDay, afterMs, feeStatus: 'queried_not_proof_of_zero_fees' });
      break;
    }
    if (page === 19) throw new ParallelReconciliationError('alpaca_activity_page_limit', 'activities');
    cursor = activities.at(-1)?.id;
    if (cursor === undefined || cursor === previousCursor)
      throw new ParallelReconciliationError('alpaca_activity_page_limit', 'activities');
    if (fullAudit) input.append('activity_audit_progress', `${auditId}:page:${page + 1}`,
      { auditId, day: auditDay, afterMs, pagesCompleted: page + 1, pageToken: cursor });
  }
  input.append('readiness', `reconciled:${input.now()}:${input.events().length}`, { operation: 'activity_reconciliation',
    status: 'validated', observedAtMs: input.now(), intentCount: intents.length });
  const measurementEvents = input.events().filter(event => ['external_order', 'submit_attempt', 'pre_order_quote',
    'external_fill', 'intraday_check', 'execution_measurement'].includes(event.kind));
  const measured = new Set(measurementEvents.filter(event => event.kind === 'execution_measurement').map(event => event.detail['measurementId']));
  for (const measurement of parallelExecutionMeasurements(measurementEvents)) {
    const key = sha256Hex(canonicalJson(measurement as unknown as CanonicalJsonValue));
    if (!measured.has(key))
      input.append('execution_measurement', key, { ...measurement, measurementId: key });
  }
}
