import { AlpacaPaperError } from '@coqui/adapters';
import type { ParallelPaperEvent } from '@coqui/storage';

type Append = (kind: string, key: string, detail: Record<string, unknown>) => void;

/** A received submit 403 is a refusal; transport failures and lookup 404s are not. */
export function recordParallelRefusal(error: unknown, events: readonly ParallelPaperEvent[], append: Append): boolean {
  if (!(error instanceof AlpacaPaperError) || error.operation !== 'submit' || error.httpStatus !== 403 ||
      error.code !== 'forbidden' || error.networkCode !== null) return false;
  const attempt = events.findLast(event => event.kind === 'submit_attempt');
  if (!attempt || events.some(event => event.kind === 'external_order' &&
      event.detail['clientOrderId'] === attempt.detail['clientOrderId'])) return false;
  append('submission_refused', `refusal:${attempt.id}`, { attemptId: attempt.id,
    clientOrderId: attempt.detail['clientOrderId'], operation: 'submit', httpStatus: 403,
    ...(error.rejection ? { rejection: error.rejection } : {}) });
  return true;
}

/** Bind old observation receipts to the single attempt in flight, never to a later 404. */
export function parallelRefusalReceipts(events: readonly ParallelPaperEvent[]) {
  const receipts = new Map<string, { attempt: ParallelPaperEvent; receipt: ParallelPaperEvent }>();
  const counts = new Map<unknown, number>();
  for (const event of events) if (event.kind === 'submit_attempt') counts.set(event.detail['clientOrderId'], (counts.get(event.detail['clientOrderId']) ?? 0) + 1);
  let attempt: ParallelPaperEvent | undefined;
  for (const event of events) {
    if (event.kind === 'submit_attempt') { attempt = event; continue; }
    if (!attempt || typeof attempt.detail['clientOrderId'] !== 'string' || counts.get(attempt.detail['clientOrderId']) !== 1) continue;
    const explicit = event.kind === 'submission_refused' && event.detail['attemptId'] === attempt.id &&
      event.detail['clientOrderId'] === attempt.detail['clientOrderId'];
    const legacy = event.kind === 'readiness' && event.detail['status'] === 'unavailable' &&
      event.detail['reason'] === 'alpaca_forbidden' && event.detail['attemptCount'] === 1;
    if ((explicit || legacy) && event.detail['operation'] === 'submit' && event.detail['httpStatus'] === 403 &&
        event.at >= attempt.at && event.at - attempt.at <= 10_000 && !event.detail['networkCode'])
      receipts.set(attempt.detail['clientOrderId'], { attempt, receipt: event });
  }
  return receipts;
}

/** Only audited refusals resolve an attempt. Contradictory broker orders invalidate it. */
export function parallelRejectedSubmissions(events: readonly ParallelPaperEvent[]): Set<unknown> {
  const receipts = parallelRefusalReceipts(events), result = new Set<unknown>();
  for (const event of events) {
    if (event.kind !== 'submission_rejected') continue;
    const id = String(event.detail['clientOrderId']), refusal = receipts.get(id);
    if (!refusal || event.detail['attemptId'] !== refusal.attempt.id ||
        event.detail['refusalEventId'] !== refusal.receipt.id || event.at < refusal.receipt.at ||
        events.some(order => order.kind === 'external_order' && order.detail['clientOrderId'] === id)) continue;
    if (!events.some(audit => audit.kind === 'activity_audit' && audit.detail['auditId'] === event.detail['auditId'] &&
        audit.detail['scope'] === 'all_activity_types' && audit.at >= refusal.receipt.at && audit.at <= event.at &&
        events.indexOf(audit) > events.indexOf(refusal.receipt) && events.indexOf(audit) < events.indexOf(event))) continue;
    result.add(id);
  }
  return result;
}
