import { createHash } from 'node:crypto';

import { instrumentKey, type InstrumentIdentity } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

export type MarketDataProvider = 'coinbase' | 'coingecko' | 'coinmarketcap' | 'coinpaprika';
export type MappingStatus = 'verified' | 'ambiguous' | 'retired';

export interface CanonicalInstrumentRecord {
  instrument: InstrumentIdentity;
  symbol: string;
  name: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface InstrumentProviderMapping {
  provider: MarketDataProvider;
  providerAssetId: string;
  instrument: InstrumentIdentity;
  status: MappingStatus;
  platform: string | null;
  network: string | null;
  contractAddress: string | null;
  evidenceJson: string;
  verifiedAt: number | null;
  updatedAt: number;
}

export interface CanonicalMappingException {
  sourceTable: string;
  sourceKey: string;
  reason: string;
  recordedAt: number;
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be non-empty.`);
  return value;
}

function evidenceObject(json: string): string {
  const value = JSON.parse(json) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider mapping evidence must be a JSON object.');
  }
  return json;
}

function identityFromRow(row: {
  venue: string; product_id: string; product_type: string;
}): InstrumentIdentity {
  if (row.venue !== 'coinbase' || row.product_type !== 'spot') {
    throw new Error('Stored provider mapping has an unsupported canonical identity.');
  }
  return { venue: row.venue, productId: row.product_id, productType: row.product_type };
}

function mappingFromRow(row: Record<string, unknown>): InstrumentProviderMapping {
  return {
    provider: row['provider'] as MarketDataProvider,
    providerAssetId: row['provider_asset_id'] as string,
    instrument: identityFromRow(row as unknown as {
      venue: string; product_id: string; product_type: string;
    }),
    status: row['status'] as MappingStatus,
    platform: row['platform'] as string | null,
    network: row['network'] as string | null,
    contractAddress: row['contract_address'] as string | null,
    evidenceJson: row['evidence_json'] as string,
    verifiedAt: row['verified_at'] as number | null,
    updatedAt: row['updated_at'] as number,
  };
}

/** Persist one explicit provider-to-venue identity and append immutable evidence. */
export function upsertInstrumentProviderMapping(
  canonical: CanonicalInstrumentRecord,
  mapping: Omit<InstrumentProviderMapping, 'instrument' | 'updatedAt' | 'verifiedAt'>,
  at: number,
  database: Db,
): void {
  instrumentKey(canonical.instrument);
  nonEmpty(canonical.symbol, 'Symbol');
  nonEmpty(canonical.name, 'Name');
  nonEmpty(canonical.baseAsset, 'Base asset');
  nonEmpty(canonical.quoteAsset, 'Quote asset');
  nonEmpty(mapping.providerAssetId, 'Provider asset id');
  const evidenceJson = evidenceObject(mapping.evidenceJson);
  inTransaction(database, () => {
    database.prepare(
      `INSERT INTO canonical_instruments
       (venue, product_id, product_type, symbol, name, base_asset, quote_asset, created_at, updated_at)
       VALUES (@venue, @productId, @productType, @symbol, @name, @baseAsset, @quoteAsset, @at, @at)
       ON CONFLICT(venue, product_id, product_type) DO UPDATE SET
         symbol = excluded.symbol, name = excluded.name, base_asset = excluded.base_asset,
         quote_asset = excluded.quote_asset, updated_at = excluded.updated_at`,
    ).run({ ...canonical.instrument, symbol: canonical.symbol, name: canonical.name,
      baseAsset: canonical.baseAsset, quoteAsset: canonical.quoteAsset, at });

    const priorRow = database.prepare(
      'SELECT * FROM instrument_provider_mappings WHERE provider = ? AND provider_asset_id = ?',
    ).get(mapping.provider, mapping.providerAssetId) as Record<string, unknown> | undefined;
    if (priorRow) {
      const prior = mappingFromRow(priorRow);
      if (instrumentKey(prior.instrument) !== instrumentKey(canonical.instrument)) {
        throw new Error('A provider asset id cannot be silently remapped to another instrument.');
      }
    }
    const verifiedAt = mapping.status === 'verified' ? at : null;
    database.prepare(
      `INSERT INTO instrument_provider_mappings
       (provider, provider_asset_id, venue, product_id, product_type, status, platform,
        network, contract_address, evidence_json, verified_at, updated_at)
       VALUES (@provider, @providerAssetId, @venue, @productId, @productType, @status,
        @platform, @network, @contractAddress, @evidenceJson, @verifiedAt, @at)
       ON CONFLICT(provider, provider_asset_id) DO UPDATE SET
        status = excluded.status, platform = excluded.platform, network = excluded.network,
        contract_address = excluded.contract_address, evidence_json = excluded.evidence_json,
        verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
    ).run({ ...mapping, ...canonical.instrument, evidenceJson, verifiedAt, at });
    const eventMaterial = JSON.stringify({
      provider: mapping.provider, providerAssetId: mapping.providerAssetId,
      instrument: canonical.instrument, status: mapping.status, evidenceJson, at,
    });
    database.prepare(
      `INSERT OR IGNORE INTO instrument_mapping_events_v2
       (id, provider, provider_asset_id, venue, product_id, product_type,
        action, status, evidence_json, at)
       VALUES (?, ?, ?, ?, ?, ?, 'upsert', ?, ?, ?)`,
    ).run(createHash('sha256').update(eventMaterial).digest('hex'), mapping.provider,
      mapping.providerAssetId, canonical.instrument.venue, canonical.instrument.productId,
      canonical.instrument.productType, mapping.status, evidenceJson, at);
  });
}

export function resolveVerifiedProviderInstrument(
  provider: MarketDataProvider,
  providerAssetId: string,
  database: Db,
): InstrumentIdentity | null {
  const row = database.prepare(
    `SELECT venue, product_id, product_type FROM instrument_provider_mappings
     WHERE provider = ? AND provider_asset_id = ? AND status = 'verified'`,
  ).get(provider, providerAssetId) as unknown as {
    venue: string; product_id: string; product_type: string;
  } | undefined;
  return row ? identityFromRow(row) : null;
}

export function listInstrumentProviderMappings(
  instrument: InstrumentIdentity,
  database: Db,
): InstrumentProviderMapping[] {
  instrumentKey(instrument);
  const rows = database.prepare(
    `SELECT * FROM instrument_provider_mappings
     WHERE venue = ? AND product_id = ? AND product_type = ? ORDER BY provider, provider_asset_id`,
  ).all(instrument.venue, instrument.productId, instrument.productType) as Record<string, unknown>[];
  return rows.map(mappingFromRow);
}

export function listCanonicalMappingExceptions(database: Db): CanonicalMappingException[] {
  const rows = database.prepare(
    `SELECT source_table, source_key, reason, recorded_at
     FROM canonical_mapping_migration_exceptions ORDER BY source_table, source_key`,
  ).all() as unknown as Array<{
    source_table: string; source_key: string; reason: string; recorded_at: number;
  }>;
  return rows.map((row) => ({ sourceTable: row.source_table, sourceKey: row.source_key,
    reason: row.reason, recordedAt: row.recorded_at }));
}
