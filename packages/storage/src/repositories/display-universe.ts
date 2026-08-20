import {
  instrumentKey,
  sha256Hex,
  type AssetRef,
  type InstrumentIdentity,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';
import { upsertInstrumentProviderMapping } from './canonical-assets.js';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_SELECTION = 100;

interface DisplayUniverseRow {
  venue: 'coinbase';
  product_id: string;
  product_type: 'spot';
  symbol: string;
  name: string;
  base_asset: string;
  quote_asset: 'USD';
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assetFromRow(row: DisplayUniverseRow): AssetRef {
  return {
    instrument: {
      venue: row.venue,
      productId: row.product_id,
      productType: row.product_type,
    },
    symbol: row.symbol,
    name: row.name,
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    coingeckoId: null,
  };
}

/** Retain Coinbase catalog identities and their explicit provider mapping. */
export function recordCoinbaseCatalogAssets(
  assets: readonly AssetRef[],
  observedAtMs: number,
  database: Db,
): void {
  if (!validTime(observedAtMs)) throw new TypeError('Invalid catalog observation time.');
  if (assets.length > 100) throw new RangeError('Catalog result exceeds its persistence bound.');
  const seen = new Set<string>();
  inTransaction(database, () => {
    for (const asset of assets) {
      const key = instrumentKey(asset.instrument);
      if (asset.instrument.venue !== 'coinbase' || asset.instrument.productType !== 'spot' ||
        asset.quoteAsset !== 'USD' || !asset.symbol.trim() || !asset.name.trim() ||
        !asset.baseAsset.trim() || seen.has(key)) {
        throw new TypeError('Invalid or duplicate catalog asset.');
      }
      seen.add(key);
      upsertInstrumentProviderMapping({
        instrument: asset.instrument,
        symbol: asset.symbol,
        name: asset.name,
        baseAsset: asset.baseAsset,
        quoteAsset: asset.quoteAsset,
      }, {
        provider: 'coinbase',
        providerAssetId: asset.instrument.productId,
        status: 'verified',
        platform: null,
        network: null,
        contractAddress: null,
        evidenceJson: JSON.stringify({ schemaVersion: 1, source: 'coinbase_public_catalog' }),
      }, observedAtMs, database);
    }
  });
}

export function listDisplayUniverse(profileId: string, database: Db): readonly AssetRef[] {
  if (!PROFILE_ID.test(profileId)) throw new TypeError('Invalid profile identity.');
  const rows = database.prepare(`SELECT c.venue, c.product_id, c.product_type,
    c.symbol, c.name, c.base_asset, c.quote_asset
    FROM display_universe_items_v1 d JOIN canonical_instruments c
      ON c.venue = d.venue AND c.product_id = d.product_id
      AND c.product_type = d.product_type
    WHERE d.profile_id = ? ORDER BY d.position`)
    .all(profileId) as unknown as DisplayUniverseRow[];
  return Object.freeze(rows.map((row) => Object.freeze(assetFromRow(row))));
}

function canonicalSelection(identities: readonly InstrumentIdentity[]): string {
  return JSON.stringify(identities.map((identity) => ({
    venue: identity.venue,
    productId: identity.productId,
    productType: identity.productType,
  })));
}

export interface ReplaceDisplayUniverseResult {
  readonly changed: boolean;
  readonly assets: readonly AssetRef[];
  readonly selectionHash: string;
}

/** Atomically replace ordered display preference and append one provenance event. */
export function replaceDisplayUniverse(
  profileId: string,
  identities: readonly InstrumentIdentity[],
  recordedAtMs: number,
  eventId: string,
  database: Db,
): ReplaceDisplayUniverseResult {
  if (!PROFILE_ID.test(profileId)) throw new TypeError('Invalid profile identity.');
  if (!validTime(recordedAtMs)) throw new TypeError('Invalid display-universe time.');
  if (!UUID_V4.test(eventId)) throw new TypeError('Invalid display-universe event identity.');
  if (identities.length > MAX_SELECTION) throw new RangeError('Display universe exceeds 100 items.');
  const keys = identities.map(instrumentKey);
  if (new Set(keys).size !== keys.length) throw new TypeError('Display universe has duplicates.');
  const selectionJson = canonicalSelection(identities);
  const selectionHash = sha256Hex(selectionJson);
  return inTransaction(database, () => {
    const prior = listDisplayUniverse(profileId, database);
    if (JSON.stringify(prior.map((asset) => asset.instrument)) === selectionJson) {
      return Object.freeze({ changed: false, assets: prior, selectionHash });
    }
    const selected: AssetRef[] = [];
    const lookup = database.prepare(`SELECT c.venue, c.product_id, c.product_type,
      c.symbol, c.name, c.base_asset, c.quote_asset FROM canonical_instruments c
      JOIN instrument_provider_mappings m ON m.venue = c.venue
        AND m.product_id = c.product_id AND m.product_type = c.product_type
        AND m.provider = 'coinbase' AND m.provider_asset_id = c.product_id
        AND m.status = 'verified'
      WHERE c.venue = ? AND c.product_id = ? AND c.product_type = ?`);
    for (const identity of identities) {
      const row = lookup.get(
        identity.venue, identity.productId, identity.productType,
      ) as unknown as DisplayUniverseRow | undefined;
      if (row === undefined) throw new TypeError('Display universe references an unknown instrument.');
      selected.push(Object.freeze(assetFromRow(row)));
    }
    database.prepare('DELETE FROM display_universe_items_v1 WHERE profile_id = ?').run(profileId);
    const insert = database.prepare(`INSERT INTO display_universe_items_v1 (
      profile_id, position, venue, product_id, product_type, selected_at
    ) VALUES (?, ?, ?, ?, ?, ?)`);
    identities.forEach((identity, position) => insert.run(
      profileId, position, identity.venue, identity.productId,
      identity.productType, recordedAtMs,
    ));
    database.prepare(`INSERT INTO display_universe_events_v1 (
      id, origin_profile_id, recorded_at_ms, selection_json, selection_hash
    ) VALUES (?, ?, ?, ?, ?)`)
      .run(eventId, profileId, recordedAtMs, selectionJson, selectionHash);
    return Object.freeze({
      changed: true,
      assets: Object.freeze(selected),
      selectionHash,
    });
  });
}
