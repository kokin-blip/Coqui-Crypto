import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import { sha256Hex } from '../crypto/sha256.js';

export type MarketEventLabel = 'macro' | 'regulatory' | 'exchange' | 'security' |
  'protocol' | 'market_structure' | 'other';
export type MarketEventSentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface MarketEventV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly sourceId: string;
  readonly sourceEventId: string;
  readonly title: string;
  readonly summary: string;
  readonly assetSymbols: readonly string[];
  readonly publishedAtMs: number;
  readonly firstSeenAtMs: number;
  readonly provenance: { readonly kind: 'local_fixture'; readonly reference: string };
}

export interface MarketEventClassificationV1 {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly classifier: 'deterministic' | 'llm';
  readonly classifierVersion: string;
  readonly label: MarketEventLabel;
  readonly sentiment: MarketEventSentiment;
  readonly importance: 'low' | 'medium' | 'high';
  readonly classifiedAtMs: number;
}

export function marketEventId(profileId: string, sourceId: string, sourceEventId: string): string {
  return sha256Hex(`market-event-v1:${profileId}:${sourceId}:${sourceEventId}`);
}

export function marketEventJson(event: MarketEventV1): string {
  return canonicalJson(event as unknown as CanonicalJsonValue);
}

export function marketEventHash(event: MarketEventV1): string { return sha256Hex(marketEventJson(event)); }
export function marketEventClassificationJson(value: MarketEventClassificationV1): string {
  return canonicalJson(value as unknown as CanonicalJsonValue);
}

const RULES: ReadonlyArray<readonly [MarketEventLabel, RegExp]> = [
  ['security', /\b(?:exploit|hack|breach|vulnerability|stolen)\b/iu],
  ['regulatory', /\b(?:regulation|regulatory|regulator|regulators|sec\b|cftc\b|law|lawsuit|court|ban\b|approval)\b/iu],
  ['exchange', /\b(?:exchange|listing|delisting|custody|withdrawal|outage)\b/iu],
  ['macro', /\b(?:federal reserve|fed\b|inflation|interest rate|gdp|employment)\b/iu],
  ['protocol', /\b(?:protocol|mainnet|hard fork|upgrade|validator|consensus)\b/iu],
  ['market_structure', /\b(?:liquidation|etf\b|volatility|market maker|open interest)\b/iu],
];

/** Stable, non-predictive categorization. It cannot produce a target or order. */
export function classifyMarketEvent(event: Pick<MarketEventV1, 'title' | 'summary'>,
  classifiedAtMs: number): Omit<MarketEventClassificationV1, 'eventId'> {
  const text = `${event.title} ${event.summary}`;
  const label = RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
  const negative = /\b(?:exploit|hack|breach|stolen|ban\b|lawsuit|outage|delisting|collapse)\b/iu.test(text);
  const positive = /\b(?:approval|approved|adoption|upgrade|launch|restored)\b/iu.test(text);
  return { schemaVersion: 1, classifier: 'deterministic', classifierVersion: 'market-event-rules-v1',
    label, sentiment: negative ? 'negative' : positive ? 'positive' : 'neutral',
    importance: label === 'security' || label === 'regulatory' ? 'high' : label === 'other' ? 'low' : 'medium',
    classifiedAtMs };
}

export const EVENT_ALPHA_TARGET_INFLUENCE = false as const;
export const EVENT_EXECUTION_AUTHORITY = false as const;
