import {describe,it,expect} from 'vitest';
import {sourceCompletionDelayMs} from '@coqui/core';
import {getPaperExecutionProposal,listCashClaims,paperProposalRequiresHumanReview} from '@coqui/storage';
import {saleServiceFixture as fixture} from './helpers/paper-reserve-sale.js';
describe('reviewed reserve-sale pipeline',()=>{
  it('requires an explicit objective review and prepares only one durable human-reviewed proposal',()=>{const f=fixture();try{
    const p=f.service.preview(); expect(p.state).toBe('modeled');const request={commandId:f.uuid(810),consequenceId:p.id};
    expect(()=>f.service.prepare(request)).toThrow('objective_review_required');
    expect(f.db.prepare('SELECT count(*) n FROM paper_execution_proposals_v1').get()!['n']).toBe(0);
    f.allow(p.id);const receipt=f.service.prepare(request);expect(f.service.prepare(request)).toEqual(receipt);
    expect(paperProposalRequiresHumanReview(receipt.proposalId,'main',f.db)).toBe(true);
    expect(getPaperExecutionProposal(receipt.proposalId,f.db)?.status).toBe('pending_review');
    expect(listCashClaims(f.scope,f.db)).toHaveLength(0);expect(f.reassessments()).toBe(0);
    expect(f.service.reconcile(receipt.proposalId).status).toBe('settlement_unresolved');
  }finally{f.db.close();}});
  it('refuses a purpose-bound sale through a generic execution constructor',()=>{const f=fixture();try{
    const p=f.service.preview();f.allow(p.id);const receipt=f.service.prepare({commandId:f.uuid(811),consequenceId:p.id}),proposal=getPaperExecutionProposal(receipt.proposalId,f.db)!,svc=f.execution(),preview=svc.preview(proposal.id);
    const result=svc.review({commandId:f.uuid(812),proposalId:proposal.id,proposalHash:proposal.proposalHash,decision:'approve',previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs,reviewer:'synthetic independent operator',note:'mechanics'});
    expect(result).toMatchObject({status:'blocked',reasonCode:'purpose_revalidation_required'});expect(listCashClaims(f.scope,f.db)).toHaveLength(0);
  }finally{f.db.close();}});
  it('submits through existing gates/OMS only after review; settles without prefunding a reserve',()=>{const f=fixture();try{
    const p=f.service.preview();f.allow(p.id);const receipt=f.service.prepare({commandId:f.uuid(813),consequenceId:p.id}),proposal=getPaperExecutionProposal(receipt.proposalId,f.db)!,svc=f.execution(),preview=svc.preview(proposal.id);
    const request={commandId:f.uuid(814),proposalId:proposal.id,proposalHash:proposal.proposalHash,decision:'approve' as const,previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs,reviewer:'synthetic independent operator',note:'mechanics only'};
    const result=f.service.review(request);expect(result.status).toBe('submitted');expect(f.service.review(request)).toEqual(result);
    expect(f.service.reconcile(proposal.id).status).toBe('settlement_unresolved');expect(listCashClaims(f.scope,f.db).some(x=>x.purpose==='profit_reserve')).toBe(false);
    f.advance(2001+sourceCompletionDelayMs('coinbase'));expect(f.execution().settlePending().filledCount).toBe(1);
    expect(f.service.reconcile(proposal.id)).toMatchObject({status:'reassessed',reserveFunded:false,proposal:{state:'unavailable'}});
    expect(f.reassessments()).toBe(1);expect(listCashClaims(f.scope,f.db).some(x=>x.purpose==='profit_reserve')).toBe(false);
  }finally{f.db.close();}});
  it('keeps a reviewed unchanged cut valid across read clocks, and refuses it after expiry',()=>{const f=fixture();try{
    const p=f.service.preview();f.allow(p.id);f.advance(100);
    const receipt=f.service.prepare({commandId:f.uuid(820),consequenceId:p.id}),proposal=getPaperExecutionProposal(receipt.proposalId,f.db)!,preview=f.execution().preview(proposal.id);
    f.advance(30_000);
    expect(f.service.review({commandId:f.uuid(821),proposalId:proposal.id,proposalHash:proposal.proposalHash,decision:'approve',previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs,reviewer:'synthetic operator',note:'expired'}).status).toBe('blocked');
    expect(listCashClaims(f.scope,f.db)).toHaveLength(0);
  }finally{f.db.close();}});
  it('refuses an affine scenario that understates the actual OMS rounded/reference-fee convention',()=>{const f=fixture(true);try{
    const p=f.service.preview();f.allow(p.id);
    expect(()=>f.service.prepare({commandId:f.uuid(822),consequenceId:p.id})).toThrow('execution_cost_consequence_unsupported');
    expect(f.db.prepare('SELECT count(*) n FROM paper_execution_proposals_v1').get()!['n']).toBe(0);
  }finally{f.db.close();}});
  it('rolls the intent, purpose and command back together before any order writer can run',()=>{const f=fixture();try{
    const p=f.service.preview();f.allow(p.id);const request={commandId:f.uuid(823),consequenceId:p.id};
    f.db.exec("CREATE TRIGGER inject_sale_fault BEFORE INSERT ON paper_execution_events_v1 BEGIN SELECT RAISE(ABORT,'sale_fault'); END");
    expect(()=>f.service.prepare(request)).toThrow('sale_fault');
    expect(f.db.prepare('SELECT count(*) n FROM paper_execution_proposals_v1').get()!['n']).toBe(0);
    expect(f.db.prepare('SELECT count(*) n FROM paper_execution_events_v1').get()!['n']).toBe(0);
    expect(listCashClaims(f.scope,f.db)).toHaveLength(0);
    f.db.exec('DROP TRIGGER inject_sale_fault');expect(f.service.prepare(request).consequence.id).toBe(p.id);
  }finally{f.db.close();}});
});
