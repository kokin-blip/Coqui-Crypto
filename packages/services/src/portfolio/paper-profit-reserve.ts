import { paperActiveSleevePerformance } from './paper-active-sleeve.js';
import { budgetAmount as a, budgetText as t, budgetClaimHeads, cashClaim, capitalHash, identifiedBudgetFact, paperReservePolicy,
  paperReserveBaseline, evaluatePaperReserve, applyPaperReserve, releasePaperReserve, reserveCapitalWitness, reserveHypotheticalFrame,
  evaluateCapitalFeasibility, type ReserveSettings, type PaperReservePolicy, type PaperReserveState, type PaperReserveProposal, type PaperReserveAuthorityProof, type CashClaimV1 } from '@coqui/core';
import { getAuthoritativeHost, readPaperReserveFact, savePaperReservePolicy, savePaperReserveState, savePaperReserveRequirements, savePaperReserveProposal,
  savePaperReserveAssessment, appendPaperReserveEvent, listPaperReserveFacts, paperReserveCommand, savePaperReserveCommand, advancePaperReserveBinding,
  appendReviewedPaperReserveClaims, listCashClaims, currentBudget, inTransaction, type PaperReserveRequirements, type Db } from '@coqui/storage';
import { activePaperCapitalBinding, readPaperCapitalEvidence, capturePaperCapitalEvidence } from './paper-capital-evidence.js';
export interface PaperReserveAuthorityPort { disarm():void; arm(policyId:string,generation:number):PaperReserveAuthorityProof; check(policyId:string,generation:number):PaperReserveAuthorityProof; advance(policyId:string,generation:number):void; readonly armed:boolean }
/** Main-owned strategy factory. No renderer financial, rule, quote or witness inputs are accepted. */
export interface PaperReserveModel {
  requirements(settings?:ReserveSettings): Omit<PaperReserveRequirements,'id'|'scopeId'>;
  marks(): Readonly<Record<string,{priceUsd:string;atMs:number;ref:string}>>;
  strategy(settings?:ReserveSettings): PaperReservePolicy['strategy'];
}
export interface PaperReserveExpected { readonly bookId:string; readonly scopeId:string; readonly generation:number; readonly policyId:string|null; readonly stateId:string|null; readonly budgetRevision:string; readonly authorityHash:string }
export interface PaperReserveCommandInput extends PaperReserveExpected { readonly commandId:string }
type CommandReceipt<T> = {readonly status:'accepted';readonly value:T}|{readonly status:'refused';readonly code:string};
// Only owned guard refusals are receipts. Storage/integrity/unknown failures roll back and remain errors.
const commandRefusals=new Set(['paper_reserve_revision_stale','paper_reserve_policy_missing','paper_reserve_policy_disabled',
  'paper_reserve_requirements_changed','paper_reserve_use_manual_resume','paper_reserve_operating_requirement_unavailable',
  'paper_reserve_reconciliation_required','paper_reserve_manual_resume_required','paper_reserve_proposal_stale',
  'paper_reserve_post_budget_infeasible','paper_reserve_release_lineage_missing','paper_reserve_baseline_unavailable',
  'paper_reserve_proposal_invalid','paper_reserve_release_invalid','paper_reserve_host_or_lease_unavailable',
  'paper_reserve_stopped_or_paused','paper_reserve_risk_exposure_reconciliation_required','paper_reserve_qualification_missing',
  'paper_reserve_competing_writer']);
export function createPaperProfitReserveService(profileId:string,db:Db,now:()=>number,authority:PaperReserveAuthorityPort,model:PaperReserveModel) {
  const drafts=new Map<string,{proposal:PaperReserveProposal;requirements:PaperReserveRequirements}>();
  const configuration=(r:PaperReserveRequirements)=>capitalHash({strategyHash:r.strategyHash,objective:r.objective,assetIds:r.frame.assets.map(a=>a.assetId).sort()});
  const proofInputs=(r:PaperReserveRequirements)=>capitalHash({assets:r.frame.assets,intents:r.frame.intents,fees:r.frame.fees,policy:r.frame.policy});
  const context=()=>{
    const {book,binding}=activePaperCapitalBinding(profileId,db);
    const policy=binding.policy_id?readPaperReserveFact<PaperReservePolicy>('policy',binding.policy_id,db):null;
    const state=binding.state_id?readPaperReserveFact<PaperReserveState>('state',binding.state_id,db):null;
    return {book,binding,policy,state};
  };
  const authorityHash=()=>{const h=getAuthoritativeHost(profileId,db);return capitalHash({profileId,host:h?{hostId:h.hostId,generation:h.fencingGeneration,status:h.status,reconciliationId:h.reconciliationId}:null});};
  const check=(e:PaperReserveExpected)=>{
    const c=context(),budget=currentBudget(c.binding.scope_id,now(),db);
    if(e.authorityHash!==authorityHash() || e.bookId!==c.book.id || e.scopeId!==c.binding.scope_id || e.generation!==c.binding.generation || e.policyId!==c.binding.policy_id || e.stateId!==c.binding.state_id || e.budgetRevision!==budget?.revision)throw new Error('paper_reserve_revision_stale');
    return c;
  };
  const command=<T>(channel:string,r:PaperReserveCommandInput,fn:()=>T):T=>{
    const hash=capitalHash({profileId,channel,request:r});
    const accessible=()=>{const c=context();if(c.book.id!==r.bookId || c.binding.scope_id!==r.scopeId)throw new Error('paper_reserve_revision_stale');};
    let receipt:CommandReceipt<T>;
    try {receipt=inTransaction(db,()=>{
      accessible();const retry=paperReserveCommand<CommandReceipt<T>>(r.scopeId,r.commandId,hash,db);if(retry!==null)return retry;
      check(r);const response:CommandReceipt<T>={status:'accepted',value:fn()};savePaperReserveCommand(r.scopeId,r.commandId,hash,response,db);return response;
    });}catch(error){
      if(error instanceof Error && commandRefusals.has(error.message)) {
        // The financial transaction has rolled back. Persist the refusal separately, never partial funding.
        inTransaction(db,()=>{accessible();if(paperReserveCommand(r.scopeId,r.commandId,hash,db)!==null)return;
          savePaperReserveCommand(r.scopeId,r.commandId,hash,{status:'refused',code:error.message},db);
          appendPaperReserveEvent(r.scopeId,{operationKey:r.commandId,kind:'command_refused',atMs:now(),refs:[channel,error.message]},db);
        });
      }
      throw error;
    }
    if(receipt.status==='refused')throw new Error(receipt.code);return receipt.value;
  };
  const requirements=(scopeId:string,settings?:ReserveSettings)=>{
    const raw=model.requirements(settings),value=identifiedBudgetFact({...raw,scopeId});
    if(raw.strategyHash!==capitalHash(model.strategy(settings)) || raw.frame.budget.scopeId!==scopeId)throw new Error('paper_reserve_requirements_identity');
    return value;
  };
  const preview=():PaperReserveProposal=>{
    const c=context();if(!c.policy || !c.state)throw new Error('paper_reserve_policy_missing');
    const req=requirements(c.binding.scope_id),f=readPaperCapitalEvidence(profileId,now(),db).financial;
    const floor=reserveCapitalWitness(req.frame,req.objective);
    const original=readPaperReserveFact<PaperReserveRequirements>('requirements',c.policy.requirementsId,db);
    if(!original || configuration(original)!==configuration(req))throw new Error('paper_reserve_requirements_changed');
    const proposal=evaluatePaperReserve(c.policy,c.state,f,floor,now());
    if(drafts.size>=100)drafts.delete(drafts.keys().next().value!);drafts.set(proposal.id,{proposal,requirements:req});return proposal;
  };
  const reviewed=(id:string)=>{
    const draft=drafts.get(id),c=context();if(!draft || !c.policy || !c.state || now()>=draft.proposal.expiresAtMs)throw new Error('paper_reserve_proposal_stale');
    const req=requirements(c.binding.scope_id),f=readPaperCapitalEvidence(profileId,now(),db).financial,p=draft.proposal;
    if(proofInputs(req)!==proofInputs(draft.requirements) || capitalHash(f)!==capitalHash(p.financial) || evaluatePaperReserve(c.policy,c.state,f,p.operatingRequirement,p.evaluatedAtMs).id!==p.id)throw new Error('paper_reserve_proposal_stale');
    return draft;
  };
  const view=()=>{const c=context(),financial=readPaperCapitalEvidence(profileId,now(),db).financial;return {...c,armed:authority.armed,authorityHash:authorityHash(),financial,activeSleeve:paperActiveSleevePerformance(c.book,c.binding.scope_id,c.binding.state_id,financial,db),budget:currentBudget(c.binding.scope_id,now(),db),
    optionalSale:'pending_review' as const,connected:'pending_ownership_and_evidence' as const,liveExecutionPermitted:false as const,externalWithdrawalPermitted:false as const};};
  const pause=()=>{authority.disarm();const c=context();advancePaperReserveBinding(profileId,c.binding.generation,{policy:c.policy,state:c.state,disabled:true},db);return view();};
  return {
    view,preview,
    observe(r:PaperReserveCommandInput){return command('observe',r,()=>{const capture=capturePaperCapitalEvidence(profileId,now(),model.marks(),db);if(capture.financial.reasonCodes.length)authority.disarm();appendPaperReserveEvent(r.scopeId,{operationKey:r.commandId,kind:'manual_observation_only',atMs:now(),refs:[capture.source.id,...capture.financial.reasonCodes]},db);return view();});},
    operations(){const c=context();return listPaperReserveFacts('event',c.binding.scope_id,db).slice(-100);},
    savePolicy(r:PaperReserveCommandInput & {readonly settings:ReserveSettings}) {
      authority.disarm();return command('policy.save',r,()=>{
        const c=context();capturePaperCapitalEvidence(profileId,now(),model.marks(),db);
        const req=requirements(c.binding.scope_id,r.settings),policy=paperReservePolicy({scopeId:c.binding.scope_id,originProfileId:profileId,previousId:c.policy?.id??null,createdAtMs:now(),settings:r.settings,strategy:model.strategy(r.settings),requirementsId:req.id});
        const f=readPaperCapitalEvidence(profileId,now(),db).financial;
        // Policy save alone cannot reset H or invent a new stream. Baseline is recorded on explicit authorization.
        savePaperReserveRequirements(req,db);savePaperReservePolicy(policy,db);
        const state=paperReserveBaseline(policy,c.state,f,`settings:${r.commandId}`,now());savePaperReserveState(state,db);
        advancePaperReserveBinding(profileId,c.binding.generation,{policy,state,disabled:true},db);
        appendPaperReserveEvent(c.binding.scope_id,{operationKey:r.commandId,kind:'policy_saved_disarmed',atMs:now(),refs:[policy.id,state.id,req.id]},db);
        return view();
      });
    },
    authorize(r:PaperReserveCommandInput) {
      try{return command('authorize',r,()=>{
        const c=context();if(!c.policy || !c.state)throw new Error('paper_reserve_policy_missing');
        if(c.policy.settings.goal==='keep_invested' || c.policy.settings.shareBps===0)throw new Error('paper_reserve_policy_disabled');
        const req=requirements(c.binding.scope_id),original=readPaperReserveFact<PaperReserveRequirements>('requirements',c.policy.requirementsId,db);if(!original || configuration(original)!==configuration(req))throw new Error('paper_reserve_requirements_changed');
        if(listPaperReserveFacts<{kind:string;refs:string[]}>('event',c.binding.scope_id,db).some(e=>e.kind==='manual_authorization' && e.refs.includes(c.policy!.id)))throw new Error('paper_reserve_use_manual_resume');
        authority.arm(c.policy.id,c.binding.generation);
        if(reserveCapitalWitness(req.frame,req.objective).floorUsd.state!=='available')throw new Error('paper_reserve_operating_requirement_unavailable');
        const state=paperReserveBaseline(c.policy,c.state,readPaperCapitalEvidence(profileId,now(),db).financial,`authorize:${r.commandId}`,now());
        savePaperReserveState(state,db);advancePaperReserveBinding(profileId,c.binding.generation,{policy:c.policy,state,disabled:false},db);
        appendPaperReserveEvent(c.binding.scope_id,{operationKey:r.commandId,kind:'manual_authorization',atMs:now(),refs:[c.policy.id,state.id]},db);
        authority.advance(c.policy.id,c.binding.generation+1);return view();
      });}catch(error){authority.disarm();throw error;}
    },
    pause(r:PaperReserveCommandInput){return command('pause',r,()=>{const result=pause();appendPaperReserveEvent(r.scopeId,{operationKey:r.commandId,kind:'manual_pause',atMs:now(),refs:[]},db);return result;});},
    resume(r:PaperReserveCommandInput) {
      try{return command('resume',r,()=>{
        const c=context();if(!c.policy || !c.state)throw new Error('paper_reserve_policy_missing');
        capturePaperCapitalEvidence(profileId,now(),model.marks(),db);
        const f=readPaperCapitalEvidence(profileId,now(),db).financial;
        if(f.reasonCodes.length || f.actualPendingUsd.state!=='available' || c.policy.settings.goal==='keep_invested' || c.policy.settings.shareBps===0)throw new Error('paper_reserve_reconciliation_required');
        if(a(f.actualPendingUsd.value).isZero() && reserveCapitalWitness(requirements(c.binding.scope_id).frame,model.requirements().objective).floorUsd.state!=='available')throw new Error('paper_reserve_operating_requirement_unavailable');
        authority.arm(c.policy.id,c.binding.generation);
        advancePaperReserveBinding(profileId,c.binding.generation,{policy:c.policy,state:c.state,disabled:false},db);
        appendPaperReserveEvent(r.scopeId,{operationKey:r.commandId,kind:'manual_resume',atMs:now(),refs:[f.sourceCutHash!,a(f.actualPendingUsd.value).gt(0)?'pending_settlement_before_new_allocations':'current_operating_witness']},db);authority.advance(c.policy.id,c.binding.generation+1);return view();
      });}catch(error){authority.disarm();throw error;}
    },
    review(r:PaperReserveCommandInput & {readonly proposalId:string}) {
      try{return command('review',r,()=>{
        const c=context();if(!c.policy || !c.state || c.binding.disabled)throw new Error('paper_reserve_manual_resume_required');
        const proof=authority.check(c.policy.id,c.binding.generation),draft=reviewed(r.proposalId),p=draft.proposal;
        const next=applyPaperReserve(c.policy,c.state,p,r.commandId,now());
        const req=draft.requirements,reserve=p.reserveUsd.state==='available'?p.reserveUsd.value:'0';
        const post=evaluateCapitalFeasibility({...reserveHypotheticalFrame(req.frame,t(a(reserve).add(p.additionalTaxUsd))),nowMs:now()});
        if(post.state!=='feasible')throw new Error('paper_reserve_post_budget_infeasible');
        const claims:CashClaimV1[]=[cashClaim({scopeId:r.scopeId,originKey:`paper-reserve:${r.commandId}`,replacesId:null,assetId:'USD',amount:reserve,purpose:'profit_reserve',state:'committed',reflectedIn:[],reflectionEvidence:[],evidenceRefs:[p.id,next.id,proof.hash]})];
        if(a(p.additionalTaxUsd).gt(0))claims.push(cashClaim({...claims[0]!,originKey:`paper-tax:${r.commandId}`,amount:p.additionalTaxUsd,purpose:'tax_hold'}));
        savePaperReserveProposal(p,db);savePaperReserveState(next,db);
        const assessment=identifiedBudgetFact({scopeId:r.scopeId,streamId:next.streamId,operationKey:r.commandId,proposalId:p.id,beforeId:c.state.id,afterId:next.id,claimIds:claims.map(x=>x.id),authorityHash:proof.hash,authorityProof:proof});savePaperReserveAssessment(assessment,db);
        appendReviewedPaperReserveClaims({profileId,scopeId:r.scopeId,expectedRevision:r.budgetRevision,beforeStateId:c.state.id,assessmentId:assessment.id,nowMs:now(),claims,revalidateAuthority:()=>{authority.check(c.policy!.id,c.binding.generation);}},db);
        advancePaperReserveBinding(profileId,c.binding.generation,{policy:c.policy,state:next,disabled:false},db);
        appendPaperReserveEvent(r.scopeId,{operationKey:r.commandId,kind:'reserve_review_committed',atMs:now(),refs:[p.id,assessment.id,proof.hash,...claims.map(x=>x.id)]},db);
        authority.advance(c.policy.id,c.binding.generation+1);return view();
      });}catch(error){authority.disarm();throw error;}
    },
    release(r:PaperReserveCommandInput & {readonly purpose:'profit_reserve'|'tax_hold';readonly amountUsd:string;readonly proposalId:string}) {
      try{return command('release',r,()=>{
        const c=context();if(!c.policy || !c.state || c.binding.disabled)throw new Error('paper_reserve_manual_resume_required');
        const proof=authority.check(c.policy.id,c.binding.generation),p=reviewed(r.proposalId).proposal;if(p.state==='unavailable')throw new Error('paper_reserve_proposal_stale');
        const next=releasePaperReserve(c.state,r.purpose,r.amountUsd,r.commandId,now());let remaining=a(r.amountUsd);
        const heads=budgetClaimHeads(listCashClaims(r.scopeId,db)).heads,claims:CashClaimV1[]=[];
        for(const head of heads.filter(x=>x.purpose===r.purpose && x.state==='committed')) {
          if(!remaining.gt(0))break;const take=remaining.lt(head.amount)?remaining:a(head.amount);remaining=remaining.sub(take);
          claims.push(cashClaim({...head,replacesId:head.id,amount:t(a(head.amount).sub(take)),state:take.eq(head.amount)?'released':'committed',evidenceRefs:[...head.evidenceRefs,p.id,next.id]}));
        }
        if(remaining.gt(0))throw new Error('paper_reserve_release_lineage_missing');
        savePaperReserveProposal(p,db);savePaperReserveState(next,db);
        const assessment=identifiedBudgetFact({scopeId:r.scopeId,streamId:next.streamId,operationKey:r.commandId,proposalId:p.id,beforeId:c.state.id,afterId:next.id,claimIds:claims.map(x=>x.id),authorityHash:proof.hash,authorityProof:proof});savePaperReserveAssessment(assessment,db);
        appendReviewedPaperReserveClaims({profileId,scopeId:r.scopeId,expectedRevision:r.budgetRevision,beforeStateId:c.state.id,assessmentId:assessment.id,nowMs:now(),claims,revalidateAuthority:()=>{authority.check(c.policy!.id,c.binding.generation);}},db);
        advancePaperReserveBinding(profileId,c.binding.generation,{policy:c.policy,state:next,disabled:false},db);
        appendPaperReserveEvent(r.scopeId,{operationKey:r.commandId,kind:'release_review_committed_h_retained',atMs:now(),refs:[assessment.id,proof.hash]},db);authority.advance(c.policy.id,c.binding.generation+1);return view();
      });}catch(error){authority.disarm();throw error;}
    },
    disarm(){authority.disarm();},
  };
}
export type PaperProfitReserveService=ReturnType<typeof createPaperProfitReserveService>;
