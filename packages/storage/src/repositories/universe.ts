import {
  createPointInTimeUniverseSnapshot,
  type PointInTimeUniverseSnapshot,
  type UniverseProductObservation,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

interface SnapshotRow {
  id: string;
  source: 'coinbase-products';
  observed_at_ms: number;
  effective_from_day_key: string;
  snapshot_hash: string;
  product_count: number;
  products_json: string;
}

interface ProductRow {
  venue: string;
  product_id: string;
  product_type: string;
  base_asset: string;
  quote_asset: string;
  status: string;
  trading_disabled: number | null;
  cancel_only: number | null;
  limit_only: number | null;
  post_only: number | null;
  base_increment_text: string | null;
  quote_increment_text: string | null;
  min_market_funds_text: string | null;
}

function productsJson(products: readonly UniverseProductObservation[]): string {
  return JSON.stringify(products.map((product) => ({
    instrument: {
      venue: product.instrument.venue,
      productId: product.instrument.productId,
      productType: product.instrument.productType,
    },
    baseAsset: product.baseAsset,
    quoteAsset: product.quoteAsset,
    status: product.status,
    tradingDisabled: product.tradingDisabled,
    cancelOnly: product.cancelOnly,
    limitOnly: product.limitOnly,
    postOnly: product.postOnly,
    baseIncrement: product.baseIncrement,
    quoteIncrement: product.quoteIncrement,
    minMarketFunds: product.minMarketFunds,
  })));
}

function nullableBoolean(value: number | null): boolean | null {
  if (value === null) return null;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error('Stored universe flag is invalid.');
}

function productFromRow(row: ProductRow): UniverseProductObservation {
  if (row.venue !== 'coinbase' || row.product_type !== 'spot' || row.quote_asset !== 'USD') {
    throw new Error('Stored universe product identity is invalid.');
  }
  return {
    instrument: { venue: row.venue, productId: row.product_id, productType: row.product_type },
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    status: row.status,
    tradingDisabled: nullableBoolean(row.trading_disabled),
    cancelOnly: nullableBoolean(row.cancel_only),
    limitOnly: nullableBoolean(row.limit_only),
    postOnly: nullableBoolean(row.post_only),
    baseIncrement: row.base_increment_text,
    quoteIncrement: row.quote_increment_text,
    minMarketFunds: row.min_market_funds_text,
  };
}

function snapshotFromRow(row: SnapshotRow, database: Db): PointInTimeUniverseSnapshot {
  const products = database.prepare(
    `SELECT * FROM universe_product_observations WHERE snapshot_id = ?
     ORDER BY venue, product_type, product_id`,
  ).all(row.id) as unknown as ProductRow[];
  if (products.length !== row.product_count) {
    throw new Error('Stored universe snapshot product count does not match its rows.');
  }
  const rebuilt = createPointInTimeUniverseSnapshot(
    row.observed_at_ms, products.map(productFromRow),
  );
  if (
    rebuilt.id !== row.id || rebuilt.snapshotHash !== row.snapshot_hash ||
    rebuilt.effectiveFromDayKey !== row.effective_from_day_key ||
    productsJson(rebuilt.products) !== row.products_json
  ) throw new Error('Stored universe snapshot integrity validation failed.');
  return rebuilt;
}

/** Append one immutable full-product snapshot; exact retries are idempotent. */
export function saveUniverseSnapshot(
  snapshot: PointInTimeUniverseSnapshot,
  database: Db,
): boolean {
  const rebuilt = createPointInTimeUniverseSnapshot(snapshot.observedAtMs, snapshot.products);
  if (rebuilt.id !== snapshot.id || rebuilt.snapshotHash !== snapshot.snapshotHash) {
    throw new Error('Universe snapshot integrity validation failed before persistence.');
  }
  const prior = database.prepare('SELECT * FROM universe_snapshots WHERE id = ?')
    .get(snapshot.id) as unknown as SnapshotRow | undefined;
  if (prior) {
    snapshotFromRow(prior, database);
    return false;
  }
  const sameTime = database.prepare(
    'SELECT id FROM universe_snapshots WHERE observed_at_ms = ?',
  ).get(snapshot.observedAtMs) as unknown as { id: string } | undefined;
  if (sameTime) throw new Error('A different universe snapshot already exists at this observation time.');
  return inTransaction(database, () => {
    const serializedProducts = productsJson(rebuilt.products);
    database.prepare(
      `INSERT INTO universe_snapshots
       (id, source, observed_at_ms, effective_from_day_key, snapshot_hash,
        product_count, products_json, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(rebuilt.id, rebuilt.source, rebuilt.observedAtMs, rebuilt.effectiveFromDayKey,
      rebuilt.snapshotHash, rebuilt.products.length, serializedProducts, rebuilt.observedAtMs);
    const insert = database.prepare(
      `INSERT INTO universe_product_observations
       (snapshot_id, venue, product_id, product_type, base_asset, quote_asset, status,
        trading_disabled, cancel_only, limit_only, post_only, base_increment_text,
        quote_increment_text, min_market_funds_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const product of rebuilt.products) insert.run(
      rebuilt.id, product.instrument.venue, product.instrument.productId,
      product.instrument.productType, product.baseAsset, product.quoteAsset, product.status,
      product.tradingDisabled === null ? null : Number(product.tradingDisabled),
      product.cancelOnly === null ? null : Number(product.cancelOnly),
      product.limitOnly === null ? null : Number(product.limitOnly),
      product.postOnly === null ? null : Number(product.postOnly),
      product.baseIncrement, product.quoteIncrement, product.minMarketFunds,
    );
    return true;
  });
}

export function getUniverseSnapshot(
  id: string,
  database: Db,
): PointInTimeUniverseSnapshot | null {
  const row = database.prepare('SELECT * FROM universe_snapshots WHERE id = ?')
    .get(id) as unknown as SnapshotRow | undefined;
  return row ? snapshotFromRow(row, database) : null;
}

export function listUniverseSnapshots(database: Db): PointInTimeUniverseSnapshot[] {
  const rows = database.prepare(
    'SELECT * FROM universe_snapshots ORDER BY observed_at_ms, id',
  ).all() as unknown as SnapshotRow[];
  return rows.map((row) => snapshotFromRow(row, database));
}
