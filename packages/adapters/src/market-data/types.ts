import type {
  InstrumentIdentity,
  InstrumentKey,
  UsdAmount,
} from '@coqui/core';

export type MarketProviderName =
  | 'coingecko'
  | 'coinmarketcap'
  | 'coinpaprika';

/** Explicit provider IDs attached to one canonical Coinbase product. */
export interface ProviderAssetMapping {
  readonly instrument: InstrumentIdentity;
  readonly coingeckoId: string | null;
  readonly coinMarketCapId: number | null;
  readonly coinPaprikaId: string | null;
}

/** Common comparison shape; it is reference data, never execution truth. */
export interface ProviderMarketSnapshot {
  readonly provider: MarketProviderName;
  readonly providerId: string;
  readonly instrument: InstrumentIdentity;
  readonly priceUsd: UsdAmount;
  readonly marketCapUsd: UsdAmount | null;
  readonly volume24hUsd: UsdAmount | null;
  readonly marketCapRank: number | null;
  readonly change24hPct: number | null;
  readonly providerUpdatedAtMs: number | null;
}

export type ProviderBatchFailureCode = 'request_failed' | 'invalid_payload';

export type ProviderBatchResult =
  | {
      readonly ok: true;
      readonly snapshots: ReadonlyMap<InstrumentKey, ProviderMarketSnapshot>;
    }
  | {
      readonly ok: false;
      readonly code: ProviderBatchFailureCode;
      readonly status: number;
    };

export interface ProviderMarketSource {
  readonly name: MarketProviderName;
  fetch(
    mappings: readonly ProviderAssetMapping[],
  ): Promise<ProviderBatchResult>;
}
