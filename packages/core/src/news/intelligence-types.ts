import type { InstrumentIdentity } from '../types/instrument.js';
import type { MarketEventLabel } from '../events/market-event.js';
import type { NewsEntity, NewsProviderId } from './types.js';

export interface NewsInstrumentIdentity extends InstrumentIdentity { readonly venue: 'coinbase' }
export type NewsAsset = 'BTC' | 'ETH' | 'SOL';
export interface NewsIntelligenceConfiguration {
  readonly schemaVersion: 1;
  readonly reviewedAtMs: number;
  readonly instruments: readonly { readonly asset: NewsAsset; readonly instrument: NewsInstrumentIdentity }[];
  readonly publisherAliases: readonly { readonly from: string; readonly to: string }[];
}
export interface NewsRegistryEvidence {
  readonly asset: NewsAsset;
  readonly instrument: NewsInstrumentIdentity;
  readonly name: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
export interface NewsResolution {
  readonly candidate: string;
  readonly origin: 'text' | 'provider';
  readonly entityIndex: number | null;
  readonly asset: NewsAsset | null;
  readonly instrument: NewsInstrumentIdentity | null;
  readonly status: 'resolved' | 'unresolved';
  readonly reason: 'explicit_name' | 'crypto_qualified' | 'provider_crypto' | 'ambiguous_ticker' |
    'equity' | 'unsupported' | 'missing_registry' | 'quote_currency';
}
export interface NewsInstrumentAnalysis {
  readonly asset: NewsAsset;
  readonly instrument: NewsInstrumentIdentity;
  readonly sentimentScore: number | null;
  readonly sentimentReason: 'positive' | 'negative' | 'conflicting' | 'insufficient' | 'unsupported_language';
  readonly clauses: readonly string[];
  readonly providerEntities: readonly { readonly index: number; readonly entity: NewsEntity }[];
}
export interface NewsObservationAnalysis {
  readonly schemaVersion: 1;
  readonly observationId: string;
  readonly providerRecordId: string;
  readonly observedAtMs: number;
  readonly articleId: string;
  readonly provider: NewsProviderId;
  readonly availableAtMs: number;
  readonly firstAvailableAtMs: number;
  readonly publisher: string;
  readonly title: string;
  readonly description: string | null;
  readonly eventLabel: MarketEventLabel;
  readonly resolutions: readonly NewsResolution[];
  readonly instruments: readonly NewsInstrumentAnalysis[];
}
export interface NewsClusterMatch {
  readonly leftArticleId: string;
  readonly rightArticleId: string;
  readonly kind: 'exact_title' | 'similar_title';
  readonly similarity: number;
}
export interface NewsClusterSnapshot {
  readonly schemaVersion: 1;
  readonly algorithmVersion: 'news-syndication-v1';
  readonly inputCutoffMs: number;
  readonly id: string;
  readonly articleIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly publishers: readonly string[];
  readonly matches: readonly NewsClusterMatch[];
}
export interface NewsFeatureWindow {
  readonly windowMs: 3_600_000 | 86_400_000;
  readonly articleCount: number;
  readonly groupCount: number;
  readonly publisherCount: number;
  readonly sentimentMean: number | null;
  readonly sentimentSampleCount: number;
  readonly providerSentimentMean: number | null;
  readonly providerSentimentSampleCount: number;
  readonly eventCounts: Readonly<Record<MarketEventLabel, number>>;
  readonly dataAgeSeconds: number | null;
}
export interface NewsFeatureSnapshot {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly runId: string;
  readonly featureVersion: 'news-features-v1' | 'news-features-window-v2';
  readonly instrument: NewsInstrumentIdentity;
  readonly cadence: 'hourly' | 'daily';
  readonly decisionAtMs: number;
  readonly availableAtMs: number;
  readonly reconstruction: boolean;
  readonly windows: readonly NewsFeatureWindow[];
  readonly volumeZScore24h: number | null;
  readonly baselineSnapshotIds: readonly string[];
  readonly clusterSnapshotIds: readonly string[];
  readonly coverageComplete: null;
  readonly coverage: readonly { readonly provider: NewsProviderId; readonly reserved: number;
    readonly succeeded: number; readonly failed: number; readonly pending: number }[];
  readonly missingReasons: readonly string[];
}
export interface NewsAnalysisRun {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly algorithmVersion: 'news-intelligence-v1' | 'news-intelligence-window-v2';
  readonly inputWindowStartMs?: number | undefined;
  readonly chunkIds?: readonly string[] | undefined;
  readonly inputCutoffMs: number;
  readonly completedAtMs: number;
  readonly persistedAtMs: number;
  readonly availableAtMs: number;
  readonly configuration: NewsIntelligenceConfiguration;
  readonly registry: readonly NewsRegistryEvidence[];
  readonly inputObservationIds: readonly string[];
}
