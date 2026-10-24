import { afterEach, describe, expect, it } from 'vitest';
import { cashClaim, capitalHash, evaluateCapitalFeasibility } from '@coqui/core';
import { openDatabase, saveCapitalScope, saveCapitalBinding, saveNativeExecutionRules, saveBudgetSource, currentBudget,
  withBudgetClaim, listCashClaims, saveCashClaim, saveBudgetReport, saveFeasibilityReport, getBudgetReport, getFeasibilityReport,
  budgetCheckpoint, type Db } from '@coqui/storage';
import { BOOK, NOW, SCOPE, source, rules, feasibility } from './helpers/feasibility.js';

const dbs: Db[] = []; afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function setup() {
  const db = openDatabase(':memory:'); dbs.push(db);
  saveCapitalScope({ id: SCOPE, provider: 'local_paper', environment: 'simulation', accountIdentityHash: BOOK, originProfileId: 'main', currency: 'USD', createdAtMs: NOW }, db);
  saveCapitalBinding({ profileId: 'main', scopeId: SCOPE, connectionId: null, mode: 'active', lastBatchId: null }, db);
  saveNativeExecutionRules(rules, db); saveBudgetSource(source({ cashUsd: '100', equityUsd: '100', assurance: 'observed' }), db); return db;
}
const claim = (key: string, amount = '70') => cashClaim({ scopeId: SCOPE, originKey: key, replacesId: null, assetId: 'USD', amount, purpose: 'order',
  state: 'committed', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['synthetic_existing_oms_intent'] });

describe('P2 append-only storage and actual budget transaction boundary', () => {
  it('creates empty additive tables and immutable native/evidence/claim/report rows', () => {
    const db = setup(); saveCashClaim(claim('one', '1'), db);
    const report = currentBudget(SCOPE, NOW, db)!; saveBudgetReport(report, db);
    for (const table of ['capital_native_rule_evidence_v1', 'capital_budget_source_evidence_v1', 'capital_cash_claim_revisions_v1', 'capital_budget_reports_v1']) {
      expect(() => db.prepare(`DELETE FROM ${table}`).run()).toThrow('immutable');
      expect(() => db.prepare(`UPDATE ${table} SET content_json=content_json`).run()).toThrow('immutable');
    }
  });
  it('permits exact retries and refuses fabricated financial identity, missing rules and cross-scope claims', () => {
    const db = setup(); expect(saveNativeExecutionRules(rules, db)).toBe(false);
    expect(() => saveBudgetSource({ ...source(), id: capitalHash('forged') }, db)).toThrow('identity');
    expect(() => saveBudgetSource(source({ bookId: 'wrong-account' }), db)).toThrow('identity');
    expect(() => saveBudgetSource(source({ ruleIds: [capitalHash('missing')] }), db)).toThrow('rule_missing');
    expect(saveCashClaim(claim('one'), db)).toBe(true); expect(saveCashClaim(claim('one'), db)).toBe(false);
    expect(() => saveCashClaim(cashClaim({ ...claim('two'), purpose: 'profit_reserve' }), db)).toThrow('p2_funded_reserves_disabled');
  });
  it('serializes two competing $70 intents against $100 and refuses stale revisions', () => {
    const db = setup(), revision = currentBudget(SCOPE, NOW, db)!.revision;
    let committed = 0;
    withBudgetClaim('main', SCOPE, revision, claim('first'), NOW, db, () => { committed += 1; });
    expect(currentBudget(SCOPE, NOW, db)?.spendableUsd).toBe('30');
    expect(() => withBudgetClaim('main', SCOPE, revision, claim('second'), NOW, db, () => { committed += 1; })).toThrow('budget_revision_stale');
    expect(() => withBudgetClaim('main', SCOPE, currentBudget(SCOPE, NOW, db)!.revision, claim('second'), NOW, db, () => { committed += 1; })).toThrow('budget_capacity_exceeded');
    expect(committed).toBe(1); expect(listCashClaims(SCOPE, db)).toHaveLength(1);
  });
  it('rolls back the claim, existing-intent persistence and checkpoint after failure', () => {
    const db = setup(), revision = currentBudget(SCOPE, NOW, db)!.revision, checkpoint = budgetCheckpoint(SCOPE, db);
    expect(() => withBudgetClaim('main', SCOPE, revision, claim('crash'), NOW, db, () => {
      db.prepare("INSERT INTO app_settings(key,value) VALUES('p2-crash','not-committed')").run(); throw new Error('injected-failure');
    })).toThrow('injected-failure');
    expect(listCashClaims(SCOPE, db)).toHaveLength(0); expect(budgetCheckpoint(SCOPE, db)).toEqual(checkpoint);
    expect(db.prepare("SELECT value FROM app_settings WHERE key='p2-crash'").get()).toBeUndefined();
  });
  it('retains old reports through explicit claim revisions and rejects terminal reactivation', () => {
    const db = setup(), first = claim('one', '10'); saveCashClaim(first, db);
    const old = currentBudget(SCOPE, NOW, db)!; saveBudgetReport(old, db);
    const released = cashClaim({ ...first, replacesId: first.id, state: 'released' }); saveCashClaim(released, db);
    const next = currentBudget(SCOPE, NOW, db)!; saveBudgetReport(next, db);
    expect(getBudgetReport(old.id, db)).toEqual(old); expect(next.spendableUsd).toBe('100');
    expect(() => saveCashClaim(cashClaim({ ...released, replacesId: released.id, state: 'committed' }), db)).toThrow('terminal');
    const frame = feasibility('100', { budget: next, expectedRevision: next.revision });
    const result = evaluateCapitalFeasibility(frame); saveFeasibilityReport(result, db); expect(getFeasibilityReport(result.id, db)).toEqual(result);
  });
  it('keeps conflicting simultaneous sources unavailable and scope access archived', () => {
    const db = setup(); saveBudgetSource(source({ cashUsd: '90', equityUsd: '90', assurance: 'observed' }), db);
    expect(currentBudget(SCOPE, NOW, db)?.reasonCodes).toContain('budget_source_conflict');
    saveCapitalBinding({ profileId: 'main', scopeId: SCOPE, connectionId: null, mode: 'archived', lastBatchId: null }, db);
    expect(() => withBudgetClaim('main', SCOPE, currentBudget(SCOPE, NOW, db)!.revision, claim('copy'), NOW, db, () => null)).toThrow('budget_authority_unavailable');
  });
  it('retains a claim after an external debit and exposes underfunding, instead of releasing it', () => {
    const db = setup(); saveCashClaim(claim('pending'), db);
    saveBudgetSource(source({ cashUsd: '60', equityUsd: '60', assurance: 'observed', observedAtMs: NOW + 1, expiresAtMs: NOW + 30_001 }), db);
    expect(currentBudget(SCOPE, NOW + 1, db)?.deficits['USD']).toBe('10'); expect(listCashClaims(SCOPE, db)).toHaveLength(1);
  });
});
