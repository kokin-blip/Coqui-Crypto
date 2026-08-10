import type { InstrumentIdentity } from './instrument.js';
import type { AssetQuantity, UsdAmount } from './money.js';

/** Display metadata attached to one canonically identified venue product. */
export interface AssetRef {
  readonly instrument: InstrumentIdentity;
  readonly symbol: string;
  readonly name: string;
  readonly baseAsset: string;
  readonly quoteAsset: 'USD';
  readonly coingeckoId: string | null;
}

export type CostBasisMethod = 'fifo' | 'lifo' | 'hifo' | 'average';
export type AcquisitionSource = 'coinbase' | 'manual' | 'onchain';

/** One immutable acquisition; disposals reduce only its remaining quantity. */
export interface TaxLot {
  readonly id: string;
  readonly asset: AssetRef;
  readonly quantity: AssetQuantity;
  readonly remaining: AssetQuantity;
  readonly costUsd: UsdAmount;
  readonly acquiredAt: number;
  readonly source: AcquisitionSource;
  readonly externalId: string | null;
}

/** A realized disposal matched against explicit source lots. */
export interface Disposal {
  readonly id: string;
  readonly asset: AssetRef;
  readonly quantity: AssetQuantity;
  readonly proceedsUsd: UsdAmount;
  readonly costBasisUsd: UsdAmount;
  readonly realizedPnlUsd: UsdAmount;
  readonly longTerm: boolean;
  readonly disposedAt: number;
  readonly method: CostBasisMethod;
  readonly source: AcquisitionSource;
}

/** Per-asset view derived from open lots and a current reference price. */
export interface Holding {
  readonly asset: AssetRef;
  readonly quantity: AssetQuantity;
  readonly avgCostUsd: UsdAmount;
  readonly priceUsd: UsdAmount | null;
  readonly valueUsd: UsdAmount | null;
  readonly unrealizedPnlUsd: UsdAmount | null;
  readonly unrealizedPnlPct: number | null;
}

export interface AllocationSlice {
  readonly asset: AssetRef;
  readonly valueUsd: UsdAmount;
  readonly actualWeight: number;
  readonly targetWeight: number | null;
  readonly driftPct: number | null;
}

export interface Allocation {
  readonly slices: readonly AllocationSlice[];
  readonly totalValueUsd: UsdAmount;
  readonly asOf: number;
}

export interface AllocationTarget {
  readonly instrument: InstrumentIdentity;
  readonly weight: number;
}

export interface AllocationPolicy {
  readonly targets: readonly AllocationTarget[];
  readonly rebalanceBandPct: number;
}

export interface RebalanceTrade {
  readonly asset: AssetRef;
  readonly side: 'buy' | 'sell';
  readonly amountUsd: UsdAmount;
  readonly estimatedQty: AssetQuantity;
  readonly reason: string;
}

/** An estimate that cannot be passed directly to an executor. */
export interface RebalancePlan {
  readonly trades: readonly RebalanceTrade[];
  readonly turnoverUsd: UsdAmount;
  readonly maxDriftPct: number;
  readonly asOf: number;
  readonly estimateOnly: true;
}

/** Research-market candle; ledger amounts remain decimal strings. */
export interface Candle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface PriceSource {
  readonly name: string;
  spot(instruments: readonly InstrumentIdentity[]): Promise<ReadonlyMap<string, UsdAmount>>;
  candles?(instrument: InstrumentIdentity, timeframe: string): Promise<readonly Candle[]>;
}

export interface AccountSource {
  readonly name: string;
  readonly kind: AcquisitionSource;
  syncLots(): Promise<readonly TaxLot[]>;
}

export interface AssetCatalog {
  readonly name: string;
  search(query: string, limit?: number): Promise<readonly AssetRef[]>;
  page(offset: number, limit: number): Promise<readonly AssetRef[]>;
}

export interface ExecutionIntent {
  readonly asset: AssetRef;
  readonly side: 'buy' | 'sell';
  readonly amountUsd: UsdAmount;
  readonly origin: 'manual' | 'rule' | 'rebalance';
  readonly referencePriceUsd?: UsdAmount;
  readonly reason?: string;
  readonly urgency: 'passive' | 'standard' | 'fast';
}

export interface Executor {
  readonly mode: 'paper' | 'live';
  execute(intent: ExecutionIntent): Promise<Disposal | TaxLot>;
}

