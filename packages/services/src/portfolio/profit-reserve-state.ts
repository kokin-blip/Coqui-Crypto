import { applyModeledReserve } from '@coqui/core';
import { advanceReserveHead, assertReserveAccess, currentBudget, getCapitalScope, getReserveInspection, getReservePolicy, getReserveState,
  inTransaction, reserveAssessmentByOperation, saveReserveAssessment, saveReserveState, reserveHead, type Db } from '@coqui/storage';
import { reserveSourceCutHash } from './profit-reserve-eligibility.js';

/** Not an IPC command. Only an explicitly isolated preview book can model a commitment. */
export function commitIsolatedReservePreview(input:{readonly domain:'isolated_preview';readonly profileId:string;readonly scopeId:string;readonly previewId:string;
  readonly operationKey:string;readonly expectedStateId:string;readonly nowMs:number},db:Db){
  return inTransaction(db,()=>{
    if(input.domain!=='isolated_preview')throw new Error('reserve_preview_domain_required');
    assertReserveAccess(input.profileId,input.scopeId,db,true);
    const before=getReserveState(input.expectedStateId,db),existing=before?reserveAssessmentByOperation(before.streamId,input.operationKey,db):null;
    if(existing){
      if(existing.beforeId!==input.expectedStateId||existing.previewId!==getReserveInspection(input.previewId,db)?.report.id)throw new Error('reserve_command_conflict');
      return {state:getReserveState(existing.afterId,db)!,assessment:existing};
    }
    const scope=getCapitalScope(input.scopeId,db),inspection=getReserveInspection(input.previewId,db),head=reserveHead(input.scopeId,db);
    if(scope?.provider!=='local_paper'||scope.environment!=='simulation'||!inspection||inspection.report.assurance!=='scenario'||inspection.report.scopeId!==input.scopeId||head?.state_id!==input.expectedStateId)throw new Error('reserve_isolated_book_required');
    const r=inspection.report,f=r.financial,budget=currentBudget(input.scopeId,input.nowMs,db);
    if(!budget||budget.revision!==f.budgetRevision||f.sourceCutHash!==reserveSourceCutHash(input.scopeId,db))throw new Error('reserve_source_stale');
    const state=getReserveState(head.state_id,db)!,policy=getReservePolicy(head.policy_id,db)!;
    const next=applyModeledReserve(policy,state,r,input.operationKey,input.nowMs);
    saveReserveState(next.state,db);saveReserveAssessment(next.assessment,db);advanceReserveHead(input.scopeId,policy.id,next.state.id,state.id,db);
    // No account ledger, cash claim, order or external adapter can be reached here.
    return next;
  });
}
