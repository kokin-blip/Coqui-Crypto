import type {
  AssetYield,
  FearGreedReading,
  NewsItem,
  PolicyItem,
  ProviderMarketSnapshot,
  ReferenceResult,
  TrendingCoin,
} from '@coqui/adapters';
import {
  instrumentKey,
  type Clock,
  type InstrumentIdentity,
  type InstrumentKey,
  type MarketBar,
} from '@coqui/core';

import {
  displayFailure,
  referenceProvenance,
  sourceIssue,
  FEED_POLICIES,
  type BarProvenance,
  type DisplayQueryResult,
  type ReferenceFeedPolicy,
  type ReferenceProvenance,
} from './display-provenance.js';

const MAX_LIMIT = 100;
const MAX_LOOKBACK_DAYS = 1_825;
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;

/** Every reference view is the payload plus the provenance that qualifies it. */
export interface ReferenceView<T> {
  readonly data: T;
  readonly provenance: ReferenceProvenance;
}

export interface ReferencePrice {
  readonly instrument: InstrumentIdentity;
  readonly priceUsd: string;
  readonly change24hPct: number | null;
  readonly providerUpdatedAtMs: number | null;
}

export interface ReferenceMarketRow extends ReferencePrice {
  readonly marketCapUsd: string | null;
  readonly volume24hUsd: string | null;
  readonly marketCapRank: number | null;
}

export interface NewsView {
  readonly headlines: readonly NewsItem[];
  readonly policy: readonly PolicyItem[];
}

export interface CandleView {
  readonly instrument: InstrumentIdentity;
  readonly bars: readonly MarketBar[];
  readonly provenance: BarProvenance;
}

/**
 * Narrow source ports. The service depends on these rather than on concrete
 * adapters so tests inject fakes and no service reaches the network directly.
 */
export interface ReferenceSources {
  prices(signal?: AbortSignal): Promise<ReferenceResult<ReadonlyMap<InstrumentKey, ProviderMarketSnapshot>>>;
  markets(signal?: AbortSignal): Promise<ReferenceResult<ReadonlyMap<InstrumentKey, ProviderMarketSnapshot>>>;
  fearGreed(signal?: AbortSignal): Promise<ReferenceResult<FearGreedReading>>;
  trending(signal?: AbortSignal): Promise<ReferenceResult<readonly TrendingCoin[]>>;
  yields(signal?: AbortSignal): Promise<ReferenceResult<ReadonlyMap<string, AssetYield>>>;
  headlines(limit: number, signal?: AbortSignal): Promise<ReferenceResult<readonly NewsItem[]>>;
  policy(limit: number, signal?: AbortSignal): Promise<ReferenceResult<readonly PolicyItem[]>>;
}

export interface CandleSource {
  dailyBars(
    instrument: InstrumentIdentity,
    lookbackDays: number,
    nowMs: number,
    signal?: AbortSignal,
  ): Promise<{ readonly ok: true; readonly bars: readonly MarketBar[] } | { readonly ok: false }>;
}

export interface MarketDisplayQueryDependencies {
  readonly clock: Clock;
  readonly sources: ReferenceSources;
  readonly candles: CandleSource;
}

function validInstrument(instrument: InstrumentIdentity): boolean {
  return (
    instrument.venue === 'coinbase' &&
    instrument.productType === 'spot' &&
    PRODUCT.test(instrument.productId)
  );
}

function snapshotPrice(snapshot: ProviderMarketSnapshot): ReferencePrice {
  return {
    instrument: snapshot.instrument,
    priceUsd: snapshot.priceUsd,
    change24hPct: snapshot.change24hPct,
    providerUpdatedAtMs: snapshot.providerUpdatedAtMs,
  };
}

function snapshotRow(snapshot: ProviderMarketSnapshot): ReferenceMarketRow {
  return {
    ...snapshotPrice(snapshot),
    marketCapUsd: snapshot.marketCapUsd,
    volume24hUsd: snapshot.volume24hUsd,
    marketCapRank: snapshot.marketCapRank,
  };
}

/**
 * Bounded, provenance-bearing read facade over the keyless reference feeds and
 * canonical Coinbase bars.
 *
 * Two properties distinguish it from the predecessor's handlers. Every success
 * states where the value came from, when it was observed, and how fresh that
 * makes it. Every failure names which failure occurred instead of degrading to
 * an empty array that a surface would render as "nothing is happening".
 */
export class MarketDisplayQueryService {
  readonly #clock: Clock;
  readonly #sources: ReferenceSources;
  readonly #candles: CandleSource;

  constructor(dependencies: MarketDisplayQueryDependencies) {
    this.#clock = dependencies.clock;
    this.#sources = dependencies.sources;
    this.#candles = dependencies.candles;
  }

  /** Reference prices only. These never splice into Coinbase decision bars. */
  async prices(signal?: AbortSignal): Promise<DisplayQueryResult<ReferenceView<readonly ReferencePrice[]>>> {
    return this.#reference(
      ['prices'],
      FEED_POLICIES.prices,
      (abort) => this.#sources.prices(abort),
      (snapshots) => [...snapshots.values()].map(snapshotPrice),
      signal,
    );
  }

  /** Reference market snapshot with source and observation time. */
  async markets(signal?: AbortSignal): Promise<DisplayQueryResult<ReferenceView<readonly ReferenceMarketRow[]>>> {
    return this.#reference(
      ['markets'],
      FEED_POLICIES.markets,
      (abort) => this.#sources.markets(abort),
      (snapshots) =>
        [...snapshots.values()]
          .map(snapshotRow)
          .sort((left, right) => (left.marketCapRank ?? Number.MAX_SAFE_INTEGER) -
            (right.marketCapRank ?? Number.MAX_SAFE_INTEGER)),
      signal,
    );
  }

  /** Keyless sentiment gauge. Decision context for a human, never a trading input. */
  async fearGreed(signal?: AbortSignal): Promise<DisplayQueryResult<ReferenceView<FearGreedReading>>> {
    return this.#reference(
      ['fearGreed'],
      FEED_POLICIES.fearGreed,
      (abort) => this.#sources.fearGreed(abort),
      (reading) => reading,
      signal,
    );
  }

  /** Search interest, not performance. Informational only. */
  async trending(signal?: AbortSignal): Promise<DisplayQueryResult<ReferenceView<readonly TrendingCoin[]>>> {
    return this.#reference(
      ['trending'],
      FEED_POLICIES.trending,
      (abort) => this.#sources.trending(abort),
      (coins) => coins,
      signal,
    );
  }

  /** Best single-asset earn rate per token, with staleness metadata. */
  async yields(signal?: AbortSignal): Promise<DisplayQueryResult<ReferenceView<readonly AssetYield[]>>> {
    return this.#reference(
      ['yields'],
      FEED_POLICIES.yields,
      (abort) => this.#sources.yields(abort),
      (best) => [...best.values()].sort((left, right) => right.apyPct - left.apyPct),
      signal,
    );
  }

  /**
   * Headlines and official policy events. Awareness only: news has no archive
   * aligned to decision-time prices, so no rule built on it could be validated.
   */
  async news(limit = 12, signal?: AbortSignal): Promise<DisplayQueryResult<ReferenceView<NewsView>>> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
      return displayFailure(['news', 'limit'], 'invalid_limit');
    }

    const requestedAtMs = this.#now();
    if (requestedAtMs === null) return displayFailure(['news'], 'clock_unavailable');

    const [headlines, policy] = await Promise.all([
      this.#sources.headlines(limit, signal),
      this.#sources.policy(limit, signal),
    ]);

    // Policy is a supplement to headlines. Losing it degrades the view; losing
    // headlines means the news layer itself is unavailable and must say so.
    if (!headlines.ok) return displayFailure(['news'], sourceIssue(headlines.code));

    const receivedAtMs = this.#now() ?? requestedAtMs;
    const observedAtMs = headlines.observedAtMs ?? (policy.ok ? policy.observedAtMs : null);
    return {
      ok: true,
      value: {
        data: { headlines: headlines.value, policy: policy.ok ? policy.value : [] },
        provenance: referenceProvenance(
          FEED_POLICIES.news,
          requestedAtMs,
          receivedAtMs,
          observedAtMs,
        ),
      },
    };
  }

  /**
   * Canonical, completed, timestamped Coinbase bars.
   *
   * Unlike every other query here this is decision-grade data, so it carries
   * `BarProvenance` rather than reference provenance and drops any bar the
   * venue has not closed — invariant 6 forbids observing an in-progress bar.
   */
  async candles(
    instrument: InstrumentIdentity,
    lookbackDays: number,
    signal?: AbortSignal,
  ): Promise<DisplayQueryResult<CandleView>> {
    if (!validInstrument(instrument)) {
      return displayFailure(['candles', 'instrument'], 'invalid_instrument');
    }
    if (
      !Number.isSafeInteger(lookbackDays) ||
      lookbackDays <= 0 ||
      lookbackDays > MAX_LOOKBACK_DAYS
    ) {
      return displayFailure(['candles', 'lookbackDays'], 'invalid_lookback');
    }

    const requestedAtMs = this.#now();
    if (requestedAtMs === null) return displayFailure(['candles'], 'clock_unavailable');

    const result = await this.#candles.dailyBars(instrument, lookbackDays, requestedAtMs, signal);
    if (!result.ok) return displayFailure(['candles'], 'bars_unavailable');

    const key = instrumentKey(instrument);
    const bars = result.bars.filter((bar) => bar.isComplete && bar.assetId === key);
    if (bars.length === 0) return displayFailure(['candles'], 'bars_incomplete');

    return {
      ok: true,
      value: {
        instrument,
        bars,
        provenance: {
          source: 'coinbase',
          requestedAtMs,
          receivedAtMs: this.#now() ?? requestedAtMs,
          interval: '1d',
          completedBarsOnly: true,
          informationalOnly: false,
        },
      },
    };
  }

  #now(): number | null {
    try {
      const value = this.#clock.nowMs();
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async #reference<S, T>(
    path: readonly string[],
    policy: ReferenceFeedPolicy,
    load: (signal?: AbortSignal) => Promise<ReferenceResult<S>>,
    project: (value: S) => T,
    signal?: AbortSignal,
  ): Promise<DisplayQueryResult<ReferenceView<T>>> {
    const requestedAtMs = this.#now();
    if (requestedAtMs === null) return displayFailure(path, 'clock_unavailable');

    const result = await load(signal);
    if (!result.ok) return displayFailure(path, sourceIssue(result.code));

    const receivedAtMs = this.#now() ?? requestedAtMs;
    return {
      ok: true,
      value: {
        data: project(result.value),
        provenance: referenceProvenance(
          policy,
          requestedAtMs,
          receivedAtMs,
          result.observedAtMs,
        ),
      },
    };
  }
}
