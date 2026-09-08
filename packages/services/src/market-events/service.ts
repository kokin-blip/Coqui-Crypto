import { canonicalJson, classifyMarketEvent, marketEventId,
  type CanonicalJsonValue, type Clock, type MarketEventClassificationV1,
  type MarketEventLabel, type MarketEventSentiment, type MarketEventV1 } from '@coqui/core';
import { inTransaction, listMarketEventsAsOf, listResearchEventTriggers,
  saveMarketEvent, saveMarketEventClassification, type Db } from '@coqui/storage';

import { ResearchTriggerCoordinator, type ResearchTriggerDecision } from '../research/triggers.js';

export interface LocalMarketEventInput {
  readonly sourceEventId: string;
  readonly title: string;
  readonly summary?: string;
  readonly assetSymbols?: readonly string[];
  readonly publishedAtMs: number;
  readonly firstSeenAtMs: number;
}

export interface MarketEventIngestResult {
  readonly eventId: string;
  readonly inserted: boolean;
  readonly contentHash: string;
  readonly classificationId: string;
  readonly triggerDecisions: readonly { readonly triggerId: string; readonly decision: ResearchTriggerDecision; readonly jobId: string|null }[];
  readonly targetInfluence: false;
  readonly executionAuthority: false;
}

export interface BoundedEventLabeler {
  readonly name: string;
  readonly version: string;
  classify(inputJson: string): Promise<unknown>;
}

const LABELS = new Set<MarketEventLabel>(['macro','regulatory','exchange','security','protocol','market_structure','other']);
const SENTIMENTS = new Set<MarketEventSentiment>(['positive','neutral','negative','unknown']);

function llmResult(value: unknown): Pick<MarketEventClassificationV1, 'label'|'sentiment'|'importance'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('invalid_classifier_result');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'importance,label,sentiment' ||
      !LABELS.has(row['label'] as MarketEventLabel) || !SENTIMENTS.has(row['sentiment'] as MarketEventSentiment) ||
      !['low','medium','high'].includes(String(row['importance']))) throw new TypeError('invalid_classifier_result');
  return { label: row['label'] as MarketEventLabel, sentiment: row['sentiment'] as MarketEventSentiment,
    importance: row['importance'] as 'low'|'medium'|'high' };
}

export class MarketEventService {
  readonly #triggers: ResearchTriggerCoordinator;
  constructor(private readonly input: { readonly profileId: string; readonly database: Db; readonly clock: Clock;
    readonly requestResearch?: (triggerId:string,at:number)=>{readonly decision:ResearchTriggerDecision;readonly jobId:string|null} }) {
    this.#triggers = new ResearchTriggerCoordinator(input.database);
  }

  ingestLocal(sourceId: string, reference: string, values: readonly LocalMarketEventInput[]): readonly MarketEventIngestResult[] {
    if (values.length < 1 || values.length > 100) throw new TypeError('invalid_event_batch');
    const now = this.input.clock.nowMs();
    return inTransaction(this.input.database, () => values.map((value) => {
      if (value.firstSeenAtMs > now) throw new TypeError('future_first_seen_time');
      const event: MarketEventV1 = { schemaVersion: 1,
        id: marketEventId(this.input.profileId, sourceId, value.sourceEventId), profileId: this.input.profileId,
        sourceId, sourceEventId: value.sourceEventId, title: value.title, summary: value.summary ?? '',
        assetSymbols: Object.freeze([...new Set(value.assetSymbols ?? [])].sort()),
        publishedAtMs: value.publishedAtMs, firstSeenAtMs: value.firstSeenAtMs,
        provenance: { kind: 'local_fixture', reference } };
      const output = inTransaction(this.input.database, () => {
        const saved = saveMarketEvent(event, this.input.database);
        const classified = { ...classifyMarketEvent(event, event.firstSeenAtMs), eventId: event.id };
        const classificationId = saveMarketEventClassification(classified, this.input.database);
        return { saved, classificationId };
      });
      const triggerDecisions = output.saved.inserted ? listResearchEventTriggers(this.input.database).map((trigger) => {
        const result=this.input.requestResearch?.(trigger.id,event.firstSeenAtMs)??
          {decision:this.#triggers.request(trigger.id,1,event.firstSeenAtMs),jobId:null};
        return {triggerId:trigger.id,...result};
      }) : [];
      return Object.freeze({ eventId: event.id, inserted: output.saved.inserted,
        contentHash: output.saved.stored.contentHash, classificationId: output.classificationId,
        triggerDecisions, targetInfluence: false as const, executionAuthority: false as const });
    }));
  }

  timeline(asOfMs: number, limit: number) {
    return listMarketEventsAsOf(this.input.profileId, asOfMs, limit, this.input.database);
  }

  async classifyWithLlm(eventId: string, labeler: BoundedEventLabeler): Promise<string> {
    const now = this.input.clock.nowMs();
    const stored = this.timeline(now, 200).find((item) => item.event.id === eventId);
    if (stored === undefined) throw new TypeError('event_unavailable');
    const supplied = canonicalJson({ title: stored.event.title, summary: stored.event.summary,
      assetSymbols: stored.event.assetSymbols, publishedAtMs: stored.event.publishedAtMs,
      firstSeenAtMs: stored.event.firstSeenAtMs } as unknown as CanonicalJsonValue);
    const parsed = llmResult(await labeler.classify(supplied));
    const value: MarketEventClassificationV1 = { schemaVersion: 1, eventId,
      classifier: 'llm', classifierVersion: `${labeler.name}-${labeler.version}`,
      ...parsed, classifiedAtMs: now };
    return saveMarketEventClassification(value, this.input.database);
  }
}

export function parseLocalMarketEventFixture(json: string): readonly LocalMarketEventInput[] {
  if (Buffer.byteLength(json, 'utf8') > 256 * 1024) throw new RangeError('event_fixture_too_large');
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new TypeError('invalid_event_fixture');
  return parsed as readonly LocalMarketEventInput[];
}
