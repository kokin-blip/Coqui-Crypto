import { afterEach, describe, expect, it } from 'vitest';
import { capitalHash, identifiedBudgetFact, releaseModeledReserve } from '@coqui/core';
import { openDatabase, saveCapitalScope, saveCapitalBinding, saveBudgetSource, saveNativeExecutionRules, saveReservePolicy, saveReserveState,
  saveReserveInspection, getReserveInspection, reserveHead, advanceReserveHead,
  listCashClaims, reserveCommand, saveReserveCommand, inTransaction, backupDatabase, createFileProfileDatabaseDuplicator, type Db } from '@coqui/storage';
import { commitIsolatedReservePreview, reserveSourceCutHash } from '@coqui/services';
import { reserveConsequences } from '../packages/services/src/portfolio/profit-reserve-consequences.js';
import { financial, fixture } from './helpers/profit-reserve.js';
import { BOOK, NOW, SCOPE, source, rules } from './helpers/feasibility.js';
import { mkdtempSync, rmSync } from 'node:fs';import { join } from 'node:path';import { tmpdir } from 'node:os';
const dbs:Db[]=[],folders:string[]=[];afterEach(()=>{for(const d of dbs.splice(0))d.close();for(const p of folders.splice(0))rmSync(p,{recursive:true,force:true});});
function setup(path=':memory:'){
  const db=openDatabase(path);dbs.push(db);
  saveCapitalScope({id:SCOPE,provider:'local_paper',environment:'simulation',accountIdentityHash:BOOK,originProfileId:'main',currency:'USD',createdAtMs:NOW},db);
  saveCapitalBinding({profileId:'main',scopeId:SCOPE,connectionId:null,mode:'active',lastBatchId:null},db);saveNativeExecutionRules(rules,db);saveBudgetSource(source({cashUsd:'550',equityUsd:'550'}),db);
  const f=fixture(),m=financial({sourceCutHash:reserveSourceCutHash(SCOPE,db)}),inspection=reserveConsequences(f.evaluate(m),null,null);
  saveReservePolicy(f.policy,db);saveReserveState(f.state,db);advanceReserveHead(SCOPE,f.policy.id,f.state.id,null,db);saveReserveInspection(inspection,db);
  const commit={domain:'isolated_preview' as const,profileId:'main',scopeId:SCOPE,previewId:inspection.id,operationKey:'assessment-one',expectedStateId:f.state.id,nowMs:NOW};
  return {db,f,inspection,commit};
}
describe('P3 append-only preview storage and real transactional modeled boundary',()=>{
  it('migration adds empty tables and does not enable a policy',()=>{const db=openDatabase(':memory:');dbs.push(db);expect(db.prepare('PRAGMA user_version').get()?.['user_version']).toBe(99);expect(reserveHead(SCOPE,db)).toBeNull();expect(db.prepare('SELECT COUNT(*) n FROM capital_reserve_commands_v1').get()?.['n']).toBe(0);});
  it('stores immutable versions/reports, exact retries and rejects fabricated or financial-domain state',()=>{
    const {db,f,inspection}=setup();expect(saveReservePolicy(f.policy,db)).toBe(false);expect(saveReserveInspection(inspection,db)).toBe(false);
    for(const table of ['capital_reserve_policy_versions_v1','capital_reserve_state_revisions_v1','capital_reserve_preview_reports_v1']){
      expect(()=>db.exec(`UPDATE ${table} SET content_json=content_json`)).toThrow('immutable');expect(()=>db.exec(`DELETE FROM ${table}`)).toThrow('immutable');
    }
    expect(()=>saveReserveState({...f.state,domain:'paper' as never},db)).toThrow();
    expect(()=>saveReservePolicy({...f.policy,id:capitalHash('forged')},db)).toThrow('identity');
    expect(getReserveInspection(inspection.id,db)).toEqual(inspection);
  });
  it('atomically models one assessment, retries exactly after lost acknowledgement and never writes account claims',()=>{
    const {db,f,inspection,commit}=setup();const originalSource=reserveSourceCutHash(SCOPE,db);
    const first=commitIsolatedReservePreview(commit,db);expect(first.state).toMatchObject({hUsd:'50',reservedUsd:'12.5'});
    expect(commitIsolatedReservePreview(commit,db)).toEqual(first);expect(listCashClaims(SCOPE,db)).toEqual([]);
    expect(reserveSourceCutHash(SCOPE,db)).toBe(originalSource);expect(getReserveInspection(inspection.id,db)?.report.stateId).toBe(f.state.id);
    expect(()=>commitIsolatedReservePreview({...commit,operationKey:'competing'},db)).toThrow('isolated_book');
    expect(()=>commitIsolatedReservePreview({...commit,previewId:capitalHash('different')},db)).toThrow('conflict');
  });
  it.each(['capital_reserve_state_revisions_v1','capital_reserve_assessments_v1','capital_reserve_preview_heads_v1'])('failure at %s rolls the entire modeled transition back',table=>{
    const {db,commit,f}=setup();const event=table.endsWith('heads_v1')?'UPDATE':'INSERT';
    db.exec(`CREATE TEMP TRIGGER fail_p3 AFTER ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'injected_p3_failure'); END;`);
    expect(()=>commitIsolatedReservePreview(commit,db)).toThrow('injected_p3_failure');
    expect(reserveHead(SCOPE,db)?.state_id).toBe(f.state.id);expect(db.prepare('SELECT COUNT(*) n FROM capital_reserve_assessments_v1').get()?.['n']).toBe(0);
    db.exec('DROP TRIGGER fail_p3');expect(commitIsolatedReservePreview(commit,db).state.hUsd).toBe('50');
  });
  it('late source revisions invalidate a modeled commitment and keep old evidence unchanged',()=>{
    const {db,commit,inspection}=setup();saveBudgetSource(source({cashUsd:'540',equityUsd:'540',observedAtMs:NOW+1,expiresAtMs:NOW+30_001}),db);
    expect(()=>commitIsolatedReservePreview({...commit,nowMs:NOW+1},db)).toThrow('source_stale');expect(getReserveInspection(inspection.id,db)).toEqual(inspection);
  });
  it('preserves monotone H on release and settings revisions, and stable command receipts after later writes',()=>{
    const {db,commit,f}=setup();const first=commitIsolatedReservePreview(commit,db),released=releaseModeledReserve(first.state,'12.5','release',NOW);
    inTransaction(db,()=>{saveReserveState(released,db);advanceReserveHead(SCOPE,f.policy.id,released.id,first.state.id,db);});expect(released.hUsd).toBe('50');
    expect(()=>saveReserveState(identifiedBudgetFact({...released,previousId:released.id,operationKey:'bad',hUsd:'0'}),db)).toThrow('lineage');
    saveReserveCommand(SCOPE,'receipt','request-hash',{h:'50'},db);saveReserveCommand(SCOPE,'later','another-hash',{h:'50'},db);
    expect(reserveCommand(SCOPE,'receipt','request-hash',db)).toEqual({h:'50'});expect(()=>reserveCommand(SCOPE,'receipt','changed',db)).toThrow('conflict');
  });
  it('backup/restore retains original evidence and a populated copy archives heads without resetting origins',async()=>{
    const folder=mkdtempSync(join(tmpdir(),'coqui-p3-copy-'));folders.push(folder);const {db,commit,inspection}=setup(join(folder,'main.db'));
    const result=commitIsolatedReservePreview(commit,db);backupDatabase(db,join(folder,'restore.db'));const restored=openDatabase(join(folder,'restore.db'));dbs.push(restored);
    expect(getReserveInspection(inspection.id,restored)).toEqual(inspection);expect(reserveHead(SCOPE,restored)?.state_id).toBe(result.state.id);
    const target='11111111-1111-4111-8111-111111111111',file=`wallet-${target}.db`;
    expect((await createFileProfileDatabaseDuplicator(folder).duplicate({sourceProfileId:'main',sourceDbFilename:'main.db',targetProfileId:target,targetDbFilename:file})).ok).toBe(true);
    const copy=openDatabase(join(folder,file));dbs.push(copy);expect(reserveHead(SCOPE,copy)).toMatchObject({archived:1,state_id:result.state.id});
    expect(()=>commitIsolatedReservePreview({...commit,profileId:target},copy)).toThrow('scope');expect(getReserveInspection(inspection.id,copy)).toEqual(inspection);
  });
});
