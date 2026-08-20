import {
  dayKey,
  decimal,
  instrumentKey,
  nonNegativeDecimal,
  validateAllocationPolicy,
  type AcquisitionSource,
  type AllocationPolicy,
  type AssetRef,
  type Disposal,
  type InstrumentIdentity,
  type PortfolioSnapshot,
  type TaxLot,
} from '@coqui/core';
import { Decimal } from 'decimal.js';

import { inTransaction, type Db } from '../sqlite/index.js';
import { getSetting, setSetting } from './settings.js';

interface StoredAssetRow {
  venue: 'coinbase';
  product_id: string;
  product_type: 'spot';
  symbol: string;
  asset_name: string;
  base_asset: string;
  quote_asset: 'USD';
  coingecko_id: string | null;
}

interface TaxLotRow extends StoredAssetRow {
  id: string;
  quantity_text: string;
  remaining_text: string;
  cost_usd_text: string;
  acquired_at: number;
  source: AcquisitionSource;
  external_id: string | null;
}

interface DisposalRow extends StoredAssetRow {
  id: string;
  quantity_text: string;
  proceeds_usd_text: string;
  cost_basis_usd_text: string;
  realized_pnl_usd_text: string;
  long_term: number;
  disposed_at: number;
  method: Disposal['method'];
  source: AcquisitionSource;
}

export interface PortfolioMigrationException {
  readonly id: string;
  readonly legacyTable: string;
  readonly legacyId: string;
  readonly reason: string;
  readonly resolvedAt: number | null;
  readonly resolution: string | null;
}

function assetFromRow(row: StoredAssetRow): AssetRef {
  return {
    instrument: {
      venue: row.venue,
      productId: row.product_id,
      productType: row.product_type,
    },
    symbol: row.symbol,
    name: row.asset_name,
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    coingeckoId: row.coingecko_id,
  };
}

function validateAsset(asset: AssetRef): void {
  instrumentKey(asset.instrument);
  if (
    !asset.symbol.trim() ||
    !asset.name.trim() ||
    !asset.baseAsset.trim() ||
    asset.quoteAsset !== 'USD'
  ) throw new TypeError('Asset metadata is incomplete.');
}

function taxLotValues(lot: TaxLot): Array<string | number | null> {
  validateAsset(lot.asset);
  nonNegativeDecimal(lot.quantity);
  nonNegativeDecimal(lot.remaining);
  nonNegativeDecimal(lot.costUsd);
  return [
    lot.id,
    lot.asset.instrument.venue,
    lot.asset.instrument.productId,
    lot.asset.instrument.productType,
    lot.asset.symbol,
    lot.asset.name,
    lot.asset.baseAsset,
    lot.asset.quoteAsset,
    lot.asset.coingeckoId,
    lot.quantity,
    lot.remaining,
    lot.costUsd,
    lot.acquiredAt,
    lot.source,
    lot.externalId,
  ];
}

const INSERT_TAX_LOT = `
  INSERT INTO tax_lots_v2 (
    id, venue, product_id, product_type, symbol, asset_name, base_asset,
    quote_asset, coingecko_id, quantity_text, remaining_text, cost_usd_text,
    acquired_at, source, external_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Insert immutable acquisitions atomically; duplicate IDs fail closed. */
export function insertTaxLots(lots: readonly TaxLot[], database: Db): void {
  inTransaction(database, () => {
    const statement = database.prepare(INSERT_TAX_LOT);
    for (const lot of lots) statement.run(...taxLotValues(lot));
  });
}

/** Replace one import source atomically without touching lots from other sources. */
export function replaceTaxLotsBySource(
  source: AcquisitionSource,
  lots: readonly TaxLot[],
  database: Db,
): void {
  if (lots.some((lot) => lot.source !== source)) {
    throw new TypeError('Every replacement lot must match the requested source.');
  }
  inTransaction(database, () => {
    database.prepare('DELETE FROM tax_lots_v2 WHERE source = ?').run(source);
    const statement = database.prepare(INSERT_TAX_LOT);
    for (const lot of lots) statement.run(...taxLotValues(lot));
  });
}

export function listTaxLots(database: Db, openOnly = false): TaxLot[] {
  const rows = database.prepare('SELECT * FROM tax_lots_v2 ORDER BY acquired_at, id')
    .all() as unknown as TaxLotRow[];
  return rows
    .filter((row) => !openOnly || !/^0(?:\.0+)?$/.test(row.remaining_text))
    .map((row) => ({
      id: row.id,
      asset: assetFromRow(row),
      quantity: nonNegativeDecimal(row.quantity_text),
      remaining: nonNegativeDecimal(row.remaining_text),
      costUsd: nonNegativeDecimal(row.cost_usd_text),
      acquiredAt: row.acquired_at,
      source: row.source,
      externalId: row.external_id,
    }));
}

export function getTaxLot(id: string, database: Db): TaxLot | null {
  const row = database.prepare('SELECT * FROM tax_lots_v2 WHERE id = ?').get(id) as
    | TaxLotRow
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    asset: assetFromRow(row),
    quantity: nonNegativeDecimal(row.quantity_text),
    remaining: nonNegativeDecimal(row.remaining_text),
    costUsd: nonNegativeDecimal(row.cost_usd_text),
    acquiredAt: row.acquired_at,
    source: row.source,
    externalId: row.external_id,
  };
}

export type DeleteManualTaxLotResult =
  | { readonly status: 'deleted'; readonly lot: TaxLot }
  | { readonly status: 'not_found' }
  | { readonly status: 'not_manual' }
  | { readonly status: 'has_disposals' };

/** Delete only a wholly unconsumed manual acquisition; imported or consumed lots fail closed. */
export function deleteUnconsumedManualTaxLot(
  id: string,
  database: Db,
): DeleteManualTaxLotResult {
  return inTransaction(database, () => {
    const lot = getTaxLot(id, database);
    if (!lot) return { status: 'not_found' };
    if (lot.source !== 'manual') return { status: 'not_manual' };
    if (!new Decimal(lot.remaining).eq(lot.quantity)) return { status: 'has_disposals' };
    const result = database.prepare('DELETE FROM tax_lots_v2 WHERE id = ?').run(id);
    if (Number(result.changes) !== 1) return { status: 'not_found' };
    return { status: 'deleted', lot };
  });
}

/** Reduce a lot only to an explicit exact remaining quantity. */
export function updateTaxLotRemaining(id: string, remaining: string, database: Db): boolean {
  const exact = nonNegativeDecimal(remaining);
  const result = database.prepare(
    'UPDATE tax_lots_v2 SET remaining_text = ? WHERE id = ?',
  ).run(exact, id);
  return Number(result.changes) === 1;
}

function disposalValues(disposal: Disposal): Array<string | number | null> {
  validateAsset(disposal.asset);
  nonNegativeDecimal(disposal.quantity);
  nonNegativeDecimal(disposal.proceedsUsd);
  nonNegativeDecimal(disposal.costBasisUsd);
  decimal(disposal.realizedPnlUsd);
  return [
    disposal.id,
    disposal.asset.instrument.venue,
    disposal.asset.instrument.productId,
    disposal.asset.instrument.productType,
    disposal.asset.symbol,
    disposal.asset.name,
    disposal.asset.baseAsset,
    disposal.asset.quoteAsset,
    disposal.asset.coingeckoId,
    disposal.quantity,
    disposal.proceedsUsd,
    disposal.costBasisUsd,
    disposal.realizedPnlUsd,
    disposal.longTerm ? 1 : 0,
    disposal.disposedAt,
    disposal.method,
    disposal.source,
  ];
}

const INSERT_DISPOSAL = `
  INSERT INTO disposals_v2 (
    id, venue, product_id, product_type, symbol, asset_name, base_asset,
    quote_asset, coingecko_id, quantity_text, proceeds_usd_text,
    cost_basis_usd_text, realized_pnl_usd_text, long_term, disposed_at,
    method, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function insertDisposals(disposals: readonly Disposal[], database: Db): void {
  inTransaction(database, () => {
    const statement = database.prepare(INSERT_DISPOSAL);
    for (const disposal of disposals) statement.run(...disposalValues(disposal));
  });
}

export function replaceDisposalsBySource(
  source: AcquisitionSource,
  disposals: readonly Disposal[],
  database: Db,
): void {
  if (disposals.some((disposal) => disposal.source !== source)) {
    throw new TypeError('Every replacement disposal must match the requested source.');
  }
  inTransaction(database, () => {
    database.prepare('DELETE FROM disposals_v2 WHERE source = ?').run(source);
    const statement = database.prepare(INSERT_DISPOSAL);
    for (const disposal of disposals) statement.run(...disposalValues(disposal));
  });
}

export function listDisposals(database: Db, instrument?: InstrumentIdentity): Disposal[] {
  const rows = (instrument
    ? database.prepare(`
        SELECT * FROM disposals_v2
        WHERE venue = ? AND product_id = ? AND product_type = ?
        ORDER BY disposed_at, id
      `).all(instrument.venue, instrument.productId, instrument.productType)
    : database.prepare('SELECT * FROM disposals_v2 ORDER BY disposed_at, id').all()) as
      unknown as DisposalRow[];
  return rows.map((row) => ({
    id: row.id,
    asset: assetFromRow(row),
    quantity: nonNegativeDecimal(row.quantity_text),
    proceedsUsd: nonNegativeDecimal(row.proceeds_usd_text),
    costBasisUsd: nonNegativeDecimal(row.cost_basis_usd_text),
    realizedPnlUsd: decimal(row.realized_pnl_usd_text),
    longTerm: row.long_term === 1,
    disposedAt: row.disposed_at,
    method: row.method,
    source: row.source,
  }));
}

export interface TaxLotRemainingUpdate {
  readonly id: string;
  readonly remaining: string;
}

export type CommitPortfolioSaleResult =
  | { readonly status: 'committed' }
  | { readonly status: 'disposal_id_conflict' };

/** Atomically reduce explicit lots and append disposal evidence without deleting acquisitions. */
export function commitPortfolioSale(
  updates: readonly TaxLotRemainingUpdate[],
  disposals: readonly Disposal[],
  database: Db,
): CommitPortfolioSaleResult {
  return inTransaction(database, () => {
    const conflict = database.prepare('SELECT 1 FROM disposals_v2 WHERE id = ?');
    if (disposals.some((disposal) => conflict.get(disposal.id) !== undefined)) {
      return { status: 'disposal_id_conflict' };
    }

    const update = database.prepare('UPDATE tax_lots_v2 SET remaining_text = ? WHERE id = ?');
    for (const item of updates) {
      const remaining = nonNegativeDecimal(item.remaining);
      const current = getTaxLot(item.id, database);
      if (!current) throw new Error('A sale referenced a missing tax lot.');
      if (
        new Decimal(remaining).gt(current.remaining) ||
        new Decimal(remaining).gt(current.quantity)
      ) throw new Error('A sale cannot increase a tax-lot balance.');
      const result = update.run(remaining, item.id);
      if (Number(result.changes) !== 1) throw new Error('A sale tax-lot update was not applied.');
    }
    insertDisposals(disposals, database);
    return { status: 'committed' };
  });
}

export function savePortfolioSnapshot(snapshot: PortfolioSnapshot, database: Db): void {
  nonNegativeDecimal(snapshot.valueUsd);
  nonNegativeDecimal(snapshot.costUsd);
  decimal(snapshot.realizedPnlUsd);
  database.prepare(`
    INSERT INTO portfolio_snapshots_v2
      (at, value_usd_text, cost_usd_text, realized_pnl_usd_text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(at) DO UPDATE SET
      value_usd_text = excluded.value_usd_text,
      cost_usd_text = excluded.cost_usd_text,
      realized_pnl_usd_text = excluded.realized_pnl_usd_text
  `).run(dayKey(snapshot.at), snapshot.valueUsd, snapshot.costUsd, snapshot.realizedPnlUsd);
}

export function listPortfolioSnapshots(database: Db, sinceMs?: number): PortfolioSnapshot[] {
  const rows = (sinceMs === undefined
    ? database.prepare('SELECT * FROM portfolio_snapshots_v2 ORDER BY at').all()
    : database.prepare('SELECT * FROM portfolio_snapshots_v2 WHERE at >= ? ORDER BY at')
      .all(sinceMs)) as unknown as Array<{
        at: number;
        value_usd_text: string;
        cost_usd_text: string;
        realized_pnl_usd_text: string;
      }>;
  return rows.map((row) => ({
    at: row.at,
    valueUsd: nonNegativeDecimal(row.value_usd_text),
    costUsd: nonNegativeDecimal(row.cost_usd_text),
    realizedPnlUsd: decimal(row.realized_pnl_usd_text),
  }));
}

const REBALANCE_BAND_KEY = 'allocation.rebalance_band_pct';
export const DEFAULT_REBALANCE_BAND_PCT = 5;

export function saveAllocationPolicy(policy: AllocationPolicy, database: Db): void {
  const validated = validateAllocationPolicy(policy);
  if (!validated.ok) throw new TypeError('Allocation policy is invalid.');
  inTransaction(database, () => {
    database.exec('DELETE FROM allocation_targets_v2');
    const statement = database.prepare(`
      INSERT INTO allocation_targets_v2 (venue, product_id, product_type, weight)
      VALUES (?, ?, ?, ?)
    `);
    for (const target of validated.policy.targets) {
      statement.run(
        target.instrument.venue,
        target.instrument.productId,
        target.instrument.productType,
        target.weight,
      );
    }
    setSetting(
      REBALANCE_BAND_KEY,
      String(validated.policy.rebalanceBandPct),
      database,
    );
  });
}

/** Explicitly remove user targets and restore the documented default band atomically. */
export function clearAllocationPolicy(database: Db): void {
  inTransaction(database, () => {
    database.exec('DELETE FROM allocation_targets_v2');
    setSetting(REBALANCE_BAND_KEY, String(DEFAULT_REBALANCE_BAND_PCT), database);
  });
}

export function getAllocationPolicy(database: Db): AllocationPolicy {
  const rows = database.prepare(`
    SELECT venue, product_id, product_type, weight
    FROM allocation_targets_v2 ORDER BY product_id
  `).all() as unknown as Array<{
    venue: 'coinbase';
    product_id: string;
    product_type: 'spot';
    weight: number;
  }>;
  const storedBand = getSetting(REBALANCE_BAND_KEY, database);
  return {
    targets: rows.map((row) => ({
      instrument: {
        venue: row.venue,
        productId: row.product_id,
        productType: row.product_type,
      },
      weight: row.weight,
    })),
    rebalanceBandPct: storedBand === null
      ? DEFAULT_REBALANCE_BAND_PCT
      : Number(storedBand),
  };
}

export function listPortfolioMigrationExceptions(database: Db): PortfolioMigrationException[] {
  const rows = database.prepare(`
    SELECT id, legacy_table, legacy_id, reason, resolved_at, resolution
    FROM portfolio_migration_exceptions
    WHERE resolved_at IS NULL ORDER BY legacy_table, legacy_id
  `).all() as unknown as Array<{
    id: string;
    legacy_table: string;
    legacy_id: string;
    reason: string;
    resolved_at: number | null;
    resolution: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    legacyTable: row.legacy_table,
    legacyId: row.legacy_id,
    reason: row.reason,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  }));
}
