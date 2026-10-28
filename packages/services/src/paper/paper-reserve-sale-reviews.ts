import {capitalHash,type PaperReservePolicy} from '@coqui/core';
import {activePaperCapitalBinding} from '../portfolio/paper-capital-evidence.js';
import {appendPaperReserveEvent,listPaperReserveFacts,paperReserveCommand,savePaperReserveCommand,inTransaction,type Db} from '@coqui/storage';
export interface PaperReserveSaleEvidenceReview {readonly version:'paper-reserve-sale-source-review-v1';readonly scopeId:string;readonly originProfileId:string;readonly policyId:string;readonly artifactHash:string;
  readonly cashCapabilityReviewRef:string;readonly policyEvidenceReviewRef:string;readonly ownerReviewHash:string}
/** Only an explicitly reviewed owner port can append this source review. No renderer channel
 * creates one; an objective click, reconciliation note or strategy name cannot stand in for it.
 */
export function acceptPaperReserveSaleSourceReview(c:{profileId:string;artifactHash:string;now:()=>number;approve:(requestHash:string)=>string|null;operationAllowed:()=>boolean},r:{commandId:string;policyId:string;cashCapabilityReviewRef:string;policyEvidenceReviewRef:string},db:Db):PaperReserveSaleEvidenceReview{
  if(!/^[a-f0-9-]{36}$/iu.test(r.commandId)||!/^[a-f0-9]{64}$/u.test(c.artifactHash)||[r.cashCapabilityReviewRef,r.policyEvidenceReviewRef].some(ref=>!ref||ref.length>256))throw new Error('sale_source_review_required');
  return inTransaction(db,()=>{const {binding}=activePaperCapitalBinding(c.profileId,db),hash=capitalHash({profileId:c.profileId,artifactHash:c.artifactHash,request:r});
    const retry=paperReserveCommand<PaperReserveSaleEvidenceReview>(binding.scope_id,r.commandId,hash,db);if(retry)return retry;
    const approval=c.approve(hash);if(!c.operationAllowed()||binding.policy_id!==r.policyId||!/^[a-f0-9]{64}$/u.test(approval??'')||!r.cashCapabilityReviewRef||!r.policyEvidenceReviewRef)throw new Error('sale_source_review_required');
    const fact:PaperReserveSaleEvidenceReview={version:'paper-reserve-sale-source-review-v1',scopeId:binding.scope_id,originProfileId:c.profileId,policyId:r.policyId,artifactHash:c.artifactHash,cashCapabilityReviewRef:r.cashCapabilityReviewRef,policyEvidenceReviewRef:r.policyEvidenceReviewRef,ownerReviewHash:approval!};
    savePaperReserveCommand(binding.scope_id,r.commandId,hash,fact,db);appendPaperReserveEvent(binding.scope_id,{operationKey:r.commandId,kind:'sale_source_review_accepted',atMs:c.now(),refs:[r.commandId,hash]},db);return fact;
  });
}
export function readPaperReserveSaleSourceReview(profileId:string,policy:PaperReservePolicy,artifactHash:string,db:Db):PaperReserveSaleEvidenceReview|null{
  const {binding}=activePaperCapitalBinding(profileId,db);if(binding.policy_id!==policy.id||policy.originProfileId!==profileId)return null;
  const events=listPaperReserveFacts<{kind:string;refs:readonly string[]}>('event',binding.scope_id,db).filter(e=>e.kind==='sale_source_review_accepted').reverse();
  for(const e of events){if(e.refs.length!==2)throw new Error('sale_source_review_integrity');const fact=paperReserveCommand<PaperReserveSaleEvidenceReview>(binding.scope_id,e.refs[0]!,e.refs[1]!,db);
    if(fact?.version==='paper-reserve-sale-source-review-v1'&&fact.originProfileId===profileId&&fact.scopeId===binding.scope_id&&fact.policyId===policy.id&&fact.artifactHash===artifactHash&&/^[a-f0-9]{64}$/u.test(fact.ownerReviewHash)&&fact.cashCapabilityReviewRef&&fact.policyEvidenceReviewRef)return fact;
  }return null;
}
