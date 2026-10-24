import type { VenueOutcome } from './venue.js';
import type { PaperOrder, PaperOrderState } from '@coqui/core';
import { appendPaperOrderEvent, type Db } from '@coqui/storage';

/** Legacy ledger arithmetic check, extracted unchanged to keep OMS within its file-size boundary. */
export function fillIsSelfConsistent(outcome: Extract<VenueOutcome, { filled: true }>): boolean {
  const expected = Number(outcome.quantity) * Number(outcome.executionPrice);
  const actual = Number(outcome.notional);
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-9);
  return Math.abs(actual - expected) <= tolerance;
}

/** Existing event serialization retained exactly for historical compatibility. */
export function appendOmsEvent(database: Db, order: PaperOrder, state: PaperOrderState, sequence: number, at: number, detail: Record<string, unknown>): void {
  appendPaperOrderEvent({ id: `${order.id}:${sequence}`, orderId: order.id, profileId: order.profileId, sequence, state, at,
    detailJson: JSON.stringify({ paperOnly: true, ...detail }) }, database);
}
