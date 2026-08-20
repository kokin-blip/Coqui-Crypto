import {
  coinbaseAccountTotalQuantity,
  coinbaseEvidenceDatasetHash,
  decimal,
  nonNegativeDecimal,
  sha256Hex,
  type CoinbaseAccountEvidence,
  type CoinbaseBalanceDiscrepancy,
  type CoinbaseFillEvidence,
} from '@coqui/core';
import { Decimal } from 'decimal.js';

import { inTransaction, type Db } from '../sqlite/index.js';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const HASH = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURRENCY = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;

export interface CoinbaseSyncEvidenceInput {
  readonly profileId: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly accountPageCount: number;
  readonly fillPageCount: number;
  readonly datasetHash: string;
  readonly accounts: readonly CoinbaseAccountEvidence[];
  readonly fills: readonly CoinbaseFillEvidence[];
  readonly discrepancies: readonly CoinbaseBalanceDiscrepancy[];
}

export interface CoinbaseSyncEvidenceSummary {
  readonly id: string;
  readonly profileId: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly accountPageCount: number;
  readonly fillPageCount: number;
  readonly accountRowCount: number;
  readonly fillRowCount: number;
  readonly discrepancyCount: number;
  readonly datasetHash: string;
}

export interface SaveCoinbaseSyncEvidenceResult {
  readonly created: boolean;
  readonly summary: CoinbaseSyncEvidenceSummary;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validate(input: CoinbaseSyncEvidenceInput): void {
  if (!PROFILE_ID.test(input.profileId)) throw new TypeError('Invalid profile identity.');
  if (!validTime(input.requestedAtMs) || !validTime(input.receivedAtMs) ||
    input.receivedAtMs < input.requestedAtMs) throw new TypeError('Invalid sync timing.');
  if (!Number.isSafeInteger(input.accountPageCount) || input.accountPageCount < 1 ||
    input.accountPageCount > 1_000 || !Number.isSafeInteger(input.fillPageCount) ||
    input.fillPageCount < 1 || input.fillPageCount > 1_000) {
    throw new TypeError('Invalid provider page counts.');
  }
  if (!HASH.test(input.datasetHash) ||
    coinbaseEvidenceDatasetHash(input.accounts, input.fills) !== input.datasetHash) {
    throw new TypeError('Coinbase evidence hash mismatch.');
  }
  const accounts = new Set<string>();
  for (const account of input.accounts) {
    if (!UUID.test(account.accountUuid) || !CURRENCY.test(account.currency) ||
      typeof account.active !== 'boolean' || typeof account.ready !== 'boolean' ||
      typeof account.defaultAccount !== 'boolean') {
      throw new TypeError('Invalid account evidence metadata.');
    }
    if (accounts.has(account.accountUuid)) throw new TypeError('Duplicate account evidence.');
    accounts.add(account.accountUuid);
    if (coinbaseAccountTotalQuantity(account.availableQuantity, account.holdQuantity) !==
      account.totalQuantity) throw new TypeError('Account total mismatch.');
    nonNegativeDecimal(account.availableQuantity);
    nonNegativeDecimal(account.holdQuantity);
    nonNegativeDecimal(account.totalQuantity);
    if (account.providerUpdatedAtMs !== null && !validTime(account.providerUpdatedAtMs)) {
      throw new TypeError('Invalid provider account time.');
    }
  }
  const fills = new Set<string>();
  for (const fill of input.fills) {
    if (!IDENTIFIER.test(fill.tradeId) || !IDENTIFIER.test(fill.orderId) ||
      !PRODUCT.test(fill.productId) || (fill.side !== 'BUY' && fill.side !== 'SELL') ||
      typeof fill.sizeInQuote !== 'boolean') {
      throw new TypeError('Invalid fill evidence metadata.');
    }
    if (fills.has(fill.tradeId)) throw new TypeError('Duplicate fill evidence.');
    fills.add(fill.tradeId);
    nonNegativeDecimal(fill.price);
    nonNegativeDecimal(fill.size);
    nonNegativeDecimal(fill.commission);
    if (new Decimal(fill.price).lte(0) || new Decimal(fill.size).lte(0)) {
      throw new TypeError('Fill price and size must be positive.');
    }
    if (!validTime(fill.tradeAtMs) || !validTime(fill.sequenceAtMs)) {
      throw new TypeError('Invalid provider fill time.');
    }
  }
  const currencies = new Set<string>();
  for (const discrepancy of input.discrepancies) {
    if (!CURRENCY.test(discrepancy.currency)) {
      throw new TypeError('Invalid discrepancy currency.');
    }
    if (currencies.has(discrepancy.currency)) throw new TypeError('Duplicate discrepancy.');
    currencies.add(discrepancy.currency);
    nonNegativeDecimal(discrepancy.providerQuantity);
    nonNegativeDecimal(discrepancy.localQuantity);
    nonNegativeDecimal(discrepancy.deltaQuantity);
    const difference = new Decimal(discrepancy.providerQuantity)
      .minus(discrepancy.localQuantity);
    if (difference.isZero() || difference.abs().toFixed() !== discrepancy.deltaQuantity ||
      (difference.isPositive() && discrepancy.kind !== 'provider_exceeds_local') ||
      (difference.isNegative() && discrepancy.kind !== 'local_exceeds_provider')) {
      throw new TypeError('Discrepancy direction or delta is invalid.');
    }
  }
}

function identity(input: CoinbaseSyncEvidenceInput): string {
  return sha256Hex(JSON.stringify({
    schemaVersion: 2,
    profileId: input.profileId,
    requestedAtMs: input.requestedAtMs,
    receivedAtMs: input.receivedAtMs,
    accountPageCount: input.accountPageCount,
    fillPageCount: input.fillPageCount,
    datasetHash: input.datasetHash,
    discrepancies: [...input.discrepancies]
      .sort((left, right) => left.currency.localeCompare(right.currency)),
  }));
}

function summary(input: CoinbaseSyncEvidenceInput, id: string): CoinbaseSyncEvidenceSummary {
  return Object.freeze({
    id,
    profileId: input.profileId,
    requestedAtMs: input.requestedAtMs,
    receivedAtMs: input.receivedAtMs,
    accountPageCount: input.accountPageCount,
    fillPageCount: input.fillPageCount,
    accountRowCount: input.accounts.length,
    fillRowCount: input.fills.length,
    discrepancyCount: input.discrepancies.length,
    datasetHash: input.datasetHash,
  });
}

/** Atomically append one complete provider acquisition; exact retries are idempotent. */
export function saveCoinbaseSyncEvidence(
  input: CoinbaseSyncEvidenceInput,
  database: Db,
): SaveCoinbaseSyncEvidenceResult {
  validate(input);
  const id = identity(input);
  const resultSummary = summary(input, id);
  return inTransaction(database, () => {
    const prior = database.prepare('SELECT dataset_hash FROM coinbase_sync_runs_v2 WHERE id = ?')
      .get(id) as { dataset_hash: string } | undefined;
    if (prior !== undefined) {
      if (prior.dataset_hash !== input.datasetHash) throw new Error('Sync identity is immutable.');
      return Object.freeze({ created: false, summary: resultSummary });
    }
    database.prepare(`INSERT INTO coinbase_sync_runs_v2 (
      id, origin_profile_id, requested_at_ms, received_at_ms, account_page_count,
      fill_page_count, account_row_count, fill_row_count, dataset_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.profileId, input.requestedAtMs, input.receivedAtMs,
      input.accountPageCount, input.fillPageCount, input.accounts.length,
      input.fills.length, input.datasetHash,
    );
    const accountInsert = database.prepare(`INSERT INTO coinbase_account_evidence_v2 (
      run_id, account_uuid, currency, available_quantity_text, hold_quantity_text,
      total_quantity_text, active, ready, default_account, provider_updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const account of input.accounts) accountInsert.run(
      id, account.accountUuid, account.currency, account.availableQuantity,
      account.holdQuantity, account.totalQuantity, account.active ? 1 : 0,
      account.ready ? 1 : 0, account.defaultAccount ? 1 : 0,
      account.providerUpdatedAtMs,
    );
    const fillInsert = database.prepare(`INSERT INTO coinbase_fill_evidence_v2 (
      run_id, trade_id, order_id, product_id, side, price_text, size_text,
      commission_text, size_in_quote, trade_at_ms, sequence_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const fill of input.fills) fillInsert.run(
      id, fill.tradeId, fill.orderId, fill.productId, fill.side, fill.price,
      fill.size, fill.commission, fill.sizeInQuote ? 1 : 0,
      fill.tradeAtMs, fill.sequenceAtMs,
    );
    const discrepancyInsert = database.prepare(`INSERT INTO coinbase_balance_discrepancies_v2 (
      id, run_id, currency, kind, provider_quantity_text, local_quantity_text,
      delta_quantity_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const discrepancy of input.discrepancies) discrepancyInsert.run(
      sha256Hex(`${id}:${discrepancy.currency}:${discrepancy.kind}`), id,
      discrepancy.currency, discrepancy.kind, discrepancy.providerQuantity,
      discrepancy.localQuantity, discrepancy.deltaQuantity,
    );
    return Object.freeze({ created: true, summary: resultSummary });
  });
}

export interface CoinbaseDiscrepancyEvidenceView extends CoinbaseBalanceDiscrepancy {
  readonly id: string;
  readonly runId: string;
  readonly receivedAtMs: number;
  /** Immutable provenance retained if a profile database is duplicated. */
  readonly originProfileId: string;
}

/** Bounded newest-first unresolved evidence read; no resolution is inferred. */
export function listCoinbaseBalanceDiscrepancies(
  database: Db,
  limit = 250,
): readonly CoinbaseDiscrepancyEvidenceView[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError('Coinbase discrepancy limit must be in [1, 1000].');
  }
  const rows = database.prepare(`SELECT d.*, r.received_at_ms, r.origin_profile_id FROM
    coinbase_balance_discrepancies_v2 d JOIN coinbase_sync_runs_v2 r ON r.id = d.run_id
    ORDER BY r.received_at_ms DESC, d.currency, d.id LIMIT ?`)
    .all(limit) as Array<Record<string, unknown>>;
  return Object.freeze(rows.map((row) => Object.freeze({
    id: String(row['id']),
    runId: String(row['run_id']),
    receivedAtMs: Number(row['received_at_ms']),
    originProfileId: String(row['origin_profile_id']),
    currency: String(row['currency']),
    kind: String(row['kind']) as CoinbaseBalanceDiscrepancy['kind'],
    providerQuantity: decimal(String(row['provider_quantity_text'])),
    localQuantity: decimal(String(row['local_quantity_text'])),
    deltaQuantity: decimal(String(row['delta_quantity_text'])),
  })));
}
