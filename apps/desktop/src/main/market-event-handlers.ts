import type { Clock } from '@coqui/core';
import { MarketEventService } from '@coqui/services';
import type { Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

export function createMarketEventHandlers(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly requestResearch?: ConstructorParameters<typeof MarketEventService>[0]['requestResearch'];
}): ChannelHandlers {
  const service = new MarketEventService({profileId:input.profileId,database:input.database,clock:input.clock,
    ...(input.requestResearch===undefined?{}:{requestResearch:input.requestResearch})});
  return {
    'market-events.ingest-local': (payload: {
      readonly commandId: string;
      readonly sourceId: string;
      readonly reference: string;
      readonly confirmed: true;
      readonly events: Parameters<MarketEventService['ingestLocal']>[2];
    }) => {
      try {
        return { ok: true, value: { results: service.ingestLocal(payload.sourceId, payload.reference, payload.events)
          .map((result) => ({ ...result, triggerDecisions: result.triggerDecisions.map(({ triggerId, decision, jobId }) =>
            ({ triggerId, jobId, ...decision })) })) } };
      } catch {
        return { ok: false, issues: [{ path: ['events'], code: 'market_event_ingestion_failed' }] };
      }
    },
    'market-events.timeline': (payload: { readonly asOfMs: number | null; readonly limit: number }) => {
      const asOfMs = payload.asOfMs ?? input.clock.nowMs();
      return { ok: true,
        value: { asOfMs, targetInfluence: false as const, executionAuthority: false as const,
        events: service.timeline(asOfMs, payload.limit).map((item) => ({ id: item.event.id,
          sourceId: item.event.sourceId, sourceEventId: item.event.sourceEventId, title: item.event.title,
          summary: item.event.summary, assetSymbols: item.event.assetSymbols,
          publishedAtMs: item.event.publishedAtMs, firstSeenAtMs: item.event.firstSeenAtMs,
          provenance: item.event.provenance, contentHash: item.contentHash, provenanceHash: item.provenanceHash,
          classification: item.classification === null ? null : { classificationId: item.classificationId!,
            classificationHash: item.classificationHash!, classifier: item.classification.classifier,
            classifierVersion: item.classification.classifierVersion, label: item.classification.label,
            sentiment: item.classification.sentiment, importance: item.classification.importance,
            classifiedAtMs: item.classification.classifiedAtMs } })) } };
    },
  };
}
