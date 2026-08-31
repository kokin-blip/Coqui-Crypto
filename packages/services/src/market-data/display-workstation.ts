import type { AssetCatalog, AssetRef, InstrumentIdentity } from '@coqui/core';
import {
  deleteExpiredDisplayBars,
  listDisplayBars,
  upsertDisplayBars,
  type Db,
  type DisplayInterval,
  type StoredDisplayBar,
} from '@coqui/storage';

export interface DisplayBarSourceRow {
  readonly productId: string;
  readonly interval: DisplayInterval;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly isComplete: true;
  readonly retrievedAtMs: number;
}

export interface DisplayBarSource {
  fetch(input: {
    readonly instrument: InstrumentIdentity;
    readonly interval: DisplayInterval;
    readonly startTimeMs: number;
    readonly endTimeMs: number;
    readonly nowMs: number;
  }): Promise<{ readonly ok: true; readonly bars: readonly DisplayBarSourceRow[] } |
    { readonly ok: false }>;
}

const INTERVAL_MS: Readonly<Record<DisplayInterval, number>> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000,
  '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000,
};
const RETENTION_MS: Readonly<Record<DisplayInterval, number>> = {
  '1m': 2 * 86_400_000,
  '5m': 14 * 86_400_000,
  '15m': 90 * 86_400_000,
  '1h': 365 * 86_400_000,
  '6h': 3 * 365 * 86_400_000,
  '1d': 5 * 365 * 86_400_000,
};
const CACHE_TTL_MS: Readonly<Record<DisplayInterval, number>> = {
  '1m': 30_000, '5m': 60_000, '15m': 120_000,
  '1h': 5 * 60_000, '6h': 15 * 60_000, '1d': 60 * 60_000,
};
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;

export type DisplayDataResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly { readonly path: readonly string[]; readonly code: string }[] };

function failure(path: readonly string[], code: string): DisplayDataResult<never> {
  return { ok: false, issues: [{ path, code }] };
}

export class CoinbaseDisplayDataService {
  readonly #profileId: string;
  readonly #database: Db;
  readonly #catalog: AssetCatalog;
  readonly #source: DisplayBarSource;
  readonly #nowMs: () => number;

  constructor(input: {
    readonly profileId: string;
    readonly database: Db;
    readonly catalog: AssetCatalog;
    readonly source: DisplayBarSource;
    readonly nowMs: () => number;
  }) {
    this.#profileId = input.profileId;
    this.#database = input.database;
    this.#catalog = input.catalog;
    this.#source = input.source;
    this.#nowMs = input.nowMs;
  }

  async products(query: string, limit: number): Promise<DisplayDataResult<{
    readonly products: readonly AssetRef[]; readonly asOfMs: number;
  }>> {
    if (query.length > 80 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      return failure(['products'], 'invalid_query');
    }
    const nowMs = this.#nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return failure([], 'clock_unavailable');
    const products = query.trim().length === 0
      ? await this.#catalog.page(0, limit)
      : await this.#catalog.search(query, limit);
    return { ok: true, value: { products, asOfMs: nowMs } };
  }

  async bars(input: {
    readonly productId: string;
    readonly interval: DisplayInterval;
    readonly startTimeMs: number;
    readonly endTimeMs: number;
  }): Promise<DisplayDataResult<{
    readonly bars: readonly StoredDisplayBar[]; readonly asOfMs: number;
  }>> {
    const nowMs = this.#nowMs();
    if (!PRODUCT.test(input.productId)) return failure(['productId'], 'invalid_product');
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return failure([], 'clock_unavailable');
    if (!Number.isSafeInteger(input.startTimeMs) || input.startTimeMs < 0 ||
      !Number.isSafeInteger(input.endTimeMs) || input.endTimeMs <= input.startTimeMs ||
      input.endTimeMs > nowMs + INTERVAL_MS[input.interval]) {
      return failure(['range'], 'invalid_range');
    }
    const floor = nowMs - RETENTION_MS[input.interval];
    const startTimeMs = Math.max(input.startTimeMs, floor);
    if (input.endTimeMs <= startTimeMs) return failure(['range'], 'outside_retention');
    deleteExpiredDisplayBars(this.#profileId, nowMs, this.#database);
    let cached = listDisplayBars({ ...input, profileId: this.#profileId, startTimeMs }, this.#database);
    if (cached.length === 0 || cached.some((bar) => bar.expiresAtMs < nowMs)) {
      const pageMs = INTERVAL_MS[input.interval] * 300;
      const fetched: DisplayBarSourceRow[] = [];
      for (let cursor = startTimeMs; cursor < input.endTimeMs; cursor += pageMs) {
        const endTimeMs = Math.min(input.endTimeMs, cursor + pageMs);
        const result = await this.#source.fetch({
          instrument: { venue: 'coinbase', productId: input.productId, productType: 'spot' },
          interval: input.interval,
          startTimeMs: cursor,
          endTimeMs,
          nowMs,
        });
        if (!result.ok) return failure(['bars'], 'source_unavailable');
        fetched.push(...result.bars);
      }
      const expiresAtMs = nowMs + CACHE_TTL_MS[input.interval];
      upsertDisplayBars(fetched.map((bar) => ({
        ...bar, profileId: this.#profileId, expiresAtMs,
      })), this.#database);
      cached = listDisplayBars({ ...input, profileId: this.#profileId, startTimeMs }, this.#database);
    }
    return { ok: true, value: { bars: cached, asOfMs: nowMs } };
  }
}
