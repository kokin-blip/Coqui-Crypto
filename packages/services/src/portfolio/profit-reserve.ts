import { capitalHash, evaluateProfitReserve, reserveBaseline, reservePolicy, openReserveCycle,
  type ReserveSettings } from '@coqui/core';
import { reserveInspectionSchema, reserveSettingsSchema, reserveViewSchema, type ChannelRequest, type ChannelResponse } from '@coqui/contracts';
import { advanceReserveHead, assertReserveAccess, getReserveInspection, getReservePolicy, getReserveState, inTransaction,
  reserveCommand, reserveFactIds, reserveHead, saveReserveCommand, saveReserveEligibility, saveReserveInspection, saveReservePolicy, saveReserveState, type Db } from '@coqui/storage';
import { assembleReserveFinancial } from './profit-reserve-eligibility.js';
import { reserveScenario } from './profit-reserve-scenario.js';
import { reserveConsequences } from './profit-reserve-consequences.js';

const KEEP_INVESTED:ReserveSettings={goal:'keep_invested',trigger:{kind:'profit_usd',value:'50'},shareBps:0,retainedCapitalUsd:'0',minimumBatchUsd:'1',cadence:'manual',reviewWinCount:null,taxHold:{amountUsd:'0',backing:'principal'}};
export function reserveView(profileId:string,scopeId:string,nowMs:number,db:Db):ChannelResponse<'capital.reserve.view'>{
  return inTransaction(db,()=>{
    const context=assembleReserveFinancial(profileId,scopeId,nowMs,db),head=reserveHead(scopeId,db),ids=reserveFactIds('capital_reserve_preview_reports_v1',scopeId,db);
    return {schemaVersion:1,mode:'preview_only',scopeId,policy:head?getReservePolicy(head.policy_id,db):null,state:head?getReserveState(head.state_id,db):null,
      archived:head?.archived===1,financial:context.financial,latest:ids[0]?getReserveInspection(ids[0],db):null,historicalPreviewIds:ids.slice(0,100),executionEligible:false,liveExecutionPermitted:false};
  });
}
export function previewReserve(profileId:string,request:ChannelRequest<'capital.reserve.preview'>,nowMs:number,db:Db):ChannelResponse<'capital.reserve.preview'>{
  if(request.mode==='scenario')return reserveScenario(request,nowMs);
  return inTransaction(db,()=>{
    const {scopeId}=request,c=assembleReserveFinancial(profileId,scopeId,nowMs,db),head=reserveHead(scopeId,db),old=head?getReservePolicy(head.policy_id,db):null;
    const same=old&&(!request.settings||capitalHash(request.settings)===capitalHash(old.settings));
    const policy=same?old:reservePolicy({scopeId,originProfileId:profileId,previousId:old?.id??null,createdAtMs:nowMs,settings:reserveSettingsSchema.parse(request.settings??KEEP_INVESTED)});
    const prior=head?getReserveState(head.state_id,db):null;
    const state=same&&prior?prior:reserveBaseline(policy,prior,c.financial,'draft-only',nowMs);
    return reserveConsequences(evaluateProfitReserve(policy,state,c.financial,c.floor,nowMs),c.eligibility,null,'0',policy.settings.cadence,policy.createdAtMs);
  });
}
export function saveReserveSettings(profileId:string,request:ChannelRequest<'capital.reserve.settings.save'>,nowMs:number,db:Db):ChannelResponse<'capital.reserve.settings.save'>{
  return inTransaction(db,()=>{
    assertReserveAccess(profileId,request.scopeId,db,true);const requestHash=capitalHash({channel:'capital.reserve.settings.save',profileId,request});
    const retry=reserveCommand(request.scopeId,request.commandId,requestHash,db);if(retry!==null)return reserveViewSchema.parse(retry);
    const head=reserveHead(request.scopeId,db);
    if((head?.policy_id??null)!==request.expectedPolicyId||(head?.state_id??null)!==request.expectedStateId)throw new Error('reserve_revision_stale');
    const c=assembleReserveFinancial(profileId,request.scopeId,nowMs,db);
    if(c.financial.sourceCutHash!==request.expectedInputHash)throw new Error('reserve_source_stale');
    const prior=head?getReserveState(head.state_id,db):null;
    const policy=reservePolicy({scopeId:request.scopeId,originProfileId:profileId,previousId:head?.policy_id??null,createdAtMs:nowMs,settings:reserveSettingsSchema.parse(request.settings)});
    const state=reserveBaseline(policy,prior,c.financial,`settings:${request.commandId}`,nowMs);
    saveReservePolicy(policy,db);saveReserveState(state,db);advanceReserveHead(request.scopeId,policy.id,state.id,request.expectedStateId,db);
    const response=reserveView(profileId,request.scopeId,nowMs,db);saveReserveCommand(request.scopeId,request.commandId,requestHash,response,db);return response;
  });
}
export function inspectReserve(profileId:string,request:ChannelRequest<'capital.reserve.inspect'>,nowMs:number,db:Db):ChannelResponse<'capital.reserve.inspect'>{
  return inTransaction(db,()=>{
    assertReserveAccess(profileId,request.scopeId,db,true);const requestHash=capitalHash({channel:'capital.reserve.inspect',profileId,request});
    const retry=reserveCommand(request.scopeId,request.commandId,requestHash,db);if(retry!==null)return reserveInspectionSchema.parse(retry);
    const head=reserveHead(request.scopeId,db);
    if(!head||head.policy_id!==request.expectedPolicyId||head.state_id!==request.expectedStateId)throw new Error('reserve_revision_stale');
    const c=assembleReserveFinancial(profileId,request.scopeId,nowMs,db);
    if(c.financial.sourceCutHash!==request.expectedInputHash)throw new Error('reserve_source_stale');
    const policy=getReservePolicy(head.policy_id,db)!;let state=getReserveState(head.state_id,db)!;
    if(state.baseline==='awaiting_evidence')state=reserveBaseline(policy,state,c.financial,`baseline:${request.commandId}`,nowMs);
    state=openReserveCycle(policy,state,c.financial,`cycle:${request.commandId}`,nowMs);
    if(state.id!==head.state_id){saveReserveState(state,db);advanceReserveHead(request.scopeId,policy.id,state.id,head.state_id,db);}
    const response=reserveConsequences(evaluateProfitReserve(policy,state,c.financial,c.floor,nowMs),c.eligibility,null,'0',policy.settings.cadence,policy.createdAtMs);
    if(c.eligibility)saveReserveEligibility(c.eligibility,db);saveReserveInspection(response,db);
    saveReserveCommand(request.scopeId,request.commandId,requestHash,response,db);return response;
  });
}
