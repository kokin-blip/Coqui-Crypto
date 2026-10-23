import { afterEach, describe, expect, it } from 'vitest';
import {
  calculateCapitalPerformance, capitalHash,
} from '@coqui/core';
import {
  getCapitalReport, listCapitalEvents, listCapitalSourceBatches, listCapitalValuations, openDatabase,
  saveCapitalScope, saveCapitalSourceBatch, saveCapitalValuation, saveCapitalEpoch, saveCapitalEvent,
  saveCapitalBinding, saveCapitalReport, inTransaction, type Db,
} from '@coqui/storage';
import { batch, DAY, epoch, event, mark, scope } from './helpers/capital.js';

const databases: Db[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = openDatabase(':memory:'); databases.push(db);
  saveCapitalScope(scope, db); saveCapitalSourceBatch(batch, db); return db;
}

describe('immutable canonical capital storage', () => {
  it('migrates additively with no fabricated opening or funding', () => {
    const db = openDatabase(':memory:'); databases.push(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM capital_scopes_v1').get()?.['n']).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM capital_event_revisions_v1').get()?.['n']).toBe(0);
  });
  it('preserves exact retries and rejects conflicting batch identities', () => {
    const db = setup();
    expect(saveCapitalSourceBatch(batch, db)).toBe(false);
    expect(() => saveCapitalSourceBatch({ ...batch, payload: { financial: false } }, db)).toThrow('identity conflict');
    expect(listCapitalSourceBatches(scope.id, db)).toEqual([batch]);
  });
  it('cannot mutate or delete financial facts', () => {
    const db = setup();
    expect(() => db.prepare('DELETE FROM capital_source_batches_v1').run()).toThrow('immutable');
    expect(() => db.prepare('UPDATE capital_scopes_v1 SET currency=currency').run()).toThrow('immutable');
  });
  it('deduplicates events across acquisition runs rather than counting another deposit', () => {
    const db = setup(), e = event();
    expect(saveCapitalEvent(e, db)).toBe(true);
    const next = { ...batch, id: capitalHash('next-batch'), observedAtMs: batch.observedAtMs + 1, recordedAtMs: batch.recordedAtMs + 1 };
    saveCapitalSourceBatch(next, db);
    expect(saveCapitalEvent({ ...e, sourceBatchId: next.id, observedAtMs: e.observedAtMs + 1, recordedAtMs: e.recordedAtMs + 1 }, db)).toBe(false);
    expect(listCapitalEvents(scope.id, db)).toHaveLength(1);
  });
  it('binds facts and corrections to the exact financial scope', () => {
    const db = setup();
    expect(() => saveCapitalValuation({ ...mark(0, '500'), scopeId: capitalHash('other') }, db)).toThrow('source mismatch');
    expect(() => saveCapitalEvent(event({ replacesId: capitalHash('missing'), correctionAuthority: 'provider_revision' }), db)).toThrow('lineage mismatch');
  });
  it('keeps old report values and input manifests when corrections arrive', () => {
    const db = setup(), rows = [mark(0, '500'), mark(DAY, '1000')], opening = epoch(rows[0]!), first = event();
    for (const row of rows) saveCapitalValuation(row, db);
    saveCapitalEpoch(opening, db); saveCapitalEvent(first, db);
    const old = calculateCapitalPerformance({ scope, epoch: opening, valuations: rows, events: [first], batches: [batch] });
    saveCapitalReport(old, db);
    const corrected = event({ externalFlowUsd: '400', replacesId: first.id, correctionAuthority: 'provider_revision' });
    saveCapitalEvent(corrected, db);
    const revised = calculateCapitalPerformance({ scope, epoch: opening, valuations: rows, events: listCapitalEvents(scope.id, db), batches: [batch] });
    saveCapitalReport(revised, db);
    expect(getCapitalReport(old.inputHash, db)).toEqual(old);
    expect(getCapitalReport(revised.inputHash, db)?.metrics.economicPnlUsd).toMatchObject({ state: 'available', value: '100' });
    expect(db.prepare('SELECT supersedes_id FROM capital_performance_reports_v1 WHERE id=?').get(revised.inputHash)?.['supersedes_id']).toBe(old.inputHash);
  });
  it('rolls back a partial ingestion and checkpoint in one transaction', () => {
    const db = setup();
    expect(() => inTransaction(db, () => {
      saveCapitalEvent(event(), db);
      saveCapitalBinding({ profileId: 'main', scopeId: scope.id, connectionId: null, mode: 'active', lastBatchId: batch.id }, db);
      throw new Error('injected');
    })).toThrow('injected');
    expect(listCapitalEvents(scope.id, db)).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM capital_scope_bindings_v1').get()?.['n']).toBe(0);
  });
  it('requires verified economic opening rather than a tax basis or missing mark', () => {
    const db = setup(), row = { ...mark(0, '500'), verified: false, missingComponents: ['cash_history'] };
    saveCapitalValuation(row, db);
    expect(() => saveCapitalEpoch(epoch(row), db)).toThrow('Verified economic opening');
  });
  it('allows metadata changes on reconnect without changing economic account identity', () => {
    const db = setup();
    expect(saveCapitalScope({ ...scope, originProfileId: 'another', createdAtMs: 100 }, db)).toEqual(scope);
  });
  it('keeps copied bindings archived until explicit re-verification', () => {
    const db = setup();
    saveCapitalBinding({ profileId: 'copy', scopeId: scope.id, mode: 'archived', connectionId: null, lastBatchId: null }, db);
    expect(() => saveCapitalBinding({ profileId: 'copy', scopeId: scope.id, mode: 'active', connectionId: null, lastBatchId: batch.id }, db)).toThrow('fresh verified binding');
  });
  it('retains original valuation facts on exact repeated history acquisitions', () => {
    const db = setup(), row = mark(0, '500'); saveCapitalValuation(row, db);
    expect(saveCapitalValuation({ ...row, observedAtMs: 1 }, db)).toBe(false);
    expect(listCapitalValuations(scope.id, db)).toEqual([row]);
  });
});
