import {capitalHash,budgetAmount as a,type PaperReservePolicy,type PaperReserveSaleConsequence,type PaperReserveSaleInput,type AssetRef,type PaperReserveProposal} from '@coqui/core';
import type {ChannelRequest,ChannelResponse} from '@coqui/contracts';
import {paperProposalPurpose,paperReserveCommand,savePaperReserveCommand,listPaperReserveFacts,getPaperExecutionProposal,getPaperProposalPendingContext,listSubmittedPaperExecutions,getPaperCapitalBook,paperReserveBinding,inTransaction,type Db} from '@coqui/storage';
import {activePaperCapitalBinding} from '../portfolio/paper-capital-evidence.js';
import type {PaperProfitReserveService,PaperReserveAuthorityPort} from '../portfolio/paper-profit-reserve.js';
import type {PaperReserveSalePreferences} from '../portfolio/paper-reserve-sale-evidence.js';
import {createPaperReserveSaleService,type SaleReceipt} from './paper-reserve-sale.js';
import type {PaperReserveSaleEvidenceReview} from './paper-reserve-sale-reviews.js';
import type {PaperExecutionService,ProposedPaperAction} from './execution-service.js';
export interface PaperReserveSaleAppPorts {
  readonly profileId:string;readonly database:Db;readonly now:()=>number;readonly service:PaperProfitReserveService;readonly authority:PaperReserveAuthorityPort;
  readonly current:(preferences:PaperReserveSalePreferences,atMs:number)=>PaperReserveSaleInput;readonly asset:(assetId:string)=>AssetRef;
  readonly evidence:(policy:PaperReservePolicy)=>PaperReserveSaleEvidenceReview|null;
  readonly execution:(guard:(proposalId:string)=>boolean)=>PaperExecutionService;
  readonly pending:(consequence:PaperReserveSaleConsequence,runId:string)=>NonNullable<ProposedPaperAction['pending']>;
  readonly settle:()=>void;readonly capture:()=>void;
}
/** Local app projection/commands. All financial evidence and review provenance are Main-owned. */
export function createPaperReserveSaleApp(c:PaperReserveSaleAppPorts){
  const db=c.database,drafts=new Map<string,{preferences:PaperReserveSalePreferences;service:ReturnType<typeof createPaperReserveSaleService>}>();
  let session:{hash:string;preferences:PaperReserveSalePreferences;service:ReturnType<typeof createPaperReserveSaleService>;acceptObjective:(id:string)=>void}|null=null;
  const context=()=>{activePaperCapitalBinding(c.profileId,db);return c.service.view();};
  const readReceipt=(proposalId:string):SaleReceipt=>{const v=context(),purpose=paperProposalPurpose(proposalId,c.profileId,db);
    if(purpose?.purpose!=='profit_reserve_sale')throw new Error('sale_proposal_not_found');
    const receipt=paperReserveCommand<SaleReceipt>(v.binding.scope_id,purpose.commandId,purpose.requestHash,db);
    if(!receipt||receipt.proposalId!==proposalId||receipt.consequence.scopeId!==v.binding.scope_id)throw new Error('sale_proposal_not_found');return receipt;};
  const preferencesOf=(r:SaleReceipt):PaperReserveSalePreferences=>{const o=r.input.objective;return {reserveUsd:o.reserveUsd,retainedFloorUsd:o.retainedFloorUsd,maxCostUsd:o.maxCostUsd,maxNotionalUsd:o.maxNotionalUsd,maxExposureReductionUsd:o.maxExposureReductionUsd,eligibleAssetIds:o.eligibleAssetIds};};
  const open=(preferences:PaperReserveSalePreferences)=>{
    let explicitlyReviewed:string|null=null;
    const service=createPaperReserveSaleService({profileId:c.profileId,database:db,now:c.now,authority:c.authority,model:{current:atMs=>c.current(preferences,atMs),asset:c.asset,pending:c.pending,
      reviewed:consequenceId=>{const v=context(),evidence=v.policy?c.evidence(v.policy):null;if(!evidence)return null;
        const runId=capitalHash({scopeId:v.binding.scope_id,sale:consequenceId}),proposalId=capitalHash({runId,purpose:'profit_reserve_sale'});
        const stored=getPaperExecutionProposal(proposalId,db)?readReceipt(proposalId).review:null;
        if(explicitlyReviewed!==consequenceId&&(!stored||stored.cashCapabilityReviewRef!==evidence.cashCapabilityReviewRef||stored.policyEvidenceReviewRef!==evidence.policyEvidenceReviewRef))return null;
        const input=c.current(preferences,c.now());return {consequenceId,objectiveHash:capitalHash(input.objective),cashCapabilityReviewRef:evidence.cashCapabilityReviewRef,policyEvidenceReviewRef:evidence.policyEvidenceReviewRef};}},execution:c.execution,reassess:()=>c.service.preview()});
    return {service,acceptObjective:(id:string)=>{explicitlyReviewed=id;}};
  };
  const command=<R extends {commandId:string},T>(action:string,r:R,fn:()=>T):T=>inTransaction(db,()=>{
    const v=context(),hash=capitalHash({version:'paper-reserve-sale-app-v1',profileId:c.profileId,action,request:r});
    const retry=paperReserveCommand<T>(v.binding.scope_id,r.commandId,hash,db);if(retry)return retry;
    const response=fn();savePaperReserveCommand(v.binding.scope_id,r.commandId,hash,response,db);return response;});
  const gateCodes=()=>{const v=context(),codes=[...v.financial.reasonCodes];
    if(!v.policy||!v.state)codes.push('sale_policy_missing');
    if(!v.policy||!c.evidence(v.policy))codes.push('sale_source_review_required');
    if(!v.armed||v.binding.disabled)codes.push('sale_manual_authorization_required');
    return [...new Set(codes)].sort();};
  return {
    disarm(){session=null;drafts.clear();},
    status():ChannelResponse<'paper.reserve.sale.status'>{
      try{const v=context(),assets=Object.entries(v.budget?.positions??{}).filter(([,q])=>a(q).gt(0)).map(([assetId,quantity])=>({assetId,quantity}));
        return {scopeId:v.binding.scope_id,policyId:v.policy?.id??null,stateId:v.state?.id??null,observedAtMs:v.financial.observedAtMs,expiresAtMs:v.financial.expiresAtMs,armed:v.armed,
          reviewEvidence:v.policy&&c.evidence(v.policy)?'current_reference':'pending',gateCodes:assets.length>10?[...gateCodes(),'sale_inventory_bound']:gateCodes(),assets:assets.length<=10?assets:[],liveExecutionPermitted:false,externalWithdrawalPermitted:false};
      }catch(error){if(!(error instanceof Error)||!/^paper_(?:capital|book)_/u.test(error.message))throw error;return {scopeId:null,policyId:null,stateId:null,observedAtMs:null,expiresAtMs:null,armed:false,reviewEvidence:'pending',gateCodes:['sale_book_required','sale_source_review_required'],assets:[],liveExecutionPermitted:false,externalWithdrawalPermitted:false};}
    },
    preview(preferences:PaperReserveSalePreferences):ChannelResponse<'paper.reserve.sale.preview'>{
      const preferencesHash=capitalHash(preferences);let gates:readonly string[]=[];
      try{gates=gateCodes();if(!session||session.hash!==preferencesHash){const opened=open(preferences);session={hash:preferencesHash,preferences,...opened};}
        const consequence=session.service.preview();if(drafts.size>=20)drafts.delete(drafts.keys().next().value!);drafts.set(consequence.id,{preferences,service:session.service});
        return {preferencesHash,consequence,reasonCodes:[],gateCodes:gates};
      }catch(error){if(!(error instanceof Error)||!/^(?:sale_|paper_(?:capital|reserve|book)_)[a-z_]+$/u.test(error.message))throw error;
        return {preferencesHash,consequence:null,reasonCodes:[error.message],gateCodes:gates};}
    },
    proposals():ChannelResponse<'paper.reserve.sale.proposals'>{
      if(!getPaperCapitalBook(c.profileId,db)&&!paperReserveBinding(c.profileId,db))return [];
      const v=context();return listPaperReserveFacts<{kind:string;refs:readonly string[];atMs:number}>('event',v.binding.scope_id,db).filter(e=>e.kind==='sale_prepared_no_reserve_funding').slice(-20).reverse().map(e=>{
        const r=readReceipt(e.refs[0]!),proposal=getPaperExecutionProposal(r.proposalId,db);if(!proposal||proposal.profileId!==c.profileId)throw new Error('sale_proposal_not_found');
        return {proposalId:r.proposalId,proposalHash:proposal.proposalHash,requiredExecutionBarStartMs:getPaperProposalPendingContext(r.proposalId,db)?.requiredExecutionBarStartMs??null,policyId:r.consequence.policyId,preparedAtMs:e.atMs,status:proposal.status,consequence:r.consequence};});
    },
    prepare(r:ChannelRequest<'paper.reserve.sale.prepare'>):ChannelResponse<'paper.reserve.sale.prepare'>{
      const v=context(),hash=capitalHash({profileId:c.profileId,purpose:'profit_reserve_sale',request:r}),prior=paperReserveCommand<SaleReceipt>(v.binding.scope_id,r.commandId,hash,db);
      if(prior)return {proposalId:prior.proposalId,consequenceId:prior.consequence.id,reserveFunded:false};
      if(!v.policy||!c.evidence(v.policy))throw new Error('sale_source_review_required');
      const draft=drafts.get(r.consequenceId);if(!draft||!session||session.hash!==capitalHash(draft.preferences)||session.service!==draft.service)throw new Error('sale_consequence_stale_or_unavailable');
      // The click reviews this exact objective; the independent source/evidence gate was read above.
      session.acceptObjective(r.consequenceId);
      const prepared=draft.service.prepare(r);return {proposalId:prepared.proposalId,consequenceId:prepared.consequence.id,reserveFunded:false};
    },
    orderPreview(r:ChannelRequest<'paper.reserve.sale.order.preview'>){return command('order.preview',r,()=>open(preferencesOf(readReceipt(r.proposalId))).service.orderPreview(r.proposalId));},
    review(r:ChannelRequest<'paper.reserve.sale.order.review'>){return command('order.review',r,()=>open(preferencesOf(readReceipt(r.proposalId))).service.review({...r,reviewer:'local operator',note:'Explicit reserve-sale order review; no reserve prefunding'}));},
    reconcile(r:ChannelRequest<'paper.reserve.sale.reconcile'>):ChannelResponse<'paper.reserve.sale.reconcile'>{return command('reconcile',r,()=>{
      const receipt=readReceipt(r.proposalId),pending=getPaperProposalPendingContext(r.proposalId,db),submitted=listSubmittedPaperExecutions(c.profileId,db);
      if(submitted.some(p=>p.decisionId!==pending?.decisionId))throw new Error('sale_other_order_settlement_pending');
      if(submitted.length)c.settle();
      if(listSubmittedPaperExecutions(c.profileId,db).length)return {status:'settlement_unresolved' as const,proposal:null,reserveFunded:false as const};
      if(getPaperExecutionProposal(r.proposalId,db)?.status!=='unknown')c.capture();
      const result=open(preferencesOf(receipt)).service.reconcile(r.proposalId);
      return {status:result.status,proposal:'proposal' in result?result.proposal as PaperReserveProposal:null,reserveFunded:false as const};
    });},
  };
}
