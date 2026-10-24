import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capitalHash, capitalScopeId, cashClaim, sha256Hex, budgetEvidence, nativeRuleReasons, projectAccountBudget } from '@coqui/core';
import { normalizeAlpacaCapitalRules, normalizeCoinbaseCapitalRules, sanitizedCapitalProduct } from '@coqui/adapters';
import { accessibleCapitalBudget, captureAlpacaCapitalBudget, capitalFeasibilityView, recordBudgetDeficit } from '@coqui/services';
import { backupDatabase, createFileProfileDatabaseDuplicator, currentBudget, getBudgetSource, listCashClaims, openDatabase,
  saveBudgetSource, saveCapitalBinding, saveCapitalScope, saveCashClaim, saveNativeExecutionRules, getNativeExecutionRules, type Db } from '@coqui/storage';
import { CHANNEL_KINDS } from '@coqui/contracts';
import { createCapitalFeasibilityHandlers } from '../apps/desktop/src/main/capital-feasibility-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { BOOK, NOW, SCOPE, source, rules } from './helpers/feasibility.js';

const dbs: Db[] = [], folders: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function db(path = ':memory:') { const value = openDatabase(path); dbs.push(value); return value; }
function seed(database: Db) {
  saveCapitalScope({ id: SCOPE, provider: 'local_paper', environment: 'simulation', accountIdentityHash: BOOK,
    originProfileId: 'main', currency: 'USD', createdAtMs: NOW }, database);
  saveCapitalBinding({ profileId: 'main', scopeId: SCOPE, connectionId: null, mode: 'active', lastBatchId: null }, database);
  saveNativeExecutionRules(rules, database); saveBudgetSource(source(), database);
}
const product = { product_id: 'BTC-USD', product_type: 'SPOT', base_currency_id: 'BTC', quote_currency_id: 'USD',
  base_increment: '0.00000001', base_min_size: '0.0001', base_max_size: '100', quote_increment: '0.01', quote_min_size: '1',
  quote_max_size: '1000000', price_increment: '0.01', status: 'online', trading_disabled: false, cancel_only: false,
  limit_only: false, post_only: false, view_only: false, is_disabled: false };
const context = { productId: 'BTC-USD', assetId: 'coinbase|spot|BTC-USD', observedAtMs: NOW, evidenceRef: 'fixture', tradabilityChecked: true };

describe('P2 provider evidence and financial identity', () => {
  it('keeps increments distinct from minima, requires permission evidence, and strips arbitrary provider secrets', () => {
    const rule = normalizeCoinbaseCapitalRules(product, context);
    expect(rule.quantityMin).toEqual({ state: 'known', value: '0.0001' });
    expect(rule.quantityIncrement).toEqual({ state: 'known', value: '0.00000001' });
    expect(rule.tradable).toBe(true); expect(nativeRuleReasons(rule, NOW)).toEqual([]);
    expect(normalizeCoinbaseCapitalRules(product, { ...context, tradabilityChecked: false }).tradable).toBeNull();
    expect(sanitizedCapitalProduct({ ...product, private_key: 'DO-NOT-PERSIST' })).not.toHaveProperty('private_key');
    expect(() => normalizeCoinbaseCapitalRules({ ...product, base_currency_id: 'ETH' }, context)).toThrow('identity');
    expect(() => normalizeCoinbaseCapitalRules({ ...product, quote_currency_id: 'EUR' }, context)).toThrow('identity');
  });
  it('does not infer absent maxima, missing flags or exact precision from transport numbers', () => {
    const rule = normalizeCoinbaseCapitalRules({ ...product, base_min_size: undefined, base_max_size: undefined, view_only: undefined }, context);
    expect(rule.quantityMin.state).toBe('unknown'); expect(rule.quantityMax.state).toBe('unknown'); expect(rule.tradable).toBeNull();
    expect(normalizeCoinbaseCapitalRules({ ...product, trading_disabled: true }, context).tradable).toBe(false);
    const alpaca = normalizeAlpacaCapitalRules({ id: 'actual-asset-id', class: 'crypto', symbol: 'BTC/USD', status: 'active', tradable: true,
      min_order_size: '0.00000001', min_trade_increment: 0.00000001, price_increment: '0.01' },
    { symbol: 'BTC/USD', assetId: context.assetId, observedAtMs: NOW, evidenceRef: 'asset' });
    expect(alpaca.quantityMin.state).toBe('known'); expect(alpaca.quantityIncrement.state).toBe('unknown');
    expect(alpaca.quantityMax.state).toBe('unknown'); expect(alpaca.productId).toBe('actual-asset-id');
    expect(nativeRuleReasons(alpaca, NOW + 30_000)).toContain('native_rules_stale');
  });
  it('uses the observed non-marginable field and leaves connected legacy ownership blocked with a submit trap', async () => {
    const database = db(), id = 'broker-account', identity = sha256Hex(id), scopeId = capitalScopeId('alpaca', 'paper', identity);
    saveCapitalScope({ id: scopeId, provider: 'alpaca', environment: 'paper', accountIdentityHash: identity, originProfileId: 'main', currency: 'USD', createdAtMs: NOW }, database);
    saveCapitalBinding({ profileId: 'main', scopeId, connectionId: null, mode: 'active', lastBatchId: null }, database);
    const submit = vi.fn(() => { throw new Error('financial_write_forbidden'); });
    const client = { account: vi.fn(async () => ({ id, cash: '100', equity: '200', buying_power: '5000',
      non_marginable_buying_power: '0', currency: 'USD', status: 'ACTIVE', trading_blocked: false, account_blocked: false })), submit, cancel: submit, transfer: submit };
    const account = await client.account();
    const assetRead = vi.fn(async () => ({ id: 'alpaca-native-btc', symbol: 'BTC/USD', class: 'crypto', status: 'active', tradable: true,
      min_order_size: '0.00000001', min_trade_increment: '0.00000001', price_increment: '0.01', private_key: 'DO-NOT-PERSIST' }));
    captureAlpacaCapitalBudget(scopeId, account, NOW, 'existing-authorized-GET', database,
      [{ symbol: 'BTC/USD', assetId: context.assetId, value: await assetRead() }]);
    const saved = getBudgetSource(currentBudget(scopeId, NOW, database)!.sourceId, database)!;
    expect(saved.venueEligibleUsd).toEqual({ state: 'known', value: '0' });
    const native = getNativeExecutionRules(saved.ruleIds[0]!, database)!;
    expect(native.productId).toBe('alpaca-native-btc'); expect(native.rawEvidenceJson).not.toContain('DO-NOT-PERSIST');
    expect(currentBudget(scopeId, NOW, database)).toMatchObject({ observedCashUsd: '100', spendableUsd: null });
    expect(currentBudget(scopeId, NOW, database)?.reasonCodes).toContain('legacy_writer_conflict'); expect(submit).not.toHaveBeenCalled();
    expect(() => captureAlpacaCapitalBudget(scopeId, { ...account, id: 'wrong' }, NOW, 'foreign', database)).toThrow('identity');
    saveCashClaim(cashClaim({ scopeId, originKey: 'observed-unknown-order', replacesId: null, assetId: 'USD', amount: '70', purpose: 'order',
      state: 'unknown', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['known-obligation'] }), database);
    captureAlpacaCapitalBudget(scopeId, { ...account, cash: '60' }, NOW + 1, 'external-debit-observation', database);
    captureAlpacaCapitalBudget(scopeId, { ...account, cash: '60' }, NOW + 1, 'external-debit-observation', database);
    expect(currentBudget(scopeId, NOW + 1, database)?.deficits).toEqual({}); // Unmatched provider holds cannot prove an exact shortfall.
    expect(listCashClaims(scopeId, database)[0]?.state).toBe('unknown'); expect(submit).not.toHaveBeenCalled();
  });
});

describe('P2 read-only access and lifecycle', () => {
  it('records a known shortfall once, without releasing the original obligation', () => {
    const database = db(); seed(database);
    const claim = cashClaim({ scopeId: SCOPE, originKey: 'pending', replacesId: null, assetId: 'USD', amount: '70', purpose: 'order',
      state: 'unknown', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['known'] }); saveCashClaim(claim, database);
    const report = projectAccountBudget(source({ cashUsd: '60', equityUsd: '60' }), [claim], NOW);
    expect(report.deficits['USD']).toBe('10'); recordBudgetDeficit(report, database); recordBudgetDeficit(report, database);
    expect(database.prepare("SELECT COUNT(*) AS n FROM runtime_incidents WHERE source='capital_budget_v1' AND severity='blocking'").get()?.['n']).toBe(1);
    expect(listCashClaims(SCOPE, database)).toEqual([claim]);
  });
  it('reads IPC without provider/claim/registration mutations and rejects inaccessible scopes and renderer authority', async () => {
    const database = db(); seed(database);
    const total = () => database.prepare('SELECT total_changes() AS n').get()?.['n'];
    const dispatch = createDispatcher({ handlers: () => createCapitalFeasibilityHandlers('main', database, () => NOW) });
    const before = total();
    expect((await dispatch('capital.budget', { scopeId: SCOPE })).status).toBe('ok');
    expect((await dispatch('capital.feasibility', { mode: 'scenario', scopeId: null, capitalUsd: '100', tradeUsd: '5', minimumQuantity: '0.01', quantityIncrement: '0.01' })).status).toBe('ok');
    expect(total()).toBe(before); expect(listCashClaims(SCOPE, database)).toEqual([]);
    expect(CHANNEL_KINDS.read).toContain('capital.budget'); expect(CHANNEL_KINDS.read).toContain('capital.feasibility');
    expect((await dispatch('capital.budget', { scopeId: capitalHash('foreign') })).status).not.toBe('ok');
    expect((await dispatch('capital.budget', { scopeId: SCOPE, cashUsd: '1000000', authority: 'isolated_book' })).status).not.toBe('ok');
    expect(() => accessibleCapitalBudget('other-profile', SCOPE, NOW, database)).toThrow('scope');
    expect(database.prepare('SELECT COUNT(*) AS n FROM research_preregistrations').get()?.['n']).toBe(0);
  });
  it('retains as-of evidence and obligations through backup/restore and archives copied access', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'coqui-p2-lifecycle-')); folders.push(folder);
    const database = db(join(folder, 'main.db')); seed(database);
    const claim = cashClaim({ scopeId: SCOPE, originKey: 'pending', replacesId: null, assetId: 'USD', amount: '70', purpose: 'order',
      state: 'unknown', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['original'] }); saveCashClaim(claim, database);
    const original = currentBudget(SCOPE, NOW, database)!;
    backupDatabase(database, join(folder, 'restored.db'));
    const restored = db(join(folder, 'restored.db')); expect(currentBudget(SCOPE, NOW, restored)).toEqual(original);
    expect(currentBudget(SCOPE, NOW + 30_000, restored)?.spendableUsd).toBeNull(); expect(listCashClaims(SCOPE, restored)).toEqual([claim]);
    const target = '11111111-1111-4111-8111-111111111111';
    const filename = `wallet-${target}.db`;
    const result = await createFileProfileDatabaseDuplicator(folder).duplicate({ sourceProfileId: 'main', sourceDbFilename: 'main.db', targetProfileId: target, targetDbFilename: filename });
    expect(result.ok).toBe(true);
    const copy = db(join(folder, filename)); expect(listCashClaims(SCOPE, copy)).toEqual([claim]);
    expect(accessibleCapitalBudget(target, SCOPE, NOW, copy).budget?.reasonCodes).toContain('budget_scope_archived');
    expect(getBudgetSource(original.sourceId, copy)?.observedAtMs).toBe(NOW);
  });
  it('keeps source conflicts and stale dates unavailable and leaves missing proposal bindings explicit', () => {
    const database = db(); seed(database);
    saveBudgetSource(budgetEvidence({ ...source(), holdMatchingComplete: false }), database);
    expect(accessibleCapitalBudget('main', SCOPE, NOW, database).budget?.reasonCodes).toContain('budget_source_conflict');
    expect(() => capitalFeasibilityView('main', { mode: 'proposal', scopeId: SCOPE, proposalId: 'missing', expectedRevision: capitalHash('rev') }, NOW, database)).toThrow('proposal');
  });
});
