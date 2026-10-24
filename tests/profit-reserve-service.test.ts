import { afterEach, describe, expect, it } from 'vitest';
import { capitalHash, cashClaim, reserveValue } from '@coqui/core';
import { CHANNEL_KINDS } from '@coqui/contracts';
import { openDatabase, initializePaperBook, listCashClaims, saveCashClaim, type Db } from '@coqui/storage';
import { ingestLocalPaperCapital, capitalScopesView, reserveView, inspectReserve, previewReserve, saveReserveSettings, createProfileOperationGate } from '@coqui/services';
import { createProfitReserveHandlers } from '../apps/desktop/src/main/profit-reserve-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { NOW, ASSET } from './helpers/feasibility.js';import { settings } from './helpers/profit-reserve.js';
const dbs:Db[]=[];afterEach(()=>{for(const db of dbs.splice(0))db.close();});
const uuid=(n=1)=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
function setup(){const db=openDatabase(':memory:');dbs.push(db);initializePaperBook({schemaVersion:1,profileId:'main',source:'tracked_holdings_opening',cashUsd:'0',asOfMs:NOW,balances:[{assetId:ASSET,quantity:'1',priceUsd:'100',valueUsd:'100'}]},db);ingestLocalPaperCapital('main',db,NOW);const scopeId=capitalScopesView('main',db).scopes[0]!.scope.id;
  const view=()=>reserveView('main',scopeId,NOW,db);const request=()=>({scopeId,commandId:uuid(),expectedPolicyId:view().policy?.id??null,expectedStateId:view().state?.id??null,expectedInputHash:view().financial.sourceCutHash!,settings:settings()});return {db,scopeId,view,request};}
const financialRows=(db:Db)=>['paper_orders_v3','paper_fills_v3','paper_ledger_entries_v3','capital_cash_claim_revisions_v1','research_preregistrations'].map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
describe('P3 actual local services, command durability and zero financial side effects',()=>{
  it('reuses original epoch and budget without inventing opening basis; view/preview are pure reads',()=>{
    const f=setup(),before=f.db.prepare('SELECT total_changes() n').get()?.['n'];const v=f.view();
    expect(v.financial.economicPnlUsd).toMatchObject({state:'available',value:'0'});expect(v.financial.unrealizedPnlUsd.state).toBe('unavailable');expect(v.financial.openingEquityUsd).toMatchObject({value:'100'});
    const p=previewReserve('main',{mode:'observed',scopeId:f.scopeId,settings:settings()},NOW,f.db);expect(p.report.state).toBe('unavailable');expect(f.db.prepare('SELECT total_changes() n').get()?.['n']).toBe(before);
  });
  it('save/inspect persist preview evidence only; exact retries return the original response after later commands',()=>{
    const f=setup(),before=financialRows(f.db),request=f.request(),saved=saveReserveSettings('main',request,NOW,f.db);
    expect(saved.state?.hUsd).toBe('0');expect(saved.policy?.settings.goal).toBe('preview');
    const inspect={commandId:uuid(2),scopeId:f.scopeId,expectedPolicyId:saved.policy!.id,expectedStateId:saved.state!.id,expectedInputHash:saved.financial.sourceCutHash!};
    const report=inspectReserve('main',inspect,NOW,f.db);expect(report.report.executionEligible).toBe(false);expect(report.report.liveExecutionPermitted).toBe(false);
    expect(inspectReserve('main',inspect,NOW+1,f.db)).toEqual(report);expect(saveReserveSettings('main',request,NOW+2,f.db)).toEqual(saved);
    expect(()=>saveReserveSettings('main',{...request,settings:settings({shareBps:5000})},NOW,f.db)).toThrow('conflict');
    expect(financialRows(f.db)).toEqual(before);expect(f.view().state?.hUsd).toBe('0');expect(f.view().state?.reservedUsd).toBe('0');
  });
  it('blocks competing revisions, new cash commitments and wrong-profile access without changing old reports',()=>{
    const f=setup(),request=f.request(),saved=saveReserveSettings('main',request,NOW,f.db);
    expect(()=>saveReserveSettings('main',{...request,commandId:uuid(3)},NOW,f.db)).toThrow('revision_stale');
    saveCashClaim(cashClaim({scopeId:f.scopeId,originKey:'external-order',replacesId:null,assetId:'USD',amount:'1',purpose:'order',state:'unknown',reflectedIn:[],reflectionEvidence:[],evidenceRefs:['real-pending']}),f.db);
    expect(()=>inspectReserve('main',{scopeId:f.scopeId,commandId:uuid(4),expectedPolicyId:saved.policy!.id,expectedStateId:saved.state!.id,expectedInputHash:saved.financial.sourceCutHash!},NOW,f.db)).toThrow('source_stale');
    expect(()=>reserveView('another-profile',f.scopeId,NOW,f.db)).toThrow('scope');expect(listCashClaims(f.scopeId,f.db)).toHaveLength(1);
  });
  it('public IPC rejects authority/mode injection, respects the profile gate, and accepts all declared routes',async()=>{
    const f=setup(),gate=createProfileOperationGate(),dispatch=createDispatcher({handlers:createProfitReserveHandlers('main',f.db,()=>NOW,gate)}),before=financialRows(f.db);
    expect((await dispatch('capital.reserve.view',{scopeId:f.scopeId})).status).toBe('ok');
    expect((await dispatch('capital.reserve.preview',{mode:'observed',scopeId:f.scopeId,economicPnlUsd:reserveValue('100000')})).status).toBe('failed');
    expect((await dispatch('capital.reserve.preview',{mode:'paper',scopeId:f.scopeId})).status).toBe('failed');
    gate.begin();expect((await dispatch('capital.reserve.settings.save',f.request())).status).not.toBe('ok');gate.end();
    const saved=await dispatch('capital.reserve.settings.save',f.request());expect(saved.status).toBe('ok');
    const v=f.view();expect((await dispatch('capital.reserve.inspect',{scopeId:f.scopeId,commandId:uuid(8),expectedPolicyId:v.policy!.id,expectedStateId:v.state!.id,expectedInputHash:v.financial.sourceCutHash!})).status).toBe('ok');
    expect(CHANNEL_KINDS.write).toContain('capital.reserve.inspect');expect(CHANNEL_KINDS.read).toContain('capital.reserve.preview');
    expect(financialRows(f.db)).toEqual(before);expect((await dispatch('capital.reserve.view',{scopeId:capitalHash('foreign')})).status).not.toBe('ok');
  });
  it.each(['50','100','250','500','1000','2500','5000','10000','100000'])('evaluates its own independent $%s scenario with unchanged policy',openingUsd=>{
    const f=setup(),A=BigInt(openingUsd)+50n,r=previewReserve('main',{mode:'scenario',openingUsd,profitUsd:'50',realizedProfitUsd:'50',cashUsd:A.toString(),externalExpenseUsd:'1',settings:settings()},NOW,f.db);
    expect(r.report.assurance).toBe('scenario');expect(r.report.reserveUsd).toMatchObject({value:'12.5'});expect(r.report.assessedProfitUsd).toMatchObject({value:'50'});expect(r.report.financial.openingEquityUsd).toMatchObject({value:openingUsd});
    expect(r.comparison[0]).toMatchObject({marketMoveBps:-2000});expect(r.comparisonAssumptions.join(' ')).toContain('zero reserve yield');
  });
  it('shows a cost-bearing hypothetical sale without using its proceeds for eligibility',()=>{
    const f=setup(),r=previewReserve('main',{mode:'scenario',openingUsd:'500',profitUsd:'50',realizedProfitUsd:'0',cashUsd:'0',externalExpenseUsd:'0',settings:settings()},NOW,f.db);
    expect(r.sale.status).toBe('hypothetical');expect(r.sale.fundsEligibility).toBe(false);expect(r.sale.modeledCostUsd.state).toBe('available');
    expect(r.report.state).not.toBe('eligible');expect(r.report.caps.realizedUsd).toMatchObject({value:'0'});
    expect(financialRows(f.db)[0]).toEqual([]);
  });
});
