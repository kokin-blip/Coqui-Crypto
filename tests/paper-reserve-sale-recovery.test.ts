import {describe,it,expect} from 'vitest';
import {budgetClaimHeads,sourceCompletionDelayMs} from '@coqui/core';
import {capturePaperCapitalEvidence,readPaperCapitalEvidence} from '@coqui/services';
import {activateWalletSafetyStop,getPaperExecutionProposal,listCashClaims,listSubmittedPaperExecutions,settlePaperPendingExecution,updatePaperExecutionProposalStatus} from '@coqui/storage';
import {saleServiceFixture} from './helpers/paper-reserve-sale.js';
function prepared(){const f=saleServiceFixture(),p=f.service.preview();f.allow(p.id);const r=f.service.prepare({commandId:f.uuid(1100),consequenceId:p.id}),proposal=getPaperExecutionProposal(r.proposalId,f.db)!,preview=f.service.orderPreview(proposal.id);
 const review={commandId:f.uuid(1101),proposalId:proposal.id,proposalHash:proposal.proposalHash,decision:'approve' as const,previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs,reviewer:'synthetic recovery operator',note:'mechanics only'};return {...f,proposal,review};}
const heads=(f:ReturnType<typeof prepared>)=>budgetClaimHeads(listCashClaims(f.scope,f.db)).heads;
describe('P6-G conservative recovery without reserve prefunding',()=>{
 it.each(['partially_filled','cancel_pending','unknown'])('retains quantity claims for %s even if a pending index is terminal',state=>{const f=prepared();try{
  expect(f.service.review(f.review).status).toBe('submitted');const pending=listSubmittedPaperExecutions('main',f.db)[0]!,before=heads(f);
  // Inject an inconsistent recovery cut: an index marker alone is not terminal order/fill proof.
  settlePaperPendingExecution(pending.id,'expired',f.now(),f.db);f.db.prepare('UPDATE paper_orders_v3 SET state=? WHERE id=?').run(state,pending.orderId);
  expect(f.service.reconcile(f.proposal.id)).toEqual({status:'settlement_unresolved',reserveFunded:false});expect(heads(f)).toEqual(before);expect(f.reassessments()).toBe(0);
  expect(()=>f.port.releaseTerminal(pending.orderId)).toThrow('budget_order_not_terminal');expect(heads(f).some(c=>c.purpose==='profit_reserve')).toBe(false);
 }finally{f.db.close();}});
 it('an unknown proposal remains unresolved even after supported fill settlement',()=>{const f=prepared();try{
  expect(f.service.review(f.review).status).toBe('submitted');f.advance(2001+sourceCompletionDelayMs('coinbase'));expect(f.execution().settlePending().filledCount).toBe(1);
  updatePaperExecutionProposalStatus(f.proposal.id,'unknown',f.now(),f.db);expect(f.service.reconcile(f.proposal.id).status).toBe('settlement_unresolved');expect(f.reassessments()).toBe(0);expect(heads(f).some(c=>c.purpose==='profit_reserve')).toBe(false);
 }finally{f.db.close();}});
 it.each(['cancelled','expired'])('releases only a supported %s quantity claim and requires new reserve review',state=>{const f=prepared();try{
  expect(f.service.review(f.review).status).toBe('submitted');const pending=listSubmittedPaperExecutions('main',f.db)[0]!;
  settlePaperPendingExecution(pending.id,'expired',f.now(),f.db);f.db.prepare('UPDATE paper_orders_v3 SET state=? WHERE id=?').run(state,pending.orderId);f.port.releaseTerminal(pending.orderId);
  expect(heads(f).filter(c=>c.purpose==='order').map(c=>c.state)).toEqual(['released']);expect(f.service.reconcile(f.proposal.id)).toMatchObject({status:'reassessed',reserveFunded:false,proposal:{state:'unavailable'}});
  expect(f.db.prepare("SELECT quantity_text FROM paper_balances_v3 WHERE asset_id='USD'").get()!['quantity_text']).toBe('0');expect(heads(f).some(c=>c.purpose==='profit_reserve')).toBe(false);
 }finally{f.db.close();}});
 it.each(['manual_stop','lost_fence','restart'])('rechecks %s after preparation without creating an order or reserve',kind=>{const f=prepared();try{
  if(kind==='manual_stop')activateWalletSafetyStop({eventId:f.uuid(1102),profileId:'main',kind:'manual',reason:'synthetic stop',at:f.now(),runId:null},f.db);
  else if(kind==='lost_fence')f.db.prepare('UPDATE execution_leases_v1 SET fencing_token=fencing_token+1').run();else f.authority.disarm();
  expect(()=>f.service.review(f.review)).toThrow();expect(f.db.prepare("SELECT count(*) n FROM paper_orders_v3 WHERE side='sell'").get()!['n']).toBe(0);expect(heads(f)).toEqual([]);expect(f.reserveService.view().state?.hUsd).toBe('0');
 }finally{f.db.close();}});
 it('keeps late inconsistent fee evidence unavailable after a real simulator fill',()=>{const f=prepared();try{
  expect(f.service.review(f.review).status).toBe('submitted');f.advance(2001+sourceCompletionDelayMs('coinbase'));expect(f.execution().settlePending().filledCount).toBe(1);capturePaperCapitalEvidence('main',f.now(),f.marks(),f.db);
  expect(readPaperCapitalEvidence('main',f.now(),f.db).financial.feesUsd.state).toBe('available');
  // Fault injection models an incomplete fee posting; it is not an approved financial correction.
  f.db.prepare("UPDATE paper_fills_v3 SET venue_fee_text='99' WHERE order_id IN (SELECT id FROM paper_orders_v3 WHERE side='sell')").run();f.advance(1);capturePaperCapitalEvidence('main',f.now(),f.marks(),f.db);
  const financial=readPaperCapitalEvidence('main',f.now(),f.db).financial;expect(financial.reasonCodes).toContain('paper_fill_legs_unreconciled');expect(financial.realizedPnlUsd.state).toBe('unavailable');expect(heads(f).some(c=>c.purpose==='profit_reserve')).toBe(false);
 }finally{f.db.close();}});
});
