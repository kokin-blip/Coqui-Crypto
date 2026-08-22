import { describe, expect, it } from 'vitest';

import {
  coinbaseEvidenceDatasetHash,
  decimal,
  FixedClock,
  type AssetQuantity,
  type AssetRef,
  type CoinbaseAccountEvidence,
  type CoinbaseBalanceDiscrepancy,
  type CoinbaseFillEvidence,
  type TaxLot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  RECONCILIATION_OPTIONS,
  ReconciliationLedgerService,
} from '../packages/services/src/index.js';
import {
  insertTaxLots,
  listCoinbaseBalanceDiscrepancies,
  openDatabase,
  saveCoinbaseSyncEvidence,
  type Db,
} from '../packages/storage/src/index.js';

const T0 = 1_800_000_000_000;
const PROFILE = 'main';

const BTC_REF: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

const accounts: readonly CoinbaseAccountEvidence[] = [{
  accountUuid: '11111111-1111-4111-8111-111111111111',
  currency: 'BTC',
  availableQuantity: decimal('1.1'),
  holdQuantity: decimal('0.2'),
  totalQuantity: decimal('1.3'),
  active: true,
  ready: true,
  defaultAccount: false,
  providerUpdatedAtMs: null,
}];
const fills: readonly CoinbaseFillEvidence[] = [{
  tradeId: 'trade-1',
  orderId: 'order-1',
  productId: 'BTC-USD',
  side: 'BUY',
  price: decimal('50000'),
  size: decimal('0.1'),
  commission: decimal('1'),
  sizeInQuote: false,
  tradeAtMs: T0 - 1_000,
  sequenceAtMs: T0 - 999,
}];
const discrepancies: readonly CoinbaseBalanceDiscrepancy[] = [{
  currency: 'BTC',
  kind: 'provider_exceeds_local',
  providerQuantity: decimal('1.3'),
  localQuantity: decimal('1'),
  deltaQuantity: decimal('0.3'),
}];

function seeded(): Db {
  const database = openDatabase(':memory:');
  saveCoinbaseSyncEvidence(
    {
      profileId: PROFILE,
      requestedAtMs: T0 - 100,
      receivedAtMs: T0,
      accountPageCount: 1,
      fillPageCount: 1,
      datasetHash: coinbaseEvidenceDatasetHash(accounts, fills),
      accounts,
      fills,
      discrepancies,
    },
    database,
  );
  return database;
}

function lot(id: string): TaxLot {
  return {
    id,
    asset: BTC_REF,
    quantity: '0.3' as AssetQuantity,
    remaining: '0.3' as AssetQuantity,
    costUsd: '15000.00' as UsdAmount,
    acquiredAt: T0 - 10_000,
    source: 'manual',
    externalId: null,
  };
}

function service(database: Db): ReconciliationLedgerService {
  return new ReconciliationLedgerService({ database, clock: new FixedClock(T0) });
}

function firstDiscrepancyId(database: Db): string {
  const [discrepancy] = listCoinbaseBalanceDiscrepancies(database, 10);
  if (discrepancy === undefined) throw new Error('fixture produced no discrepancy');
  return discrepancy.id;
}

describe('an exception starts unresolved and says so', () => {
  it('lists the discrepancy with no decision attached', () => {
    const database = seeded();
    const view = service(database).view(PROFILE);

    expect(view.exceptions).toHaveLength(1);
    expect(view.exceptions[0]?.resolution).toBeNull();
    expect(view.unresolvedCount).toBe(1);
    database.close();
  });

  it('offers only outcomes that leave the tax lots alone', () => {
    const database = seeded();
    const kinds = service(database).view(PROFILE).options.map((option) => option.kind);

    // Invariant 12 in the shape of the menu. The predecessor minted a
    // zero-basis lot and rescaled proportionally; neither is offerable here,
    // and this test is what keeps them from being added back "just for this
    // case".
    expect(kinds).toEqual([
      'external_transfer_in',
      'external_transfer_out',
      'matched_to_lot',
      'provider_error',
      'investigating',
    ]);
    expect(kinds).not.toContain('create_zero_basis_lot');
    expect(kinds).not.toContain('rescale_lots');
    database.close();
  });

  it('explains every option in the words the surface should use', () => {
    // A resolution the user cannot understand is a resolution they will pick at
    // random, and the wrong pick here corrupts a cost basis.
    for (const option of RECONCILIATION_OPTIONS) {
      expect(option.explanation.length).toBeGreaterThan(40);
      expect(option.label.length).toBeGreaterThan(0);
    }
    expect(RECONCILIATION_OPTIONS.filter((option) => option.requiresLot)).toHaveLength(1);
  });
});

describe('a decision is recorded, never an edit', () => {
  it('resolves an exception and reports it as decided', () => {
    const database = seeded();
    const ledger = service(database);
    const id = firstDiscrepancyId(database);

    const result = ledger.resolve({
      profileId: PROFILE,
      discrepancyId: id,
      kind: 'external_transfer_in',
      note: 'Sent from a hardware wallet in June.',
    });

    expect(result.ok).toBe(true);
    const view = ledger.view(PROFILE);
    expect(view.exceptions[0]?.resolution?.kind).toBe('external_transfer_in');
    expect(view.unresolvedCount).toBe(0);
    database.close();
  });

  it('leaves the evidence row exactly as the venue reported it', () => {
    const database = seeded();
    const ledger = service(database);
    const id = firstDiscrepancyId(database);
    const before = listCoinbaseBalanceDiscrepancies(database, 10)[0];

    ledger.resolve({
      profileId: PROFILE,
      discrepancyId: id,
      kind: 'provider_error',
      note: 'Coinbase double-counted a pending transfer.',
    });

    // What the venue said is a fact. A resolution is a later record about that
    // fact, and migration 42 makes the distinction structural.
    expect(listCoinbaseBalanceDiscrepancies(database, 10)[0]).toEqual(before);
    database.close();
  });

  it('supersedes by appending, keeping the earlier decision readable', () => {
    const database = seeded();
    const ledger = service(database);
    const id = firstDiscrepancyId(database);

    ledger.resolve({
      profileId: PROFILE,
      discrepancyId: id,
      kind: 'investigating',
      note: 'Waiting on the venue’s support reply.',
    });
    ledger.resolve({
      profileId: PROFILE,
      discrepancyId: id,
      kind: 'external_transfer_in',
      note: 'Support confirmed an inbound transfer.',
    });

    const exception = ledger.view(PROFILE).exceptions[0];
    expect(exception?.history).toHaveLength(2);
    // The history is the point: what was believed, and when, survives the
    // correction.
    expect(exception?.history.map((entry) => entry.kind)).toContain('investigating');
    database.close();
  });

  it('is idempotent for the same decision', () => {
    const database = seeded();
    const ledger = service(database);
    const id = firstDiscrepancyId(database);
    const input = {
      profileId: PROFILE,
      discrepancyId: id,
      kind: 'provider_error' as const,
      note: 'Venue error.',
    };

    ledger.resolve(input);
    ledger.resolve(input);

    expect(ledger.view(PROFILE).exceptions[0]?.history).toHaveLength(1);
    database.close();
  });

  it('refuses to delete or rewrite a recorded decision', () => {
    const database = seeded();
    service(database).resolve({
      profileId: PROFILE,
      discrepancyId: firstDiscrepancyId(database),
      kind: 'provider_error',
      note: 'Venue error.',
    });

    expect(() => database.exec('DELETE FROM reconciliation_resolutions_v1'))
      .toThrow('append-only');
    expect(() => database.exec("UPDATE reconciliation_resolutions_v1 SET note = 'changed'"))
      .toThrow('append-only');
    database.close();
  });
});

describe('a match must point at a lot that already exists', () => {
  it('accepts a match against a real lot', () => {
    const database = seeded();
    insertTaxLots([lot('lot-real')], database);

    const result = service(database).resolve({
      profileId: PROFILE,
      discrepancyId: firstDiscrepancyId(database),
      kind: 'matched_to_lot',
      linkedLotId: 'lot-real',
      note: 'This is the June purchase already recorded.',
    });

    expect(result).toMatchObject({ ok: true });
    database.close();
  });

  it('refuses a match against a lot that does not exist', () => {
    const database = seeded();

    // The side door invariant 12 has to stay shut: if a match could name a
    // nonexistent lot, the resolution would be asserting a basis nothing holds.
    expect(
      service(database).resolve({
        profileId: PROFILE,
        discrepancyId: firstDiscrepancyId(database),
        kind: 'matched_to_lot',
        linkedLotId: 'lot-imaginary',
        note: 'Matches something.',
      }),
    ).toEqual({ ok: false, code: 'unknown_lot' });
    database.close();
  });

  it('refuses a match with no lot, and a non-match carrying one', () => {
    const database = seeded();
    const ledger = service(database);
    const id = firstDiscrepancyId(database);

    expect(
      ledger.resolve({ profileId: PROFILE, discrepancyId: id, kind: 'matched_to_lot', note: 'x y z' }),
    ).toEqual({ ok: false, code: 'lot_required' });
    expect(
      ledger.resolve({
        profileId: PROFILE,
        discrepancyId: id,
        kind: 'provider_error',
        linkedLotId: 'lot-real',
        note: 'x y z',
      }),
    ).toEqual({ ok: false, code: 'lot_not_allowed' });
    database.close();
  });
});

describe('a resolution needs evidence and an explanation', () => {
  it('refuses to resolve a discrepancy that was never observed', () => {
    const database = seeded();

    expect(
      service(database).resolve({
        profileId: PROFILE,
        discrepancyId: 'f'.repeat(64),
        kind: 'provider_error',
        note: 'Nothing to explain.',
      }),
    ).toEqual({ ok: false, code: 'unknown_discrepancy' });
    database.close();
  });

  it('refuses an empty note', () => {
    const database = seeded();

    // A resolution with no explanation is indistinguishable from dismissing the
    // exception, which is precisely what this ledger exists to prevent.
    expect(
      service(database).resolve({
        profileId: PROFILE,
        discrepancyId: firstDiscrepancyId(database),
        kind: 'provider_error',
        note: '   ',
      }),
    ).toEqual({ ok: false, code: 'note_required' });
    database.close();
  });
});
