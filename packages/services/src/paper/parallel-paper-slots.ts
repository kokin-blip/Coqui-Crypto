import { parallelAttemptsResolved } from './parallel-paper-recovery.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '@coqui/storage';

const SLOT_MS = 14_400_000, WINDOW_MS = 900_000;
export type ParallelSlotOutcome = 'observed' | 'no_order' | 'pending_order' | 'stale_quote' | 'stale_evidence' | 'paused' | 'host_unavailable';

/** Close expired windows once, including windows for which the host left no observations. */
export function finalizeParallelSlots(experiment: ParallelPaperExperiment, events: readonly ParallelPaperEvent[], nowMs: number,
  append: (kind: string, key: string, detail: Record<string, unknown>) => void): void {
  const finalized = new Set(events.filter((event) => event.kind === 'slot_finalized').map((event) => event.detail['slotMs']));
  const stopped = events.find((event) => event.kind === 'stopped');
  const end = Math.min(nowMs, stopped?.at ?? nowMs);
  for (let slot = Math.floor(experiment.startedAt / SLOT_MS) * SLOT_MS; slot + WINDOW_MS <= end; slot += SLOT_MS) {
    if (slot + WINDOW_MS <= experiment.startedAt || finalized.has(slot)) continue;
    const within = events.filter((event) => event.at >= Math.max(slot, experiment.startedAt) && event.at < slot + WINDOW_MS);
    const slotKey = new Date(slot).toISOString().slice(0, 13);
    const dayKey = new Date(slot - 86_400_000).toISOString().slice(0, 10);
    const daily = new Date(slot).getUTCHours() === 0;
    const complete = within.some((event) => daily ? event.kind === 'external_complete' && event.detail['day'] === dayKey
      : event.kind === 'intraday_complete' && event.detail['slot'] === slotKey);
    const attempts = within.filter((event) => event.kind === 'submit_attempt').length;
    const skip = [...within].reverse().find((event) => event.kind === 'intraday_skipped');
    const pause = [...events].reverse().find((event) => event.at < slot + WINDOW_MS &&
      ['paused', 'resumed', 'started', 'stopped'].includes(event.kind));
    const checked = within.some((event) => event.kind === 'scheduler_check');
    let outcome: ParallelSlotOutcome, reason: string | null = null;
    if (complete) {
      const attemptedIds = new Set(within.filter((event) => event.kind === 'submit_attempt').map((event) => event.detail['clientOrderId']));
      const evidence = events.filter((event) => event.at < slot + WINDOW_MS &&
        (event.kind !== 'submit_attempt' || attemptedIds.has(event.detail['clientOrderId'])));
      outcome = attempts ? parallelAttemptsResolved(evidence) ? 'observed' : 'pending_order' : 'no_order';
    }
    else if (!checked) { outcome = 'host_unavailable'; reason = 'no_scheduler_observation'; }
    else if (skip) { reason = String(skip.detail['reason']); outcome = reason === 'stale_alpaca_quote' ? 'stale_quote' : 'stale_evidence'; }
    else if (pause?.kind === 'paused') { reason = String(pause.detail['reason']); outcome = reason === 'stale_alpaca_quote' ? 'stale_quote' : 'paused'; }
    else if (attempts || within.some((event) => event.kind === 'slot_outcome' && event.detail['outcome'] === 'pending_order')) outcome = 'pending_order';
    else { outcome = 'stale_evidence'; reason = 'no_completed_pass'; }
    append('slot_finalized', `slot-finalized:${slot}`, { slotMs: slot, outcome, reason,
      inferred: outcome === 'host_unavailable', observedAtMs: nowMs });
  }
}
