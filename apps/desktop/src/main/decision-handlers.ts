import type { Clock } from '@coqui/core';
import { getDecisionDetail, listDecisionTimeline, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

export function createDecisionHandlers(
  profileId: string, clock: Clock, database: Db,
): ChannelHandlers {
  return {
    'decision.timeline': (payload: {
      readonly assetScope: string | null; readonly asOfMs: number | null; readonly limit: number;
    }) => ({ ok: true, value: { items: listDecisionTimeline({
      profileId, assetScope: payload.assetScope, asOfMs: payload.asOfMs, limit: payload.limit,
    }, database), asOfMs: payload.asOfMs ?? clock.nowMs() } }),
    'decision.detail': (payload: { readonly decisionId: string }) => {
      const detail = getDecisionDetail(profileId, payload.decisionId, database);
      return detail === null
        ? { ok: false, issues: [{ path: ['decisionId'], code: 'decision_not_found' }] }
        : { ok: true, value: detail };
    },
  };
}
