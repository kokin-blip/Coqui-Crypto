import { describe, expect, it } from 'vitest';

import {
  coinbaseEvidenceDatasetHash,
  decimal,
  type CoinbaseAccountEvidence,
  type CoinbaseBalanceDiscrepancy,
  type CoinbaseFillEvidence,
} from '../packages/core/src/index.js';
import {
  listCoinbaseBalanceDiscrepancies,
  openDatabase,
  readProfileDeletionImpact,
  saveCoinbaseSyncEvidence,
} from '../packages/storage/src/index.js';

const accounts: readonly CoinbaseAccountEvidence[] = [{
  accountUuid: '11111111-1111-4111-8111-111111111111',
  currency: 'BTC', availableQuantity: decimal('1.1'), holdQuantity: decimal('0.2'),
  totalQuantity: decimal('1.3'), active: true, ready: true,
  defaultAccount: false, providerUpdatedAtMs: null,
}];
const fills: readonly CoinbaseFillEvidence[] = [{
  tradeId: 'trade-1', orderId: 'order-1', productId: 'BTC-USD', side: 'BUY',
  price: decimal('50000'), size: decimal('0.1'), commission: decimal('1'),
  sizeInQuote: false, tradeAtMs: 80, sequenceAtMs: 81,
}];
const discrepancies: readonly CoinbaseBalanceDiscrepancy[] = [{
  currency: 'BTC', kind: 'provider_exceeds_local', providerQuantity: decimal('1.3'),
  localQuantity: decimal('1'), deltaQuantity: decimal('0.3'),
}];

function input() {
  return {
    profileId: 'main', requestedAtMs: 100, receivedAtMs: 110,
    accountPageCount: 1, fillPageCount: 1,
    datasetHash: coinbaseEvidenceDatasetHash(accounts, fills),
    accounts, fills, discrepancies,
  };
}

describe('Coinbase evidence repository', () => {
  it('atomically appends exact facts and makes exact retries idempotent', () => {
    const database = openDatabase(':memory:');
    const first = saveCoinbaseSyncEvidence(input(), database);
    const retry = saveCoinbaseSyncEvidence(input(), database);
    expect(first.created).toBe(true);
    expect(retry).toEqual({ ...first, created: false });
    expect(database.prepare('SELECT COUNT(*) AS count FROM coinbase_sync_runs_v2').get())
      .toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM coinbase_account_evidence_v2').get())
      .toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM coinbase_fill_evidence_v2').get())
      .toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM coinbase_balance_discrepancies_v2').get())
      .toEqual({ count: 1 });
    expect(readProfileDeletionImpact('main', database).importEvidenceRecords).toBe(4);
    expect(Object.isFrozen(first.summary)).toBe(true);
    database.close();
  });

  it('returns bounded immutable discrepancy evidence with no resolution claim', () => {
    const database = openDatabase(':memory:');
    saveCoinbaseSyncEvidence(input(), database);
    const result = listCoinbaseBalanceDiscrepancies(database, 1);
    expect(result).toEqual([{
      id: expect.stringMatching(/^[0-9a-f]{64}$/u),
      runId: expect.stringMatching(/^[0-9a-f]{64}$/u),
      receivedAtMs: 110,
      originProfileId: 'main',
      ...discrepancies[0],
    }]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(() => listCoinbaseBalanceDiscrepancies(database, 1_001)).toThrow(RangeError);
    database.close();
  });

  it('rejects hash/total corruption before beginning persistence', () => {
    const database = openDatabase(':memory:');
    expect(() => saveCoinbaseSyncEvidence({ ...input(), datasetHash: '0'.repeat(64) }, database))
      .toThrow('hash mismatch');
    expect(() => saveCoinbaseSyncEvidence({
      ...input(),
      accounts: [{ ...accounts[0]!, totalQuantity: decimal('99') }],
      datasetHash: coinbaseEvidenceDatasetHash(
        [{ ...accounts[0]!, totalQuantity: decimal('99') }], fills,
      ),
    }, database)).toThrow('total mismatch');
    expect(database.prepare('SELECT COUNT(*) AS count FROM coinbase_sync_runs_v2').get())
      .toEqual({ count: 0 });
    database.close();
  });

  it('rejects mathematically inconsistent discrepancy evidence', () => {
    const database = openDatabase(':memory:');
    expect(() => saveCoinbaseSyncEvidence({
      ...input(), discrepancies: [{ ...discrepancies[0]!, deltaQuantity: decimal('0.4') }],
    }, database)).toThrow('direction or delta');
    expect(database.prepare('SELECT COUNT(*) AS count FROM coinbase_sync_runs_v2').get())
      .toEqual({ count: 0 });
    database.close();
  });

  it('enforces append-only SQL triggers for every evidence surface', () => {
    const database = openDatabase(':memory:');
    const saved = saveCoinbaseSyncEvidence(input(), database);
    expect(() => database.prepare('UPDATE coinbase_sync_runs_v2 SET received_at_ms = 120 WHERE id = ?')
      .run(saved.summary.id)).toThrow('immutable');
    expect(() => database.prepare('DELETE FROM coinbase_account_evidence_v2 WHERE run_id = ?')
      .run(saved.summary.id)).toThrow('immutable');
    expect(() => database.prepare('DELETE FROM coinbase_fill_evidence_v2 WHERE run_id = ?')
      .run(saved.summary.id)).toThrow('immutable');
    expect(() => database.prepare('DELETE FROM coinbase_balance_discrepancies_v2 WHERE run_id = ?')
      .run(saved.summary.id)).toThrow('immutable');
    database.close();
  });
});
