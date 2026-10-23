import { mkdtempSync, rmSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coinbaseEvidenceDatasetHash, decimal, FixedClock, instrumentKey, profileConnectionV2, sha256Hex,
  type CapitalMetric, type CoinbaseAccountEvidence,
} from '@coqui/core';
import {
  coinbaseCapitalTransactionMetadata, fetchCoinbaseAccountEvidence, createMemorySecretStore,
  type CoinbaseEvidenceAcquisition, type CoinbaseReadHttpClient, type HttpResult,
} from '@coqui/adapters';
import {
  capitalPerformanceView, capitalScopesView, ingestAlpacaCapital, ingestCapitalEvidence,
  ingestCoinbaseCapital, ingestLocalPaperCapital,
} from '@coqui/services';
import {
  backupDatabase, createFileProfileDatabaseDuplicator, getCapitalReport, initializePaperBook, listCapitalBindings,
  listCapitalEvents, listCapitalSourceBatches, listCapitalValuations, openDatabase, saveProfileConnectionV2,
  saveVerifiedWalletIdentity, saveCapitalBinding, setSetting, type Db,
} from '@coqui/storage';
import { capturePaperPerformanceEvidence } from '../apps/desktop/src/main/paper-performance-evidence.js';
import { createCapitalHandlers } from '../apps/desktop/src/main/capital-handlers.js';
import { createConnectionHandlers } from '../apps/desktop/src/main/connection-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { CHANNEL_KINDS } from '@coqui/contracts';
import { batch, DAY, mark, scope } from './helpers/capital.js';

const dbs: Db[] = [], folders: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function db() { const value = openDatabase(':memory:'); dbs.push(value); return value; }
function metric(value: CapitalMetric) { return value.state === 'available' ? value.value : null; }
function read(database: Db, scopeId: string) {
  return capitalPerformanceView('main', { scopeId, epochId: null, fromMs: null, toMs: null }, database);
}
const instrument = { venue: 'coinbase' as const, productType: 'spot' as const, productId: 'BTC-USD' };
function paperOrigin(database: Db) {
  initializePaperBook({ schemaVersion: 1, profileId: 'main', source: 'tracked_holdings_opening', asOfMs: 0,
    cashUsd: '0', balances: [{ assetId: instrumentKey(instrument), quantity: '1', priceUsd: '500', valueUsd: '500' }] }, database);
}
const accountId = '11111111-1111-4111-8111-111111111111';
const portfolioId = '22222222-2222-4222-8222-222222222222';
function coinbaseAcquisition(): CoinbaseEvidenceAcquisition {
  const accounts: CoinbaseAccountEvidence[] = [{ accountUuid: accountId, currency: 'USD', availableQuantity: decimal('100'),
    holdQuantity: decimal('0'), totalQuantity: decimal('100'), active: true, ready: true, defaultAccount: true, providerUpdatedAtMs: null }];
  const transactions = [{ accountUuid: accountId, transactionId: 'deposit', type: 'fiat_deposit', status: 'completed',
    amount: decimal('100'), amountCurrency: 'USD', nativeAmount: decimal('100'), nativeCurrency: 'USD', createdAtMs: DAY, updatedAtMs: null, resourcePath: '/v2/accounts/example/transactions/deposit' }],
    feeTier = null;
  return { accounts, fills: [], transactions, feeTier, accountPageCount: 1, fillPageCount: 1, transactionPageCount: 1,
    datasetHash: coinbaseEvidenceDatasetHash(accounts, [], transactions, feeTier), capitalEvidence: { schemaVersion: 1, paginationComplete: true,
      accounts: [{ accountUuid: accountId, portfolioIdentityHash: sha256Hex(portfolioId) }], transactions: [] } };
}

describe('capital source ingestion and read-only boundaries', () => {
  it('does not infer paper capital from tax lots or a balance without an immutable origin', () => {
    const database = db(); ingestLocalPaperCapital('main', database, DAY);
    expect(capitalScopesView('main', database).scopes).toHaveLength(0);
  });
  it('captures unrounded observed prices without changing legacy daily evidence', async () => {
    const database = db(); paperOrigin(database);
    const spot = vi.fn(async () => new Map([[instrumentKey(instrument), { priceUsd: decimal('500.004'),
      source: 'fixture', quality: 'venue_reported_last' as const, observedAtMs: DAY }]]));
    const legacy = await capturePaperPerformanceEvidence({ profileId: 'main', runId: 'run', scheduledForMs: DAY,
      database, clock: new FixedClock(DAY), priceSource: { name: 'fixture', spot } });
    expect(legacy.equityUsd).toBe('500.00');
    const catalog = capitalScopesView('main', database), scopeId = catalog.scopes[0]!.scope.id;
    expect(read(database, scopeId).metrics.economicPnlUsd).toMatchObject({ state: 'available', value: '0.004' });
    expect(listCapitalValuations(scopeId, database).at(-1)).toMatchObject({ equityUsd: '500.004', atMs: DAY, verified: true });
    expect(spot).toHaveBeenCalledTimes(1);
    const count = listCapitalValuations(scopeId, database).length;
    ingestLocalPaperCapital('main', database, DAY + 1);
    expect(listCapitalValuations(scopeId, database)).toHaveLength(count);
    expect(database.prepare('SELECT equity_usd_text FROM paper_daily_valuation_evidence_v1').get()?.['equity_usd_text']).toBe('500.00');
  });
  it('does not convert missing provider price timestamps into the scheduled day', async () => {
    const database = db(); paperOrigin(database);
    await capturePaperPerformanceEvidence({ profileId: 'main', runId: 'run', scheduledForMs: DAY, database, clock: new FixedClock(DAY),
      priceSource: { name: 'fixture', spot: async () => new Map([[instrumentKey(instrument), {
        priceUsd: decimal('550'), source: 'fixture', quality: 'venue_reported_last', observedAtMs: null }]]) } });
    const scopeId = capitalScopesView('main', database).scopes[0]!.scope.id;
    expect(metric(read(database, scopeId).metrics.equityUsd)).toBe('550');
    expect(read(database, scopeId).metrics.economicPnlUsd.state).toBe('unavailable');
    expect(listCapitalValuations(scopeId, database).at(-1)?.missingComponents).toContain('valuation_time_unverified');
  });
  it('does not reinterpret an unexplained paper reconciliation as a deposit', () => {
    const database = db(); paperOrigin(database);
    database.prepare(`INSERT INTO paper_ledger_entries_v3 VALUES('foreign','main','manual',NULL,NULL,'reconciliation','USD','100','100',?)`).run(DAY);
    ingestLocalPaperCapital('main', database, DAY * 2);
    const scopeId = capitalScopesView('main', database).scopes[0]!.scope.id;
    expect(listCapitalEvents(scopeId, database)).toMatchObject([{ kind: 'unknown', externalFlowUsd: null, flowVerified: false }]);
    expect(listCapitalSourceBatches(scopeId, database)[0]?.coverage.complete).toBe(false);
  });
  it('records Coinbase candidates without treating creation time or native amount as effect/valuation proof', () => {
    const database = db(), connection = profileConnectionV2('main', 'coinbase', sha256Hex('credential'), 0);
    saveProfileConnectionV2(connection, database); saveVerifiedWalletIdentity(connection, 'portfolio', portfolioId, 0, database);
    const acquired = coinbaseAcquisition();
    ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id, requestedAtMs: DAY, observedAtMs: DAY + 1, acquisition: acquired, snapshot: null }, database);
    const descriptor = capitalScopesView('main', database).scopes[0]!;
    const events = listCapitalEvents(descriptor.scope.id, database);
    expect(events[0]).toMatchObject({ kind: 'contribution', externalFlowUsd: '100', flowVerified: false,
      effectiveTime: { precision: 'unknown', fromMs: null, toMs: null } });
    expect(descriptor.coverage?.complete).toBe(false);
    expect(read(database, descriptor.scope.id).metrics.economicPnlUsd.state).toBe('unavailable');
    expect(listCapitalSourceBatches(descriptor.scope.id, database)[0]?.payload).toHaveProperty('legacyDataset');
    ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id, requestedAtMs: DAY + 2, observedAtMs: DAY + 3, acquisition: acquired, snapshot: null }, database);
    expect(listCapitalEvents(descriptor.scope.id, database)).toHaveLength(1);
  });
  it('uses verified Coinbase portfolio identity across credential changes', () => {
    const database = db();
    for (const fingerprint of ['old', 'rotated']) {
      const connection = profileConnectionV2('main', 'coinbase', sha256Hex(fingerprint), 0);
      saveProfileConnectionV2(connection, database); saveVerifiedWalletIdentity(connection, 'portfolio', portfolioId, 0, database);
      ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id, requestedAtMs: DAY, observedAtMs: DAY + 1,
        acquisition: coinbaseAcquisition(), snapshot: null }, database);
    }
    expect(capitalScopesView('main', database).scopes).toHaveLength(1);
  });
  it('never manufactures a Coinbase account identity from a credential fingerprint', () => {
    const database = db();
    ingestCoinbaseCapital({ profileId: 'main', connectionId: 'unverified', requestedAtMs: DAY, observedAtMs: DAY,
      acquisition: coinbaseAcquisition(), snapshot: null }, database);
    expect(listCapitalBindings('main', database)).toHaveLength(0);
  });
  it('rejects a different verified portfolio instead of attributing its balances to the selected account', () => {
    const database = db(), connection = profileConnectionV2('main', 'coinbase', sha256Hex('credential'), 0);
    saveProfileConnectionV2(connection, database); saveVerifiedWalletIdentity(connection, 'portfolio', portfolioId, 0, database);
    const acquired = coinbaseAcquisition();
    expect(() => ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id, requestedAtMs: DAY, observedAtMs: DAY,
      acquisition: { ...acquired, capitalEvidence: { ...acquired.capitalEvidence!, accounts: [{ accountUuid: accountId,
        portfolioIdentityHash: sha256Hex('different') }] } }, snapshot: null }, database)).toThrow('portfolio identity mismatch');
    expect(listCapitalBindings('main', database)).toHaveLength(0);
  });
  it('persists only whitelisted financial fields from a Coinbase acquisition', () => {
    const database = db(), connection = profileConnectionV2('main', 'coinbase', sha256Hex('credential'), 0);
    saveProfileConnectionV2(connection, database); saveVerifiedWalletIdentity(connection, 'portfolio', portfolioId, 0, database);
    const acquired = coinbaseAcquisition();
    const widened = { ...acquired, accounts: acquired.accounts.map((row) => ({ ...row, apiKey: 'PRIVATE-CANARY' })) };
    ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id, requestedAtMs: DAY, observedAtMs: DAY, acquisition: widened, snapshot: null }, database);
    const scopeId = capitalScopesView('main', database).scopes[0]!.scope.id;
    expect(JSON.stringify(listCapitalSourceBatches(scopeId, database))).not.toContain('PRIVATE-CANARY');
  });
  it('can rebind archived connected evidence only after fresh matching connection verification', () => {
    const database = db(), connection = profileConnectionV2('main', 'coinbase', sha256Hex('credential'), 0);
    saveProfileConnectionV2(connection, database); saveVerifiedWalletIdentity(connection, 'portfolio', portfolioId, 0, database);
    ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id, requestedAtMs: DAY, observedAtMs: DAY,
      acquisition: coinbaseAcquisition(), snapshot: null }, database);
    const scopeId = listCapitalBindings('main', database)[0]!.scopeId;
    saveCapitalBinding({ profileId: 'copy', scopeId, mode: 'archived', connectionId: null, lastBatchId: null }, database);
    const fresh = profileConnectionV2('copy', 'coinbase', sha256Hex('fresh-credential'), DAY * 2);
    saveProfileConnectionV2(fresh, database); saveVerifiedWalletIdentity(fresh, 'portfolio', portfolioId, DAY * 2, database);
    ingestCoinbaseCapital({ profileId: 'copy', connectionId: fresh.id, requestedAtMs: DAY * 2, observedAtMs: DAY * 2,
      acquisition: coinbaseAcquisition(), snapshot: null }, database);
    expect(listCapitalBindings('copy', database)[0]).toMatchObject({ mode: 'active', connectionId: fresh.id });
    expect(capitalScopesView('copy', database).scopes[0]?.scope.originProfileId).toBe('main');
    expect(capitalScopesView('copy', database).scopes[0]?.coverage?.complete).toBe(false);
    expect(database.prepare('SELECT COUNT(*) AS n FROM research_preregistrations').get()?.['n']).toBe(0);
  });
  it('wires the actual connection-sync path to capital ingestion without an extra acquisition', async () => {
    const database = db(), secrets = createMemorySecretStore(), acquisition = coinbaseAcquisition();
    const credentials = { name: 'organizations/example/apiKeys/capital-fixture',
      privateKey: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }) as string };
    const acquire = vi.fn(async () => ({ ok: true as const, value: acquisition }));
    const handlers = createConnectionHandlers({ profileId: 'main', database, secrets, clock: new FixedClock(DAY * 3),
      pickConnectionFile: async () => ({ contents: JSON.stringify(credentials) }),
      coinbaseVerifier: { verify: async () => ({ ok: true, portfolioUuid: portfolioId }) }, coinbaseAcquirer: { acquire },
      priceSource: { name: 'fixture', spot: async () => new Map() } });
    const result = await handlers['connections.connect-file']!({ commandId: '00000000-0000-4000-8000-000000000010', provider: 'coinbase' } as never);
    expect(result.ok).toBe(true); expect(acquire).toHaveBeenCalledTimes(1);
    expect(capitalScopesView('main', database).scopes).toHaveLength(1);
    expect(database.prepare('SELECT COUNT(*) AS n FROM capital_event_revisions_v1').get()?.['n']).toBe(1);
    expect(JSON.stringify(database.prepare('SELECT content_json FROM capital_source_batches_v1').all())).not.toContain(credentials.privateKey);
  });
  it('retains pending-to-completed revisions of a Coinbase event rather than another contribution', () => {
    const database = db(), connection = profileConnectionV2('main', 'coinbase', sha256Hex('credential'), 0);
    saveProfileConnectionV2(connection, database); saveVerifiedWalletIdentity(connection, 'portfolio', portfolioId, 0, database);
    const acquired = coinbaseAcquisition(), pendingRows = acquired.transactions.map((row) => ({ ...row, status: 'pending' }));
    const pending = { ...acquired, transactions: pendingRows,
      datasetHash: coinbaseEvidenceDatasetHash(acquired.accounts, acquired.fills, pendingRows, acquired.feeTier) };
    for (const acquisition of [pending, acquired]) ingestCoinbaseCapital({ profileId: 'main', connectionId: connection.id,
      requestedAtMs: DAY, observedAtMs: DAY + 1, acquisition, snapshot: null }, database);
    const scopeId = capitalScopesView('main', database).scopes[0]!.scope.id, revisions = listCapitalEvents(scopeId, database);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]?.replacesId).toBe(revisions[0]?.id);
  });
  it('does not promote JNLC or a date-only cash activity into a precisely timed external flow', () => {
    const database = db();
    setSetting('alpaca.paper.account.id', 'account', database);
    ingestAlpacaCapital({ profileId: 'main', connectionId: 'alpaca:account', expectedAccountId: 'account', requestedAtMs: DAY * 3,
      observedAtMs: DAY * 3, account: { id: 'account', currency: 'USD', cash: '500', equity: '500', created_at: new Date(0).toISOString(),
        status: 'ACTIVE', account_blocked: false, trading_blocked: false }, history: { baseValueUsd: '500', points: [], cashflows: null },
      activities: [{ id: 'journal', activity_type: 'JNLC', currency: 'USD', status: 'executed', net_amount: '100', date: '1970-01-02' },
        { id: 'deposit', activity_type: 'CSD', currency: 'USD', status: 'executed', net_amount: '100', date: '1970-01-02' }],
      orders: [], paginationComplete: true, ordersComplete: true, cashReconciled: true, journalDetailsComplete: true }, database);
    const scopeId = listCapitalBindings('main', database)[0]!.scopeId, events = listCapitalEvents(scopeId, database);
    expect(events.find((row) => row.logicalKey.endsWith('journal'))).toMatchObject({ kind: 'unknown', flowVerified: false });
    expect(events.find((row) => row.logicalKey.endsWith('deposit'))?.effectiveTime.precision).toBe('unknown');
    expect(listCapitalValuations(scopeId, database).at(-1)).toMatchObject({ verified: false, missingComponents: ['coherent_financial_cut_unverified'] });
    expect(capitalScopesView('main', database).scopes[0]?.mode).toBe('active');
    setSetting('alpaca.paper.account.id', 'different', database);
    expect(capitalScopesView('main', database).scopes[0]?.mode).toBe('disconnected');
  });
  it('rejects a foreign broker account without recording capital evidence', () => {
    const database = db();
    expect(() => ingestAlpacaCapital({ profileId: 'main', connectionId: null, expectedAccountId: 'expected', requestedAtMs: 0, observedAtMs: 0,
      account: { id: 'foreign', currency: 'USD', cash: '0', equity: '0', status: 'ACTIVE', account_blocked: false, trading_blocked: false },
      history: { baseValueUsd: '0', points: [], cashflows: null }, activities: [], orders: [], paginationComplete: true,
      ordersComplete: true, cashReconciled: true, journalDetailsComplete: true }, database)).toThrow('identity mismatch');
    expect(listCapitalBindings('main', database)).toHaveLength(0);
  });
  it('keeps new IPC reads local, access checked, schema validated and non-mutating', async () => {
    const database = db(), rows = [mark(0, '500'), mark(DAY, '550')];
    const report = ingestCapitalEvidence({ profileId: 'main', connectionId: null, scope, batch, events: [], valuations: rows,
      opening: { valuationId: rows[0]!.id, historicalLimitations: [], reason: 'verified_origin' } }, database);
    const before = database.prepare('SELECT total_changes() AS n').get();
    const dispatch = createDispatcher({ handlers: createCapitalHandlers('main', database) });
    expect(CHANNEL_KINDS.read).toContain('capital.performance'); expect(CHANNEL_KINDS.write).not.toContain('capital.performance');
    expect(await dispatch('capital.scopes', {})).toMatchObject({ status: 'ok' });
    expect(await dispatch('capital.performance', { scopeId: scope.id, epochId: null, fromMs: null, toMs: null })).toMatchObject({ status: 'ok', value: report });
    expect(await dispatch('capital.performance', { scopeId: scope.id, epochId: null, fromMs: 2, toMs: 1 })).toMatchObject({ status: 'failed' });
    expect(() => capitalPerformanceView('foreign', { scopeId: scope.id, epochId: null, fromMs: null, toMs: null }, database)).toThrow('unavailable');
    expect(database.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(getCapitalReport(report.inputHash, database)).toEqual(report);
  });
  it('restores the same profile without minting new observations, identities or reports', () => {
    const folder = mkdtempSync(join(tmpdir(), 'coqui-capital-restore-')); folders.push(folder);
    const database = db(), rows = [mark(0, '500'), mark(DAY, '550')];
    const report = ingestCapitalEvidence({ profileId: 'main', connectionId: null, scope, batch, events: [], valuations: rows,
      opening: { valuationId: rows[0]!.id, historicalLimitations: [], reason: 'verified_origin' } }, database);
    const target = join(folder, 'restored.db'); backupDatabase(database, target);
    const restored = openDatabase(target); dbs.push(restored);
    expect(getCapitalReport(report.inputHash, restored)).toEqual(report);
    expect(read(restored, scope.id)).toEqual(report);
    expect(listCapitalValuations(scope.id, restored)).toEqual(rows);
    expect(capitalScopesView('main', restored).scopes[0]?.latestObservedAtMs).toBe(batch.observedAtMs);
    expect(restored.prepare('SELECT content_hash FROM capital_scopes_v1').get()).toEqual(database.prepare('SELECT content_hash FROM capital_scopes_v1').get());
  });
  it('archives copied bindings and preserves exact financial payload hashes and historical reports', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'coqui-capital-copy-')); folders.push(folder);
    const path = join(folder, 'wallet.db'), source = openDatabase(path); dbs.push(source);
    const rows = [mark(0, '500'), mark(DAY, '550')];
    const report = ingestCapitalEvidence({ profileId: 'main', connectionId: null, scope, batch, events: [], valuations: rows,
      opening: { valuationId: rows[0]!.id, historicalLimitations: [], reason: 'verified_origin' } }, source);
    const targetId = '00000000-0000-4000-8000-000000000001';
    const result = await createFileProfileDatabaseDuplicator(folder).duplicate({ sourceProfileId: 'main', sourceDbFilename: 'wallet.db',
      targetProfileId: targetId, targetDbFilename: `wallet-${targetId}.db` });
    expect(result.ok).toBe(true);
    const copied = openDatabase(join(folder, `wallet-${targetId}.db`)); dbs.push(copied);
    expect(listCapitalBindings(targetId, copied)).toMatchObject([{ mode: 'archived', connectionId: null, lastBatchId: null }]);
    expect(getCapitalReport(report.inputHash, copied)).toEqual(report);
    expect(copied.prepare('SELECT content_hash FROM capital_scopes_v1').get()).toEqual(source.prepare('SELECT content_hash FROM capital_scopes_v1').get());
    expect(listCapitalBindings('main', source)[0]?.mode).toBe('active');
  });
});

describe('separate Coinbase capital envelope', () => {
  it('preserves schema-2 dataset hashes while retaining portfolio and transaction metadata', async () => {
    const rawAccount = { uuid: accountId, currency: 'USD', available_balance: { value: '100', currency: 'USD' },
      hold: { value: '0', currency: 'USD' }, active: true, ready: true, default: true, retail_portfolio_id: portfolioId };
    const tx = { id: 'send', type: 'send', status: 'completed', amount: { amount: '-1', currency: 'BTC' },
      native_amount: { amount: '-100', currency: 'USD' }, created_at: new Date(DAY).toISOString(),
      resource_path: '/v2/accounts/example/transactions/send', to: { resource: 'account', id: accountId, email: 'PRIVATE-CANARY' },
      transaction_fee: { amount: '0.001', currency: 'BTC' }, description: 'PRIVATE-CANARY' };
    const values = [{ accounts: [rawAccount], has_next: false }, { fills: [] }, { data: [tx], pagination: { next_uri: null } }];
    const getJson = vi.fn(async (): Promise<HttpResult<unknown>> => ({ ok: true, status: 200, data: values.shift() }));
    const acquired = await fetchCoinbaseAccountEvidence({ getJson } as unknown as CoinbaseReadHttpClient, undefined,
      { includeTransactions: true, includeCapitalEvidence: true });
    expect(acquired.ok).toBe(true); if (!acquired.ok) return;
    expect(acquired.value.capitalEvidence?.accounts[0]?.portfolioIdentityHash).toBe(sha256Hex(portfolioId));
    expect(acquired.value.datasetHash).toBe(coinbaseEvidenceDatasetHash(acquired.value.accounts, acquired.value.fills, acquired.value.transactions, acquired.value.feeTier));
    expect(JSON.stringify(acquired.value.capitalEvidence)).not.toContain('PRIVATE-CANARY');
    expect(coinbaseCapitalTransactionMetadata(tx, accountId, 'send')).toMatchObject({ fee: { quantity: '0.001', asset: 'BTC' }, counterpartyKind: 'account' });
    expect(getJson).toHaveBeenCalledTimes(3);
  });
});
