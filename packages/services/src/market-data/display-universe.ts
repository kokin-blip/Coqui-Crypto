import type {
  CoinbaseCatalogFailureCode,
  CoinbaseCatalogSource,
} from '@coqui/adapters';
import {
  instrumentKey,
  type AssetRef,
  type Clock,
  type InstrumentIdentity,
} from '@coqui/core';
import {
  listDisplayUniverse,
  recordCoinbaseCatalogAssets,
  replaceDisplayUniverse,
  type Db,
} from '@coqui/storage';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const ASSET = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;

export type DisplayUniverseIssueCode =
  | 'invalid_profile_id'
  | 'invalid_query'
  | 'invalid_offset'
  | 'invalid_limit'
  | 'invalid_selection'
  | 'duplicate_instrument'
  | 'unknown_instrument'
  | 'clock_unavailable'
  | 'id_source_invalid'
  | 'catalog_cancelled'
  | 'catalog_shutdown'
  | 'catalog_elapsed_budget_exhausted'
  | 'catalog_timeout'
  | 'catalog_network'
  | 'catalog_rate_limited'
  | 'catalog_http'
  | 'catalog_invalid_response'
  | 'catalog_response_too_large'
  | 'catalog_conflicting_duplicate'
  | 'storage_rejected';

export interface DisplayUniverseIssue {
  readonly path: readonly string[];
  readonly code: DisplayUniverseIssueCode;
}

export type DisplayUniverseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DisplayUniverseIssue[] };

export interface CatalogSearchView {
  readonly profileId: string;
  readonly provider: 'coinbase';
  readonly query: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly items: readonly AssetRef[];
}

export interface DisplayUniverseView {
  readonly profileId: string;
  readonly provider: 'coinbase';
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly catalogOffset: number;
  readonly catalogLimit: number;
  readonly catalogHasMore: boolean;
  readonly catalog: readonly AssetRef[];
  readonly tracked: readonly AssetRef[];
  readonly researchUniverseMutated: false;
}

export interface DisplayUniverseMutationView {
  readonly profileId: string;
  readonly recordedAtMs: number;
  readonly changed: boolean;
  readonly selectionHash: string;
  readonly tracked: readonly AssetRef[];
  readonly researchUniverseMutated: false;
}

export interface DisplayUniverseEventIdSource {
  nextId(): string;
}

export interface DisplayUniverseServiceDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly catalog: CoinbaseCatalogSource;
  readonly idSource: DisplayUniverseEventIdSource;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: DisplayUniverseIssueCode): DisplayUniverseIssue {
  return freeze({ path: [...path], code });
}

function failed(path: readonly string[], code: DisplayUniverseIssueCode): DisplayUniverseResult<never> {
  return freeze({ ok: false, issues: [issue(path, code)] });
}

function safeNow(clock: Clock): number | null {
  try {
    const value = clock.nowMs();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function catalogIssue(code: CoinbaseCatalogFailureCode): DisplayUniverseIssueCode {
  return `catalog_${code}` as DisplayUniverseIssueCode;
}

function detachedAsset(value: unknown): AssetRef | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const identity = row['instrument'];
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) return null;
  const canonical = identity as Record<string, unknown>;
  if (canonical['venue'] !== 'coinbase' || canonical['productType'] !== 'spot' ||
    typeof canonical['productId'] !== 'string' || !PRODUCT.test(canonical['productId']) ||
    typeof row['symbol'] !== 'string' || !ASSET.test(row['symbol']) ||
    typeof row['baseAsset'] !== 'string' || !ASSET.test(row['baseAsset']) ||
    row['quoteAsset'] !== 'USD' || typeof row['name'] !== 'string' ||
    row['name'].trim().length === 0 || row['name'].length > 160) return null;
  return freeze({
    instrument: {
      venue: 'coinbase',
      productId: canonical['productId'],
      productType: 'spot',
    },
    symbol: row['symbol'],
    name: row['name'].trim(),
    baseAsset: row['baseAsset'],
    quoteAsset: 'USD',
    coingeckoId: null,
  });
}

function normalizeCatalog(values: readonly unknown[]): readonly AssetRef[] | null {
  const items: AssetRef[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const asset = detachedAsset(value);
    if (asset === null) return null;
    const key = instrumentKey(asset.instrument);
    if (seen.has(key)) return null;
    seen.add(key);
    items.push(asset);
  }
  return Object.freeze(items);
}

function strictIdentity(value: unknown): InstrumentIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['venue', 'productId', 'productType'].includes(key)) ||
    row['venue'] !== 'coinbase' || row['productType'] !== 'spot' ||
    typeof row['productId'] !== 'string' || !PRODUCT.test(row['productId'])) return null;
  return freeze({ venue: 'coinbase', productId: row['productId'], productType: 'spot' });
}

export class DisplayUniverseService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #catalog: CoinbaseCatalogSource;
  readonly #idSource: DisplayUniverseEventIdSource;

  constructor(dependencies: DisplayUniverseServiceDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#catalog = dependencies.catalog;
    this.#idSource = dependencies.idSource;
  }

  async search(
    profileId: string,
    query: string,
    limit = 25,
    signal?: AbortSignal,
  ): Promise<DisplayUniverseResult<CatalogSearchView>> {
    if (!PROFILE_ID.test(profileId)) return failed(['profileId'], 'invalid_profile_id');
    if (typeof query !== 'string' || query.trim().length < 1 || query.trim().length > 64) {
      return failed(['query'], 'invalid_query');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      return failed(['limit'], 'invalid_limit');
    }
    const requestedAtMs = safeNow(this.#clock);
    if (requestedAtMs === null) return failed([], 'clock_unavailable');
    let acquired: Awaited<ReturnType<CoinbaseCatalogSource['search']>>;
    try {
      acquired = await this.#catalog.search(query.trim(), limit, signal);
    } catch {
      return failed([], signal?.aborted ? 'catalog_cancelled' : 'catalog_network');
    }
    if (!acquired.ok) return failed([], catalogIssue(acquired.code));
    if (signal?.aborted) return failed([], 'catalog_cancelled');
    const receivedAtMs = safeNow(this.#clock);
    if (receivedAtMs === null || receivedAtMs < requestedAtMs) {
      return failed([], 'clock_unavailable');
    }
    const items = normalizeCatalog(acquired.assets);
    if (items === null || items.length > limit) return failed([], 'catalog_invalid_response');
    try {
      recordCoinbaseCatalogAssets(items, receivedAtMs, this.#database);
    } catch {
      return failed([], 'storage_rejected');
    }
    return freeze({ ok: true, value: {
      profileId, provider: 'coinbase', query: query.trim(), requestedAtMs, receivedAtMs, items,
    } });
  }

  async view(
    profileId: string,
    catalogOffset = 0,
    catalogLimit = 50,
    signal?: AbortSignal,
  ): Promise<DisplayUniverseResult<DisplayUniverseView>> {
    if (!PROFILE_ID.test(profileId)) return failed(['profileId'], 'invalid_profile_id');
    if (!Number.isSafeInteger(catalogOffset) || catalogOffset < 0 || catalogOffset > 10_000) {
      return failed(['catalogOffset'], 'invalid_offset');
    }
    if (!Number.isSafeInteger(catalogLimit) || catalogLimit < 1 || catalogLimit > 50) {
      return failed(['catalogLimit'], 'invalid_limit');
    }
    const requestedAtMs = safeNow(this.#clock);
    if (requestedAtMs === null) return failed([], 'clock_unavailable');
    let acquired: Awaited<ReturnType<CoinbaseCatalogSource['page']>>;
    try {
      acquired = await this.#catalog.page(catalogOffset, catalogLimit + 1, signal);
    } catch {
      return failed([], signal?.aborted ? 'catalog_cancelled' : 'catalog_network');
    }
    if (!acquired.ok) return failed([], catalogIssue(acquired.code));
    if (signal?.aborted) return failed([], 'catalog_cancelled');
    const receivedAtMs = safeNow(this.#clock);
    if (receivedAtMs === null || receivedAtMs < requestedAtMs) {
      return failed([], 'clock_unavailable');
    }
    const normalized = normalizeCatalog(acquired.assets);
    if (normalized === null || normalized.length > catalogLimit + 1) {
      return failed([], 'catalog_invalid_response');
    }
    const catalog = Object.freeze(normalized.slice(0, catalogLimit));
    let tracked: readonly AssetRef[];
    try {
      recordCoinbaseCatalogAssets(normalized, receivedAtMs, this.#database);
      tracked = listDisplayUniverse(profileId, this.#database);
    } catch {
      return failed([], 'storage_rejected');
    }
    return freeze({ ok: true, value: {
      profileId, provider: 'coinbase', requestedAtMs, receivedAtMs,
      catalogOffset, catalogLimit, catalogHasMore: normalized.length > catalogLimit,
      catalog, tracked, researchUniverseMutated: false,
    } });
  }

  setTracked(
    profileId: string,
    selection: unknown,
  ): DisplayUniverseResult<DisplayUniverseMutationView> {
    if (!PROFILE_ID.test(profileId)) return failed(['profileId'], 'invalid_profile_id');
    if (!Array.isArray(selection) || selection.length > 100) {
      return failed(['selection'], 'invalid_selection');
    }
    const identities: InstrumentIdentity[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < selection.length; index += 1) {
      const identity = strictIdentity(selection[index]);
      if (identity === null) return failed(['selection', String(index)], 'invalid_selection');
      const key = instrumentKey(identity);
      if (seen.has(key)) return failed(['selection', String(index)], 'duplicate_instrument');
      seen.add(key);
      identities.push(identity);
    }
    const recordedAtMs = safeNow(this.#clock);
    if (recordedAtMs === null) return failed([], 'clock_unavailable');
    let eventId: string;
    try {
      eventId = this.#idSource.nextId();
    } catch {
      return failed([], 'id_source_invalid');
    }
    if (!UUID_V4.test(eventId)) return failed([], 'id_source_invalid');
    try {
      const result = replaceDisplayUniverse(
        profileId, identities, recordedAtMs, eventId, this.#database,
      );
      return freeze({ ok: true, value: {
        profileId, recordedAtMs, changed: result.changed,
        selectionHash: result.selectionHash, tracked: result.assets,
        researchUniverseMutated: false,
      } });
    } catch (error) {
      return failed(
        ['selection'],
        error instanceof TypeError && error.message.includes('unknown instrument')
          ? 'unknown_instrument' : 'storage_rejected',
      );
    }
  }
}
