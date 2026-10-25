import { budgetAmount as a, budgetText as t, calculateCapitalPerformance, capitalHash, capitalScopeId, capitalEventIdentity, reserveUnavailable,
  type ReserveFinancialInput, type PaperReserveState, type PaperReserveProposal, type CapitalValuation, type CapitalEventRevision, type CapitalSourceBatch } from '@coqui/core';
import { getCapitalScope, listCapitalValuations, listPaperReserveFacts, readPaperReserveFact, type PaperCapitalBook, type PaperReserveAssessment, type Db } from '@coqui/storage';
/** An informational sleeve projection, never appended to the account's external-capital ledger. */
export function paperActiveSleevePerformance(book:PaperCapitalBook,scopeId:string,headId:string|null,f:ReserveFinancialInput,db:Db) {
  const version='paper-reserve-active-sleeve-v1' as const;
  const unavailable=(...codes:string[])=>({version,scope:'active_sleeve_only' as const,timeWeightedReturnPct:reserveUnavailable(...codes),economicPnlUsd:reserveUnavailable(...codes),inputHash:null,allocationStateIds:[] as string[],points:[] as {atMs:number;unitNavUsd:string|null;returnPct:string|null}[]});
  if(f.reasonCodes.length || f.economicPnlUsd.state!=='available' || f.contributionsUsd.state!=='available' || f.netOutflowsUsd.state!=='available' || f.contributionsUsd.value!=='0' || f.netOutflowsUsd.value!=='0')return unavailable('active_sleeve_account_history_unavailable',...f.reasonCodes);
  const scope=getCapitalScope(scopeId,db);if(!scope || f.toMs===null)return unavailable('active_sleeve_scope_unavailable');
  const states=listPaperReserveFacts<PaperReserveState>('state',scopeId,db),byId=new Map(states.map(s=>[s.id,s])),chain:PaperReserveState[]=[];
  let id=headId;while(id){const state=byId.get(id);if(!state || chain.some(s=>s.id===id))return unavailable('active_sleeve_state_lineage_missing');chain.push(state);id=state.previousId;}chain.reverse();
  const valuations=listCapitalValuations(scopeId,db),replaced=new Set(valuations.map(v=>v.replacesId)),heads=valuations.filter(v=>!replaced.has(v.id)&&v.verified&&v.equityUsd!==null&&v.cashUsd!==null);
  const assessments=listPaperReserveFacts<PaperReserveAssessment>('assessment',scopeId,db),events:CapitalEventRevision[]=[],rows:CapitalValuation[]=[];
  const accountIdentityHash=capitalHash({account:scope.accountIdentityHash,projection:version}),sleeveScope={...scope,id:capitalScopeId('local_paper','simulation',accountIdentityHash),accountIdentityHash};
  const batch:CapitalSourceBatch={id:capitalHash({version,scopeId,headId,source:f.sourceCutHash,valuationIds:heads.map(v=>v.id)}),scopeId:sleeveScope.id,source:version,requestedAtMs:f.toMs,observedAtMs:f.toMs,recordedAtMs:f.toMs,
    coverage:{fromMs:book.atMs,toMs:f.toMs,complete:true,paginationComplete:true,membershipComplete:true,reasonCodes:[]},memberIdentityHashes:[accountIdentityHash],evidenceRefs:[book.id,...chain.map(s=>s.id)],payload:{accountScopeId:scopeId,informationalInternalAllocationFlowsOnly:true}};
  const value=(atMs:number,sequence:number,equityUsd:string,cashUsd:string,refs:readonly string[]):CapitalValuation=>({id:capitalHash({version,batch:batch.id,atMs,sequence,equityUsd,cashUsd,refs}),scopeId:sleeveScope.id,sourceBatchId:batch.id,replacesId:null,atMs,sequence,observedAtMs:atMs,equityUsd,cashUsd,legs:[],verified:true,missingComponents:[],evidenceRefs:refs});
  const changes:{state:PaperReserveState;before:PaperReserveState|null;proposal:PaperReserveProposal;delta:string}[]=[];
  for(let i=0;i<chain.length;i++){
    const state=chain[i]!,before=chain[i-1]??null,delta=a(state.reservedUsd).add(state.taxHoldUsd).sub(before?.reservedUsd??'0').sub(before?.taxHoldUsd??'0');if(delta.isZero())continue;
    const assessment=assessments.find(r=>r.afterId===state.id&&r.beforeId===before?.id),proposal=assessment?readPaperReserveFact<PaperReserveProposal>('proposal',assessment.proposalId,db):null;
    const cut=proposal?.financial;
    if(!proposal || !cut || cut.toMs!==state.atMs || cut.observedAtMs!==state.atMs || cut.equityUsd.state!=='available' || cut.observedCashUsd.state!=='available' ||
      !heads.some(v=>v.atMs===state.atMs && a(v.equityUsd!).eq(cut.equityUsd.state==='available'?cut.equityUsd.value:'-1')))return unavailable('active_sleeve_flow_time_marks_missing');
    changes.push({state,before,proposal,delta:t(delta)});
  }
  const flowTimes=new Set(changes.map(c=>c.state.atMs));
  for(const v of heads.filter(v=>v.atMs>=book.atMs&&v.atMs<=f.toMs!&&!flowTimes.has(v.atMs))){
    const prior=chain.filter(s=>s.atMs<=v.atMs).at(-1),claimed=a(prior?.reservedUsd??'0').add(prior?.taxHoldUsd??'0');
    if(claimed.gt(v.cashUsd!))return unavailable('active_sleeve_reserve_underfunded');rows.push(value(v.atMs,0,t(a(v.equityUsd!).sub(claimed)),t(a(v.cashUsd!).sub(claimed)),[v.id]));
  }
  if(!rows.some(v=>v.atMs===book.atMs))rows.push(value(book.atMs,0,book.openingUsd,book.openingUsd,[book.id]));
  const sequence=new Map<number,number>();
  for(const change of changes){const {state,before,proposal,delta}=change,cut=proposal.financial;
    const equity=cut.equityUsd.state==='available'?cut.equityUsd.value:'0',cash=cut.observedCashUsd.state==='available'?cut.observedCashUsd.value:'0',oldClaims=a(before?.reservedUsd??'0').add(before?.taxHoldUsd??'0'),nextClaims=a(state.reservedUsd).add(state.taxHoldUsd);
    if(oldClaims.gt(cash)||nextClaims.gt(cash))return unavailable('active_sleeve_reserve_underfunded');
    const seq=sequence.get(state.atMs)??1,pre=value(state.atMs,seq,t(a(equity).sub(oldClaims)),t(a(cash).sub(oldClaims)),[state.previousId!,proposal.id]),post=value(state.atMs,seq+1,t(a(equity).sub(nextClaims)),t(a(cash).sub(nextClaims)),[state.id,proposal.id]);rows.push(pre,post);sequence.set(state.atMs,seq+2);
    const event:Omit<CapitalEventRevision,'id'|'revisionHash'>={scopeId:sleeveScope.id,sourceBatchId:batch.id,logicalKey:`internal-sleeve-allocation:${state.id}`,replacesId:null,correctionAuthority:null,kind:a(delta).gt(0)?'outflow':'contribution',status:'confirmed',effectiveTime:{precision:'instant',fromMs:state.atMs,toMs:state.atMs},observedAtMs:state.atMs,recordedAtMs:state.atMs,legs:[],externalFlowUsd:t(a(delta).neg()),flowVerified:true,confirmedUserReceiptUsd:'0',feeUsd:'0',incomeUsd:'0',beforeValuationId:pre.id,afterValuationId:post.id,evidenceRefs:[state.id,proposal.id],reasonCodes:[]};events.push({...event,...capitalEventIdentity(event)});
  }
  const opening=rows.find(r=>r.atMs===book.atMs&&r.sequence===0)!;
  const report=calculateCapitalPerformance({scope:sleeveScope,epoch:{id:capitalHash({version,opening:opening.id}),scopeId:sleeveScope.id,openingValuationId:opening.id,predecessorId:null,reason:'verified_origin',historicalLimitations:[]},batches:[batch],events,valuations:rows});
  return {version,scope:'active_sleeve_only' as const,timeWeightedReturnPct:report.metrics.timeWeightedReturnPct,economicPnlUsd:report.metrics.economicPnlUsd,inputHash:report.inputHash,allocationStateIds:changes.map(c=>c.state.id),points:report.points.map(p=>({atMs:p.atMs,unitNavUsd:p.unitNavUsd,returnPct:p.returnPct}))};
}
