import {
  holdingsFromLots,
  instrumentKey,
  nonNegativeDecimal,
  type AssetRef,
  type Clock,
  type Holding,
  type InstrumentIdentity,
  type TaxLot,
} from '@coqui/core';
import {
  deleteUnconsumedManualTaxLot,
  getTaxLot,
  insertTaxLots,
  listTaxLots,
  type Db,
} from '@coqui/storage';

const ZERO_DECIMAL = /^0(?:\.0+)?$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface TaxLotIdSource {
  nextId(): string;
}

export interface PortfolioLedgerDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly idSource: TaxLotIdSource;
}

export interface AddManualTaxLotInput {
  readonly asset: AssetRef;
  readonly quantity: string;
  readonly costUsd: string;
  readonly acquiredAt: number;
}

export type AddManualTaxLotFailureCode =
  | 'invalid_asset'
  | 'invalid_quantity'
  | 'invalid_cost'
  | 'invalid_acquired_at'
  | 'lot_id_conflict';

export type AddManualTaxLotResult =
  | { readonly ok: true; readonly lot: TaxLot }
  | { readonly ok: false; readonly reasonCode: AddManualTaxLotFailureCode };

export type RemoveManualTaxLotFailureCode =
  | 'lot_not_found'
  | 'lot_not_manual'
  | 'lot_has_disposals';

export type RemoveManualTaxLotResult =
  | { readonly ok: true; readonly removedLot: TaxLot }
  | { readonly ok: false; readonly reasonCode: RemoveManualTaxLotFailureCode };

export interface PortfolioLedgerView {
  readonly asOfMs: number;
  readonly pricingStatus: 'unpriced';
  readonly lots: readonly TaxLot[];
  readonly holdings: readonly Holding[];
}

function frozenAsset(asset: AssetRef): AssetRef {
  return Object.freeze({
    instrument: Object.freeze({ ...asset.instrument }),
    symbol: asset.symbol,
    name: asset.name,
    baseAsset: asset.baseAsset,
    quoteAsset: asset.quoteAsset,
    coingeckoId: asset.coingeckoId,
  });
}

function frozenLot(lot: TaxLot): TaxLot {
  return Object.freeze({ ...lot, asset: frozenAsset(lot.asset) });
}

function frozenHolding(holding: Holding): Holding {
  return Object.freeze({ ...holding, asset: frozenAsset(holding.asset) });
}

function validOperationalAsset(asset: AssetRef): boolean {
  try {
    instrumentKey(asset.instrument);
  } catch {
    return false;
  }
  return asset.instrument.venue === 'coinbase' &&
    asset.instrument.productType === 'spot' &&
    asset.quoteAsset === 'USD' &&
    asset.symbol.trim().length > 0 &&
    asset.name.trim().length > 0 &&
    asset.baseAsset.trim().length > 0;
}

function validatedQuantity(value: string): TaxLot['quantity'] | null {
  try {
    const quantity = nonNegativeDecimal(value);
    return ZERO_DECIMAL.test(quantity) ? null : quantity;
  } catch {
    return null;
  }
}

function validatedCost(value: string): TaxLot['costUsd'] | null {
  try {
    return nonNegativeDecimal(value);
  } catch {
    return null;
  }
}

/** Exact-decimal manual lot orchestration with no pricing, import, or IPC concerns. */
export class PortfolioLedgerService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #idSource: TaxLotIdSource;

  constructor(dependencies: PortfolioLedgerDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#idSource = dependencies.idSource;
  }

  addManualTaxLot(input: AddManualTaxLotInput): AddManualTaxLotResult {
    if (!validOperationalAsset(input.asset)) return { ok: false, reasonCode: 'invalid_asset' };
    const quantity = validatedQuantity(input.quantity);
    if (quantity === null) return { ok: false, reasonCode: 'invalid_quantity' };
    const costUsd = validatedCost(input.costUsd);
    if (costUsd === null) return { ok: false, reasonCode: 'invalid_cost' };
    const now = this.#clock.nowMs();
    if (
      !Number.isSafeInteger(input.acquiredAt) ||
      input.acquiredAt < 0 ||
      input.acquiredAt > now
    ) return { ok: false, reasonCode: 'invalid_acquired_at' };

    const id = this.#idSource.nextId();
    if (!UUID_V4.test(id)) throw new TypeError('Tax-lot ID source must return a UUIDv4.');
    if (getTaxLot(id, this.#database)) return { ok: false, reasonCode: 'lot_id_conflict' };

    const lot: TaxLot = {
      id,
      asset: frozenAsset(input.asset),
      quantity,
      remaining: quantity,
      costUsd,
      acquiredAt: input.acquiredAt,
      source: 'manual',
      externalId: null,
    };
    insertTaxLots([lot], this.#database);
    return { ok: true, lot: frozenLot(lot) };
  }

  listAssetLots(instrument: InstrumentIdentity): readonly TaxLot[] {
    const target = instrumentKey(instrument);
    return Object.freeze(
      listTaxLots(this.#database)
        .filter((lot) => instrumentKey(lot.asset.instrument) === target)
        .map(frozenLot),
    );
  }

  view(): PortfolioLedgerView {
    const lots = Object.freeze(listTaxLots(this.#database).map(frozenLot));
    const holdings = Object.freeze(
      holdingsFromLots(lots, {}).map(frozenHolding),
    );
    return Object.freeze({
      asOfMs: this.#clock.nowMs(),
      pricingStatus: 'unpriced' as const,
      lots,
      holdings,
    });
  }

  removeManualTaxLot(id: string): RemoveManualTaxLotResult {
    const result = deleteUnconsumedManualTaxLot(id, this.#database);
    switch (result.status) {
      case 'deleted':
        return { ok: true, removedLot: frozenLot(result.lot) };
      case 'not_found':
        return { ok: false, reasonCode: 'lot_not_found' };
      case 'not_manual':
        return { ok: false, reasonCode: 'lot_not_manual' };
      case 'has_disposals':
        return { ok: false, reasonCode: 'lot_has_disposals' };
    }
  }
}
