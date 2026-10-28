import {describe,it,expect} from 'vitest';
import {capitalHash,sourceCompletionDelayMs} from '@coqui/core';
import {CHANNEL_SCHEMAS} from '@coqui/contracts';
import {createPaperReserveSaleApp,acceptPaperReserveSaleSourceReview,readPaperReserveSaleSourceReview,readPaperReserveSaleLots,assemblePaperReserveSaleInput,capturePaperCapitalEvidence} from '@coqui/services';
import {getPaperExecutionProposal,listCashClaims} from '@coqui/storage';
import {saleServiceFixture} from './helpers/paper-reserve-sale.js';
function fixture(){
  const f=saleServiceFixture(),artifact=capitalHash('synthetic-app-only'),policy=f.reserveService.view().policy!;
  const {reserveUsd,retainedFloorUsd,maxCostUsd,maxNotionalUsd,maxExposureReductionUsd,eligibleAssetIds}=f.current().objective;
  const preferences={reserveUsd,retainedFloorUsd,maxCostUsd,maxNotionalUsd,maxExposureReductionUsd,eligibleAssetIds};
  const accept=()=>acceptPaperReserveSaleSourceReview({profileId:'main',artifactHash:artifact,now:f.now,operationAllowed:()=>true,approve:()=>capitalHash('synthetic-independent-source-review')},{commandId:f.uuid(850),policyId:policy.id,cashCapabilityReviewRef:'synthetic-F-review',policyEvidenceReviewRef:'synthetic-G-review'},f.db);
  const open=()=>createPaperReserveSaleApp({profileId:'main',database:f.db,now:f.now,service:f.reserveService,authority:f.authority,current:(p,at)=>assemblePaperReserveSaleInput('main',at,p,f.current().frame,f.db),asset:()=>f.asset,evidence:p=>readPaperReserveSaleSourceReview('main',p,artifact,f.db),execution:f.execution,pending:f.pending,settle:()=>{f.execution().settlePending();},capture:()=>{capturePaperCapitalEvidence('main',f.now(),f.marks(),f.db);}});
  return {...f,open,accept,artifact,preferences};
}
describe('P6-G app integration with Main-owned evidence',()=>{
  it('reads current FIFO evidence and models without granting review or writing facts',()=>{const f=fixture();try{
    const app=f.open(),before=f.db.prepare('SELECT total_changes() n').get()!['n'];expect(readPaperReserveSaleLots('main',f.now(),f.db)).toMatchObject([{quantity:'10',basisUsd:'500'}]);
    const result=app.preview(f.preferences);expect(result.consequence?.state).toBe('modeled');expect(app.status().gateCodes).toContain('sale_source_review_required');expect(app.proposals()).toEqual([]);expect(f.db.prepare('SELECT total_changes() n').get()!['n']).toBe(before);
    expect(()=>app.prepare({commandId:f.uuid(851),consequenceId:result.consequence!.id})).toThrow('sale_source_review_required');expect(listCashClaims(f.scope,f.db)).toHaveLength(0);
  }finally{f.db.close();}});
  it('never accepts financial facts, review switches, duplicates or malformed preferences from IPC',()=>{const f=fixture();try{const schema=CHANNEL_SCHEMAS['paper.reserve.sale.preview'].request;
    expect(schema.safeParse(f.preferences).success).toBe(true);
    for(const patch of [{economicBackingUsd:'500'},{reviewed:true},{cashCapabilityReviewRef:'fake'},{reserveUsd:'NaN'},{maxCostUsd:'-1'},{eligibleAssetIds:[...f.preferences.eligibleAssetIds,...f.preferences.eligibleAssetIds]}])expect(schema.safeParse({...f.preferences,...patch}).success).toBe(false);
  }finally{f.db.close();}});
  it('requires an owner-approved source receipt tied to the exact artifact, scope and policy',()=>{const f=fixture();try{
    const policy=f.reserveService.view().policy!,r={commandId:f.uuid(852),policyId:policy.id,cashCapabilityReviewRef:'F',policyEvidenceReviewRef:'G'};
    expect(()=>acceptPaperReserveSaleSourceReview({profileId:'main',artifactHash:f.artifact,now:f.now,operationAllowed:()=>true,approve:()=>null},r,f.db)).toThrow('source_review_required');
    const fact=f.accept();expect(f.accept()).toEqual(fact);expect(f.open().status().reviewEvidence).toBe('current_reference');
    expect(readPaperReserveSaleSourceReview('main',policy,capitalHash('different-build'),f.db)).toBeNull();
    expect(readPaperReserveSaleSourceReview('main',{...policy,id:capitalHash('different-policy')},f.artifact,f.db)).toBeNull();
  }finally{f.db.close();}});
  it('prepares once, restores the proposal across restart, and still requires a separate reviewed order',()=>{const f=fixture();try{
    f.accept();const app=f.open(),p=app.preview(f.preferences).consequence!,request={commandId:f.uuid(853),consequenceId:p.id};
    const prepared=app.prepare(request);expect(getPaperExecutionProposal(prepared.proposalId,f.db)?.status).toBe('pending_review');expect(listCashClaims(f.scope,f.db)).toHaveLength(0);
    const restarted=f.open();expect(restarted.prepare(request)).toEqual(prepared);expect(restarted.proposals()).toHaveLength(1);
    const record=restarted.proposals()[0]!,preview=restarted.orderPreview({commandId:f.uuid(854),proposalId:record.proposalId});expect(preview.status).toBe('available');
    const review={commandId:f.uuid(855),proposalId:record.proposalId,proposalHash:record.proposalHash,decision:'approve' as const,previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs};
    expect(restarted.review(review).status).toBe('submitted');expect(restarted.review(review).status).toBe('submitted');
    expect(restarted.reconcile({commandId:f.uuid(856),proposalId:record.proposalId}).status).toBe('settlement_unresolved');
    f.advance(2001+sourceCompletionDelayMs('coinbase'));
    expect(restarted.reconcile({commandId:f.uuid(857),proposalId:record.proposalId})).toMatchObject({status:'reassessed',reserveFunded:false});
    expect(listCashClaims(f.scope,f.db).filter(c=>c.purpose==='profit_reserve')).toHaveLength(0);
  }finally{f.db.close();}});
  it('invalidates session drafts on disarm and changed objectives, preserving historical receipts',()=>{const f=fixture();try{
    f.accept();const app=f.open(),p=app.preview(f.preferences).consequence!;app.disarm();expect(()=>app.prepare({commandId:f.uuid(858),consequenceId:p.id})).toThrow('stale_or_unavailable');
    const q=app.preview(f.preferences).consequence!;app.preview({...f.preferences,maxCostUsd:'3'});expect(()=>app.prepare({commandId:f.uuid(859),consequenceId:q.id})).toThrow('stale_or_unavailable');
    expect(f.open().proposals()).toEqual([]);
  }finally{f.db.close();}});
  it('expires exact financial consequences and refuses a foreign proposal before execution',()=>{const f=fixture();try{
    f.accept();const app=f.open(),p=app.preview(f.preferences).consequence!;f.advance(30_000);
    expect(()=>app.prepare({commandId:f.uuid(860),consequenceId:p.id})).toThrow();
    expect(()=>app.orderPreview({commandId:f.uuid(861),proposalId:capitalHash('foreign')})).toThrow('sale_proposal_not_found');expect(listCashClaims(f.scope,f.db)).toHaveLength(0);
  }finally{f.db.close();}});
});
