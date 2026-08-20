import {
  decimal,
  holdingsFromLots,
  instrumentKey,
  nonNegativeDecimal,
  summarizePaperBalanceValuation,
  summarizePortfolioValuation,
  type Clock,
  type InstrumentIdentity,
  type InstrumentKey,
  type PriceSource,
  type SpotPriceObservation,
  type SpotPriceQuality,
  type UsdAmount,
} from '@coqui/core';
import {
  type ProfileComparisonFactsErrorCode,
  type ProfileComparisonFactsReader,
  type ProfileManifestStore,
  type StoredProfileComparisonFacts,
  type StoredProfileRecord,
} from '@coqui/storage';

import {
  createProfileOperationGate,
  type AccountProfileIssue,
  type AccountProfileResult,
  type ProfileOperationGate,
} from './profiles.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_COMPARE_PROFILES = 32;
const FACT_READ_CONCURRENCY = 4;
const ZERO_DECIMAL = /^0(?:\.0+)?$/u;

export type ProfileComparisonPricingStatus =
  | 'not_required'
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'failed';

export interface ProfileComparisonSourceCount {
  readonly source: string;
  readonly quality: SpotPriceQuality;
  readonly pricedCount: number;
}

export interface ProfileComparisonPricing {
  readonly status: ProfileComparisonPricingStatus;
  readonly requestedCount: number;
  readonly pricedCount: number;
  readonly unpricedCount: number;
  readonly sources: readonly ProfileComparisonSourceCount[];
}

export interface ProfileTrackedComparison {
  readonly openLotCount: number;
  readonly disposalCount: number;
  readonly pricedSubtotalUsd: UsdAmount;
  readonly completeValueUsd: UsdAmount | null;
  readonly totalCostUsd: UsdAmount;
  readonly pricedUnrealizedPnlUsd: string;
  readonly pricedHoldingCount: number;
  readonly unpricedHoldingCount: number;
  readonly unpricedInstruments: readonly InstrumentKey[];
}

export interface ProfilePaperComparison {
  readonly cashUsd: UsdAmount;
  readonly pricedAssetValueUsd: UsdAmount;
  readonly completeValueUsd: UsdAmount | null;
  readonly pricedAssetCount: number;
  readonly unpricedAssetCount: number;
  readonly unpricedInstruments: readonly InstrumentKey[];
}

interface ProfileComparisonMetadata {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  readonly isActive: boolean;
}

export type ProfileComparisonEntry =
  | (ProfileComparisonMetadata & {
    readonly status: 'available';
    readonly schemaVersion: number;
    readonly tracked: ProfileTrackedComparison;
    readonly paper: ProfilePaperComparison;
    readonly pricing: ProfileComparisonPricing;
  })
  | (ProfileComparisonMetadata & {
    readonly status: 'unavailable';
    readonly reasonCode: ProfileComparisonFactsErrorCode;
    readonly schemaVersion: null;
    readonly tracked: null;
    readonly paper: null;
    readonly pricing: null;
  });

export interface ProfileComparisonView {
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly requestedSource: string;
  readonly requestedProfileCount: number;
  readonly availableProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly pricing: ProfileComparisonPricing;
  readonly profiles: readonly ProfileComparisonEntry[];
}

export interface AccountsProfileComparisonDependencies {
  readonly clock: Clock;
  readonly manifestStore: ProfileManifestStore;
  readonly factsReader: ProfileComparisonFactsReader;
  readonly priceSource: PriceSource;
  readonly operationGate?: ProfileOperationGate;
}

interface LoadedFacts {
  readonly record: StoredProfileRecord;
  readonly facts: StoredProfileComparisonFacts | null;
  readonly failure: ProfileComparisonFactsErrorCode | null;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function failure(code: AccountProfileIssue['code']): AccountProfileResult<never> {
  return freeze({ ok: false, issues: [{ path: [], code }] });
}

function safeNow(clock: Clock): number | null {
  try {
    const value = clock.nowMs();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function validObservation(value: unknown): SpotPriceObservation | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<SpotPriceObservation>;
  const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
  if (source.length === 0 || typeof candidate.priceUsd !== 'string' ||
    (candidate.quality !== 'venue_reported_last' && candidate.quality !== 'reference_market') ||
    (candidate.observedAtMs !== null &&
      (!Number.isSafeInteger(candidate.observedAtMs) || candidate.observedAtMs === undefined ||
        candidate.observedAtMs < 0))) return null;
  try {
    const priceUsd = nonNegativeDecimal(candidate.priceUsd);
    if (ZERO_DECIMAL.test(priceUsd)) return null;
    return Object.freeze({
      priceUsd,
      source,
      quality: candidate.quality,
      observedAtMs: candidate.observedAtMs,
    });
  } catch {
    return null;
  }
}

function paperInstrument(key: InstrumentKey): InstrumentIdentity | null {
  const [venue, productType, productId, extra] = key.split('|');
  if (venue !== 'coinbase' || productType !== 'spot' || !productId || extra !== undefined) return null;
  return { venue, productType, productId };
}

function sourceCounts(
  keys: ReadonlySet<InstrumentKey>,
  observations: ReadonlyMap<InstrumentKey, SpotPriceObservation>,
): ProfileComparisonSourceCount[] {
  const counts = new Map<string, ProfileComparisonSourceCount>();
  for (const key of keys) {
    const observation = observations.get(key);
    if (!observation) continue;
    const countKey = `${observation.source}\0${observation.quality}`;
    const prior = counts.get(countKey);
    counts.set(countKey, {
      source: observation.source,
      quality: observation.quality,
      pricedCount: (prior?.pricedCount ?? 0) + 1,
    });
  }
  return [...counts.values()].sort((left, right) =>
    left.source.localeCompare(right.source) || left.quality.localeCompare(right.quality));
}

function pricing(
  keys: ReadonlySet<InstrumentKey>,
  observations: ReadonlyMap<InstrumentKey, SpotPriceObservation>,
  failed: boolean,
): ProfileComparisonPricing {
  const requestedCount = keys.size;
  const pricedCount = [...keys].filter((key) => observations.has(key)).length;
  const status: ProfileComparisonPricingStatus = requestedCount === 0
    ? 'not_required'
    : failed
      ? 'failed'
      : pricedCount === requestedCount
        ? 'complete'
        : pricedCount === 0 ? 'unavailable' : 'partial';
  return freeze({
    status,
    requestedCount,
    pricedCount,
    unpricedCount: requestedCount - pricedCount,
    sources: sourceCounts(keys, observations),
  });
}

async function readBounded(
  records: readonly StoredProfileRecord[],
  reader: ProfileComparisonFactsReader,
): Promise<LoadedFacts[]> {
  const results = new Array<LoadedFacts>(records.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(FACT_READ_CONCURRENCY, records.length) }, async () => {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      const record = records[index]!;
      try {
        const read = await reader.read(record.id, record.dbFilename);
        results[index] = read.ok
          ? { record, facts: read.facts, failure: null }
          : { record, facts: null, failure: read.code };
      } catch {
        results[index] = { record, facts: null, failure: 'unavailable' };
      }
    }
  }));
  return results;
}

function metadata(record: StoredProfileRecord, activeId: string): ProfileComparisonMetadata {
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    icon: record.icon,
    isActive: record.id === activeId,
  };
}

/** Bounded, secret-free comparison over detached facts from isolated profile databases. */
export class AccountsProfileComparisonService {
  readonly #clock: Clock;
  readonly #manifestStore: ProfileManifestStore;
  readonly #factsReader: ProfileComparisonFactsReader;
  readonly #priceSource: PriceSource;
  readonly #sourceName: string;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileComparisonDependencies) {
    const sourceName = dependencies.priceSource.name.trim();
    if (!sourceName) throw new TypeError('A profile comparison price source requires a name.');
    this.#clock = dependencies.clock;
    this.#manifestStore = dependencies.manifestStore;
    this.#factsReader = dependencies.factsReader;
    this.#priceSource = dependencies.priceSource;
    this.#sourceName = sourceName;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async compare(profileIds?: readonly string[]): Promise<AccountProfileResult<ProfileComparisonView>> {
    if (profileIds !== undefined && (!Array.isArray(profileIds) ||
      profileIds.length > MAX_COMPARE_PROFILES || new Set(profileIds).size !== profileIds.length ||
      profileIds.some((id) => typeof id !== 'string' || (id !== 'main' && !UUID_V4.test(id))))) {
      return failure('profile_compare_invalid_selection');
    }
    if (!this.#operationGate.begin()) return failure('profile_operation_in_progress');
    let selected: StoredProfileRecord[];
    let activeId: string;
    let loadedFacts: LoadedFacts[];
    try {
      let loaded: ReturnType<ProfileManifestStore['read']>;
      try {
        loaded = this.#manifestStore.read();
      } catch {
        return failure('profile_store_unavailable');
      }
      if (!loaded.ok) return failure(loaded.code === 'corrupt'
        ? 'profile_store_corrupt'
        : 'profile_store_unavailable');
      if (!loaded.value) return failure('profile_store_unavailable');
      const requested = profileIds && profileIds.length > 0 ? new Set(profileIds) : null;
      if (requested && [...requested].some((id) =>
        !loaded.value!.manifest.profiles.some((profile) => profile.id === id))) {
        return failure('profile_not_found');
      }
      selected = loaded.value.manifest.profiles
        .filter((profile) => requested === null || requested.has(profile.id))
        .sort((left, right) => left.order - right.order);
      activeId = loaded.value.manifest.activeProfileId;
      loadedFacts = await readBounded(selected, this.#factsReader);
    } finally {
      this.#operationGate.end();
    }

    const instruments = new Map<InstrumentKey, InstrumentIdentity>();
    for (const loaded of loadedFacts) {
      if (!loaded.facts) continue;
      for (const lot of loaded.facts.openLots) {
        const key = instrumentKey(lot.asset.instrument);
        if (!instruments.has(key)) instruments.set(key, lot.asset.instrument);
      }
      for (const balance of loaded.facts.paperBalances) {
        if (balance.assetId === 'USD' || instruments.has(balance.assetId)) continue;
        const identity = paperInstrument(balance.assetId);
        if (identity) instruments.set(balance.assetId, identity);
      }
    }
    const requestedAtMs = safeNow(this.#clock);
    if (requestedAtMs === null) return failure('profile_compare_invalid_metadata');
    let receivedAtMs = requestedAtMs;
    let priceFailed = false;
    const observations = new Map<InstrumentKey, SpotPriceObservation>();
    if (instruments.size > 0) {
      try {
        const returned = await this.#priceSource.spot([...instruments.values()].map((item) => ({ ...item })));
        const received = safeNow(this.#clock);
        if (received === null) return failure('profile_compare_invalid_metadata');
        receivedAtMs = received;
        for (const key of instruments.keys()) {
          const observation = validObservation(returned.get(key));
          if (observation) observations.set(key, observation);
        }
      } catch {
        const received = safeNow(this.#clock);
        if (received === null) return failure('profile_compare_invalid_metadata');
        receivedAtMs = received;
        priceFailed = true;
      }
    }
    const prices: Partial<Record<InstrumentKey, UsdAmount>> = Object.create(null) as
      Partial<Record<InstrumentKey, UsdAmount>>;
    for (const [key, observation] of observations) prices[key] = observation.priceUsd;

    const profiles: ProfileComparisonEntry[] = loadedFacts.map((loaded) => {
      const base = metadata(loaded.record, activeId);
      if (!loaded.facts || loaded.failure) return freeze({
        ...base,
        status: 'unavailable' as const,
        reasonCode: loaded.failure ?? 'corrupt',
        schemaVersion: null,
        tracked: null,
        paper: null,
        pricing: null,
      });
      const holdings = holdingsFromLots(loaded.facts.openLots, prices);
      const valuation = summarizePortfolioValuation(holdings);
      const paper = summarizePaperBalanceValuation(loaded.facts.paperBalances, prices);
      const keys = new Set<InstrumentKey>();
      for (const holding of holdings) keys.add(instrumentKey(holding.asset.instrument));
      for (const balance of loaded.facts.paperBalances) {
        if (balance.assetId !== 'USD') keys.add(balance.assetId);
      }
      const unpricedInstruments = holdings
        .filter((holding) => holding.valueUsd === null)
        .map((holding) => instrumentKey(holding.asset.instrument))
        .sort();
      return freeze({
        ...base,
        status: 'available' as const,
        schemaVersion: loaded.facts.schemaVersion,
        tracked: {
          openLotCount: loaded.facts.openLots.length,
          disposalCount: loaded.facts.disposalCount,
          pricedSubtotalUsd: valuation.totalValueUsd,
          completeValueUsd: valuation.unpricedCount === 0 ? valuation.totalValueUsd : null,
          totalCostUsd: valuation.totalCostUsd,
          pricedUnrealizedPnlUsd: decimal(valuation.totalUnrealizedPnlUsd),
          pricedHoldingCount: valuation.pricedCount,
          unpricedHoldingCount: valuation.unpricedCount,
          unpricedInstruments,
        },
        paper,
        pricing: pricing(keys, observations, priceFailed),
      });
    });
    const availableProfileCount = profiles.filter((profile) => profile.status === 'available').length;
    return freeze({
      ok: true,
      value: {
        requestedAtMs,
        receivedAtMs,
        requestedSource: this.#sourceName,
        requestedProfileCount: profiles.length,
        availableProfileCount,
        unavailableProfileCount: profiles.length - availableProfileCount,
        pricing: pricing(new Set(instruments.keys()), observations, priceFailed),
        profiles,
      },
    });
  }
}
