import { canonicalJson, type CanonicalJsonValue } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';
import { paperPendingFeeDetail } from './parallel-paper-utils.js';

interface ActivityEvent {
  event: ParallelPaperEvent;
  firstAtMs?: number;
  repeatCount?: number;
}
// These diagnostics do not represent a change in financial evidence or activation.
const CHECK_DIAGNOSTICS = new Set(['scheduler_check', 'broker_read_attempt', 'readiness',
  'readiness_check', 'slot_outcome', 'position_snapshot', 'broker_position_snapshot', 'activity_audit_started', 'activity_audit', 'activity_audit_progress', 'market_refresh_started', 'market_refresh_finished']);

/** Presentation only: journal records remain immutable and complete. */
export function groupFeeWaitActivity(events: readonly ParallelPaperEvent[]): ActivityEvent[] {
  const result: ActivityEvent[] = [];
  let previousIndex = -1, previousFingerprint = '';
  for (const event of events) {
    const fees = paperPendingFeeDetail(event.detail['pendingFeeEvidence']);
    const waiting = ['reconciliation_error', 'pass_deferred'].includes(event.kind) &&
      event.detail['reason'] === 'broker_positions_mismatch' && fees !== null;
    const recovery = event.kind === 'reconciliation_error' && typeof event.detail['reason'] === 'string';
    if (waiting || recovery) {
      const differences = event.detail['positionDifferences'];
      const fingerprint = canonicalJson({ kind: event.kind, operation: event.detail['operation'] ?? null,
        reason: event.detail['reason'] ?? null, httpStatus: event.detail['httpStatus'] ?? null,
        networkCode: event.detail['networkCode'] ?? null, attemptCount: event.detail['attemptCount'] ?? null,
        feeReconciliation: event.detail['feeReconciliation'] ?? null, clientOrderId: event.detail['clientOrderId'] ?? null,
        requiredReservationMs: event.detail['requiredReservationMs'] ?? null,
        status: fees?.status ?? null, oldestFillAtMs: fees?.oldestFillAtMs ?? null, latestFillAtMs: fees?.latestFillAtMs ?? null,
        differences: Array.isArray(differences) ? [...differences].sort((a, b) =>
          String(a.symbol).localeCompare(String(b.symbol))) : null } as CanonicalJsonValue);
      if (previousIndex >= 0 && previousFingerprint === fingerprint) {
        const item = result[previousIndex]!;
        item.firstAtMs ??= item.event.at;
        item.repeatCount = (item.repeatCount ?? 1) + 1;
        item.event = { ...event, id: item.event.id };
        continue;
      }
      const item = { event };
      result.push(item);
      previousIndex = result.length - 1;
      previousFingerprint = fingerprint;
    } else {
      result.push({ event });
      if (!CHECK_DIAGNOSTICS.has(event.kind) || (event.kind === 'readiness' &&
          event.detail['status'] === 'validated' && ['broker_reconciliation', 'resume_preflight'].includes(String(event.detail['operation'])))) previousIndex = -1;
    }
  }
  return result;
}
