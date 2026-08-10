import {
  type MarketProviderName,
  type ProviderAssetMapping,
  type ProviderMarketSnapshot,
  type ProviderMarketSource,
} from '@coqui/adapters';
import { instrumentKey, type InstrumentIdentity, type InstrumentKey } from '@coqui/core';

export interface ProviderComparisonMetric {
  readonly provider: MarketProviderName;
  readonly ok: boolean;
  readonly status: number;
  readonly latencyMs: number;
  readonly mappedAssets: number;
  readonly returnedAssets: number;
  readonly coveragePct: number;
  readonly snapshots: ReadonlyMap<InstrumentKey, ProviderMarketSnapshot>;
}

export interface PairwisePriceDeviation {
  readonly instrument: InstrumentIdentity;
  readonly left: MarketProviderName;
  readonly right: MarketProviderName;
  /** Symmetric absolute difference relative to the pair midpoint. */
  readonly midpointDeviationBps: number;
}

export interface ProviderComparisonReport {
  readonly providers: readonly ProviderComparisonMetric[];
  readonly priceDeviations: readonly PairwisePriceDeviation[];
}

export interface ProviderComparisonOptions {
  readonly sources: readonly ProviderMarketSource[];
  readonly mappings: readonly ProviderAssetMapping[];
  /** Injectable monotonic-enough clock for deterministic tests. */
  readonly now?: () => number;
}

function hasProviderId(
  mapping: ProviderAssetMapping,
  provider: MarketProviderName,
): boolean {
  if (provider === 'coingecko') return Boolean(mapping.coingeckoId?.trim());
  if (provider === 'coinpaprika') return Boolean(mapping.coinPaprikaId?.trim());
  return mapping.coinMarketCapId !== null &&
    Number.isSafeInteger(mapping.coinMarketCapId) &&
    mapping.coinMarketCapId > 0;
}

function safeDuration(start: number, end: number): number {
  const duration = end - start;
  return Number.isFinite(duration) && duration >= 0
    ? Math.round(duration * 100) / 100
    : 0;
}

function deviationBps(left: string, right: string): number | null {
  const leftValue = Number(left);
  const rightValue = Number(right);
  const midpoint = (leftValue + rightValue) / 2;
  if (
    !Number.isFinite(leftValue) ||
    !Number.isFinite(rightValue) ||
    !Number.isFinite(midpoint) ||
    midpoint <= 0
  ) return null;
  return Math.round(Math.abs(leftValue - rightValue) / midpoint * 1_000_000) / 100;
}

function pairwiseDeviations(
  metrics: readonly ProviderComparisonMetric[],
): PairwisePriceDeviation[] {
  const deviations: PairwisePriceDeviation[] = [];
  for (let leftIndex = 0; leftIndex < metrics.length; leftIndex += 1) {
    const left = metrics[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.length; rightIndex += 1) {
      const right = metrics[rightIndex]!;
      for (const [key, leftSnapshot] of left.snapshots) {
        const rightSnapshot = right.snapshots.get(key);
        if (!rightSnapshot) continue;
        const midpointDeviationBps = deviationBps(
          leftSnapshot.priceUsd,
          rightSnapshot.priceUsd,
        );
        if (midpointDeviationBps === null) continue;
        deviations.push({
          instrument: leftSnapshot.instrument,
          left: left.provider,
          right: right.provider,
          midpointDeviationBps,
        });
      }
    }
  }
  return deviations;
}

/** Compare reference providers without promoting any of them to execution truth. */
export async function compareMarketProviders(
  options: ProviderComparisonOptions,
): Promise<ProviderComparisonReport> {
  const now = options.now ?? Date.now;
  const providers = await Promise.all(options.sources.map(async (source) => {
    const mappedKeys = new Set(options.mappings
      .filter((mapping) => hasProviderId(mapping, source.name))
      .map((mapping) => instrumentKey(mapping.instrument)));
    const start = now();
    const result = await source.fetch(options.mappings);
    const latencyMs = safeDuration(start, now());
    const snapshots = result.ok ? result.snapshots : new Map<InstrumentKey, ProviderMarketSnapshot>();
    const returnedAssets = snapshots.size;
    const mappedAssets = mappedKeys.size;
    return {
      provider: source.name,
      ok: result.ok,
      status: result.ok ? 200 : result.status,
      latencyMs,
      mappedAssets,
      returnedAssets,
      coveragePct: mappedAssets === 0
        ? 0
        : Math.round(returnedAssets / mappedAssets * 10_000) / 100,
      snapshots,
    } satisfies ProviderComparisonMetric;
  }));
  return { providers, priceDeviations: pairwiseDeviations(providers) };
}
