import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createMemorySecretStore,
  serializeCoinbaseCredentials,
  type CoinbaseCredentials,
  type CoinbaseEvidenceAcquisitionResult,
} from '../packages/adapters/src/index.js';
import {
  coinbaseEvidenceDatasetHash,
  decimal,
  type AssetRef,
  type CoinbaseAccountEvidence,
  type CoinbaseFillEvidence,
  type Disposal,
  type TaxLot,
} from '../packages/core/src/index.js';
import {
  CoinbaseAccountSyncService,
  createCoinbaseProfileRefreshExecutor,
  type CoinbaseEvidenceAcquirer,
} from '../packages/services/src/index.js';
import {
  getSetting,
  insertDisposals,
  insertTaxLots,
  listCoinbaseBalanceDiscrepancies,
  openDatabase,
} from '../packages/storage/src/index.js';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: 'bitcoin',
};

function credentials(): CoinbaseCredentials {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    keyName: 'organizations/example/apiKeys/evidence-key',
    privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
  };
}

const accounts: readonly CoinbaseAccountEvidence[] = [{
  accountUuid: '11111111-1111-4111-8111-111111111111', currency: 'BTC',
  availableQuantity: decimal('1.2'), holdQuantity: decimal('0.1'),
  totalQuantity: decimal('1.3'), active: true, ready: true,
  defaultAccount: true, providerUpdatedAtMs: 90,
}];
const fills: readonly CoinbaseFillEvidence[] = [{
  tradeId: 'trade-1', orderId: 'order-1', productId: 'BTC-USD', side: 'BUY',
  price: decimal('100'), size: decimal('1'), commission: decimal('1'),
  sizeInQuote: false, tradeAtMs: 80, sequenceAtMs: 81,
}];

function acquired(): CoinbaseEvidenceAcquisitionResult {
  return {
    ok: true,
    value: {
      accounts, fills, accountPageCount: 1, fillPageCount: 1,
      datasetHash: coinbaseEvidenceDatasetHash(accounts, fills),
    },
  };
}

function lot(): TaxLot {
  return {
    id: 'local-btc', asset: BTC, quantity: decimal('1'), remaining: decimal('1'),
    costUsd: decimal('100'), acquiredAt: 1, source: 'manual', externalId: null,
  };
}

function disposal(): Disposal {
  return {
    id: 'prior-disposal', asset: BTC, quantity: decimal('0.1'),
    proceedsUsd: decimal('20'), costBasisUsd: decimal('10'), realizedPnlUsd: decimal('10'),
    longTerm: false, disposedAt: 2, method: 'fifo', source: 'manual',
  };
}

async function fixture(acquirerResult: CoinbaseEvidenceAcquisitionResult = acquired()) {
  const database = openDatabase(':memory:');
  insertTaxLots([lot()], database);
  insertDisposals([disposal()], database);
  const credential = credentials();
  const secretStore = createMemorySecretStore();
  await secretStore.write('coinbase-credentials', serializeCoinbaseCredentials(credential), 'main');
  const acquirer: CoinbaseEvidenceAcquirer = { acquire: vi.fn(async () => acquirerResult) };
  const service = new CoinbaseAccountSyncService({
    database, clock: { nowMs: () => 110 }, secretStore, acquirer,
  });
  return { database, secretStore, acquirer, service };
}

function rawLedger(database: ReturnType<typeof openDatabase>) {
  return {
    lots: database.prepare('SELECT * FROM tax_lots_v2 ORDER BY id').all(),
    disposals: database.prepare('SELECT * FROM disposals_v2 ORDER BY id').all(),
  };
}

describe('Coinbase account sync service', () => {
  it('persists immutable facts/discrepancies while leaving tax lots and disposals byte-for-byte unchanged', async () => {
    const target = await fixture();
    const before = rawLedger(target.database);
    const result = await target.service.sync('main', 100);
    expect(result).toEqual({
      ok: true,
      value: {
        profileId: 'main', requestedAtMs: 100, receivedAtMs: 110,
        datasetHash: coinbaseEvidenceDatasetHash(accounts, fills),
        accountCount: 1, fillCount: 1, discrepancyCount: 1, evidenceCount: 4,
        created: true, portfolioMutated: false, syntheticLotsCreated: false,
        syntheticFillsCreated: false,
      },
    });
    expect(rawLedger(target.database)).toEqual(before);
    expect(listCoinbaseBalanceDiscrepancies(target.database)).toMatchObject([{
      originProfileId: 'main',
      currency: 'BTC', kind: 'provider_exceeds_local',
      providerQuantity: '1.3', localQuantity: '1', deltaQuantity: '0.3',
    }]);
    expect(getSetting('coinbase.last_sync_at', target.database)).toBe('110');
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok ? result.value : null)).toBe(true);
    target.database.close();
  });

  it('is idempotent for an exact retry and preserves accounting again', async () => {
    const target = await fixture();
    const first = await target.service.sync('main', 100);
    const retry = await target.service.sync('main', 100);
    expect(first.ok && first.value.created).toBe(true);
    expect(retry.ok && retry.value.created).toBe(false);
    expect(target.database.prepare('SELECT COUNT(*) AS count FROM coinbase_sync_runs_v2').get())
      .toEqual({ count: 1 });
    expect(rawLedger(target.database)).toEqual({
      lots: target.database.prepare('SELECT * FROM tax_lots_v2 ORDER BY id').all(),
      disposals: target.database.prepare('SELECT * FROM disposals_v2 ORDER BY id').all(),
    });
    target.database.close();
  });

  it('rolls back the sync and last-sync setting together after storage rejection', async () => {
    const target = await fixture();
    target.database.prepare("INSERT INTO app_settings (key, value) VALUES ('coinbase.last_sync_at', '50')").run();
    target.database.exec(`CREATE TRIGGER injected_coinbase_sync_failure
      BEFORE INSERT ON coinbase_fill_evidence_v2 BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
    expect(await target.service.sync('main', 100)).toEqual({ ok: false, code: 'storage_rejected' });
    expect(getSetting('coinbase.last_sync_at', target.database)).toBe('50');
    expect(target.database.prepare('SELECT COUNT(*) AS count FROM coinbase_sync_runs_v2').get())
      .toEqual({ count: 0 });
    target.database.close();
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['shutdown', 'shutdown'],
    ['elapsed_budget_exhausted', 'elapsed_budget_exhausted'],
    ['unauthorized', 'authentication_failed'],
    ['forbidden', 'authentication_failed'],
    ['rate_limited', 'rate_limited'],
    ['network', 'provider_unavailable'],
    ['proof_token_required', 'data_invalid'],
  ] as const)('maps acquisition %s to safe service code %s', async (providerCode, serviceCode) => {
    const target = await fixture({ ok: false, code: providerCode, resource: 'fills' });
    expect(await target.service.sync('main', 100)).toEqual({ ok: false, code: serviceCode });
    expect(target.database.prepare('SELECT COUNT(*) AS count FROM coinbase_sync_runs_v2').get())
      .toEqual({ count: 0 });
    target.database.close();
  });

  it('fails safely for absent/malformed credentials and invalid clocks', async () => {
    const database = openDatabase(':memory:');
    const missing = new CoinbaseAccountSyncService({
      database, clock: { nowMs: () => 100 }, secretStore: createMemorySecretStore(),
      acquirer: { acquire: vi.fn() },
    });
    expect(await missing.sync('main', 90)).toEqual({ ok: false, code: 'credentials_unavailable' });
    const malformedStore = createMemorySecretStore();
    await malformedStore.write('coinbase-credentials', '{bad', 'main');
    const malformed = new CoinbaseAccountSyncService({
      database, clock: { nowMs: () => 100 }, secretStore: malformedStore,
      acquirer: { acquire: vi.fn() },
    });
    expect(await malformed.sync('main', 90)).toEqual({ ok: false, code: 'credentials_invalid' });
    expect(await malformed.sync('../escape', 90)).toEqual({ ok: false, code: 'invalid_profile_id' });
    database.close();
  });
});

describe('Coinbase profile refresh binding', () => {
  it('skips unconfigured profiles without opening storage and closes configured contexts', async () => {
    const target = await fixture();
    const close = vi.fn();
    const openProfileContext = vi.fn(() => ({ database: target.database, close }));
    const executor = createCoinbaseProfileRefreshExecutor({
      clock: { nowMs: () => 110 }, secretStore: target.secretStore,
      acquirer: target.acquirer, openProfileContext,
    });
    expect(await executor.refresh({
      profileId: 'main', databaseFilename: 'ignored.db',
      configurationHint: 'not_configured', requestedAtMs: 100,
    })).toEqual({ status: 'skipped', reasonCode: 'not_configured' });
    expect(openProfileContext).not.toHaveBeenCalled();
    expect(await executor.refresh({
      profileId: 'main', databaseFilename: 'profile.db',
      configurationHint: 'configured', requestedAtMs: 100,
    })).toEqual({ status: 'refreshed', evidenceCount: 4 });
    expect(openProfileContext).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'main', databaseFilename: 'profile.db',
    }));
    expect(close).toHaveBeenCalledOnce();
    target.database.close();
  });
});
