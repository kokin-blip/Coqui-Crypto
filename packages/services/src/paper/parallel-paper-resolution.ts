import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

/** A paper-only exception resolution is not a fill, fee, or tax-lot adjustment. */
export function paperPositionFingerprint(events: readonly ParallelPaperEvent[]): string {
  return sha256Hex(canonicalJson(events.filter((event) => ['external_fill', 'external_fee', 'external_order'].includes(event.kind))
    .map((event) => ({ id: event.id, kind: event.kind, detail: event.detail })) as CanonicalJsonValue));
}
export function currentPaperPositionResolution(events: readonly ParallelPaperEvent[]) {
  const fingerprint = paperPositionFingerprint(events);
  return events.findLast((event) => event.kind === 'paper_position_resolution' &&
    event.detail['scope'] === 'paper_only' && event.detail['ledgerFingerprint'] === fingerprint);
}
