/** Provider metadata is evidence, never a resolved instrument or trading signal. */
export type NewsProviderId = 'marketaux' | 'currents' | 'gdelt';

export interface NewsQuery {
  readonly symbols?: readonly string[] | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly publishedAfterMs?: number | undefined;
  readonly limit: number;
}

export interface NewsEntity {
  readonly symbol: string;
  readonly assetClass: 'crypto' | 'equity' | 'unknown';
  readonly providerEntityType: string | null;
  readonly exchange: string | null;
  /** Raw provider relevance, not a probability or a value bounded to one. */
  readonly matchScore: number | null;
  readonly sentimentScore: number | null;
}

export interface NewsObservation {
  readonly schemaVersion: 1;
  readonly provider: NewsProviderId;
  readonly providerArticleId: string | null;
  readonly title: string;
  readonly url: string;
  readonly sourceDomain: string;
  readonly description: string | null;
  readonly publishedAtMs: number | null;
  /** Provider crawl/index time; never substituted for publication or receipt. */
  readonly providerObservedAtMs: number | null;
  /** Actual application receipt time of this metadata revision. */
  readonly observedAtMs: number;
  readonly language: string | null;
  readonly entities: readonly NewsEntity[];
}

export interface NewsFetchResult {
  readonly articles: readonly NewsObservation[];
  readonly cursor?: string | undefined;
  readonly requestCost: number;
}

export interface NewsProvider {
  readonly id: NewsProviderId;
  fetchLatest(query: NewsQuery, signal?: NewsAbortSignal): Promise<NewsFetchResult>;
}

/** Structural cancellation contract accepting native AbortSignal without DOM types. */
export interface NewsAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface StoredNewsObservation {
  readonly observationId: string;
  readonly articleId: string;
  readonly providerRecordId: string;
  readonly canonicalUrl: string;
  readonly urlHash: string;
  readonly normalizationVersion: 1;
  readonly contentHash: string;
  readonly observation: NewsObservation;
  readonly persistedAtMs: number;
  readonly availableAtMs: number;
}
