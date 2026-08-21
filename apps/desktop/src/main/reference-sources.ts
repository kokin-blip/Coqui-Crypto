import {
  fetchCoinbaseDailyBars,
  fetchCoinGeckoMarketSnapshots,
  fetchFearGreed,
  fetchNewsHeadlines,
  fetchPolicyItems,
  fetchTrendingCoins,
  fetchYields,
  referenceFailure,
  type HttpClient,
  type ProviderMarketSnapshot,
  type ReferenceResult,
} from '@coqui/adapters';
import type { AssetRef, InstrumentIdentity, InstrumentKey, MarketBar } from '@coqui/core';
import type { CandleSource, ReferenceSources } from '@coqui/services';

/**
 * Binds the display-query ports to real adapters.
 *
 * The service defines these ports and the composition root satisfies them
 * (`ARCHITECTURE.md` §7). Nothing in `packages/services` reaches the network,
 * so this file is where an `HttpClient` first appears.
 */
export interface ReferenceSourceDependencies {
  /** api.coingecko.com, rate-limited for that host. */
  readonly coingecko: HttpClient;
  /** api.exchange.coinbase.com, the decision-bar venue. */
  readonly coinbase: HttpClient;
  readonly fearGreed: HttpClient;
  readonly yields: HttpClient;
  readonly news: HttpClient;
  /**
   * The profile's tracked instruments. Reference prices are only ever fetched
   * for assets the user actually tracks; there is no "fetch the whole market"
   * path, which is what keeps a free keyless tier viable.
   */
  readonly trackedAssets: () => readonly AssetRef[];
}

function toProviderSnapshot(
  snapshot: Awaited<ReturnType<typeof fetchCoinGeckoMarketSnapshots>> extends ReadonlyMap<
    InstrumentKey,
    infer TSnapshot
  >
    ? TSnapshot
    : never,
): ProviderMarketSnapshot {
  return {
    provider: 'coingecko',
    providerId: snapshot.coingeckoId,
    instrument: snapshot.instrument,
    priceUsd: snapshot.priceUsd,
    marketCapUsd: snapshot.marketCapUsd,
    volume24hUsd: snapshot.volume24hUsd,
    marketCapRank: snapshot.marketCapRank,
    change24hPct: snapshot.change24hPct,
    providerUpdatedAtMs: snapshot.providerUpdatedAtMs,
  };
}

export function createReferenceSources(
  dependencies: ReferenceSourceDependencies,
): ReferenceSources {
  async function snapshots(): Promise<
    ReferenceResult<ReadonlyMap<InstrumentKey, ProviderMarketSnapshot>>
  > {
    const assets = dependencies.trackedAssets();
    // A profile with no tracked assets has genuinely nothing to price. That is
    // an empty view with real provenance, not a failure and not a stub.
    if (assets.length === 0) {
      return { ok: true, value: new Map(), observedAtMs: null };
    }

    const raw = await fetchCoinGeckoMarketSnapshots(dependencies.coingecko, assets);
    const mapped = new Map<InstrumentKey, ProviderMarketSnapshot>();
    let newestObservation: number | null = null;
    for (const [key, snapshot] of raw) {
      mapped.set(key, toProviderSnapshot(snapshot));
      const updated = snapshot.providerUpdatedAtMs;
      if (updated !== null && (newestObservation === null || updated > newestObservation)) {
        newestObservation = updated;
      }
    }

    // The adapter returns an empty map for a transport failure as well as for a
    // genuinely empty result. Distinguishing them matters to the surface, so a
    // request that asked for assets and received nothing is reported as a
    // failure rather than as "no assets are trading".
    if (mapped.size === 0) return { ok: false, code: 'invalid_response' };
    return { ok: true, value: mapped, observedAtMs: newestObservation };
  }

  return {
    prices: snapshots,
    markets: snapshots,
    fearGreed: (signal) => fetchFearGreed(dependencies.fearGreed, signal),
    trending: (signal) => fetchTrendingCoins(dependencies.coingecko, signal),
    yields: (signal) => fetchYields(dependencies.yields, signal),
    headlines: (limit, signal) => fetchNewsHeadlines(dependencies.news, limit, signal),
    policy: (limit, signal) => fetchPolicyItems(dependencies.news, limit, signal),
  };
}

export function createCandleSource(http: HttpClient): CandleSource {
  return {
    async dailyBars(
      instrument: InstrumentIdentity,
      lookbackDays: number,
      nowMs: number,
    ): Promise<{ readonly ok: true; readonly bars: readonly MarketBar[] } | { readonly ok: false }> {
      const result = await fetchCoinbaseDailyBars(http, instrument, {
        maxDays: lookbackDays,
        nowMs,
      });
      return result.ok ? { ok: true, bars: result.data } : { ok: false };
    },
  };
}

/** Re-exported so the composition root maps transport failures consistently. */
export { referenceFailure };
