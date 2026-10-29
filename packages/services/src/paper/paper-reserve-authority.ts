import { capitalHash, type PaperReserveStrategy, type PaperReserveAuthorityProof } from '@coqui/core';
import { assertDedicatedPaperCapitalProfile, getAuthoritativeHost, getPaperExecutionPolicy, getWalletRiskState, readApplicablePaperQualification,
  validateExecutionLease, type Db } from '@coqui/storage';
import { resolveKillSwitch } from './kill-switch.js';
export interface PaperReserveAuthorityContext {
  readonly profileId:string; readonly ownerId:string; readonly hostGeneration:number; readonly fencingToken:number;
  readonly strategy:PaperReserveStrategy; readonly operationAllowed:()=>boolean; readonly strategyPaused:()=>boolean;
}

/** Re-read on every mutation. A renderer flag or persisted enabled setting is never a permit. */
export function checkPaperReserveAuthority(c:PaperReserveAuthorityContext,nowMs:number,db:Db):PaperReserveAuthorityProof {
  assertDedicatedPaperCapitalProfile(c.profileId,db);
  const host=getAuthoritativeHost(c.profileId,db),policy=getPaperExecutionPolicy(c.profileId,db),risk=getWalletRiskState(c.profileId,db);
  if(!c.operationAllowed() || !host || host.status!=='active' || host.hostId!==c.ownerId || host.fencingGeneration!==c.hostGeneration ||
    !validateExecutionLease(c.profileId,c.ownerId,c.fencingToken,nowMs,db))throw new Error('paper_reserve_host_or_lease_unavailable');
  if(policy.mode==='off' || resolveKillSwitch(c.profileId,db).engaged || risk?.stage==='hard_stop' || c.strategyPaused())throw new Error('paper_reserve_stopped_or_paused');
  if(risk && risk.stage!=='normal')throw new Error('paper_reserve_risk_exposure_reconciliation_required');
  const evidence=readApplicablePaperQualification(c.profileId,db,{profileId:c.profileId,...c.strategy},nowMs);
  if(!evidence)throw new Error('paper_reserve_qualification_missing');
  const body={profileId:c.profileId,hostGeneration:c.hostGeneration,fencingToken:c.fencingToken,evidenceHash:evidence.resultHash,policyHash:capitalHash({policy,risk}),grossEdgeLowerBoundPct:evidence.grossEdgeLowerBoundPct};
  return {...body,hash:capitalHash(body)};
}
/** Process-local permit is invalidated by lifecycle or by any failed revalidation. */
export function createPaperReserveAuthority(c:()=>PaperReserveAuthorityContext,now:()=>number,db:Db,prepareAuthority?:()=>void) {
  let permit:{policyId:string;generation:number;proofHash:string}|null=null;
  return {
    disarm(){permit=null;},
    arm(policyId:string,generation:number){prepareAuthority?.();const proof=checkPaperReserveAuthority(c(),now(),db);permit={policyId,generation,proofHash:proof.hash};return proof;},
    check(policyId:string,generation:number){try {
      const proof=checkPaperReserveAuthority(c(),now(),db);
      if(!permit || permit.policyId!==policyId || permit.generation!==generation || permit.proofHash!==proof.hash)throw new Error('paper_reserve_manual_resume_required');return proof;
    }catch(error){permit=null;throw error;}},
    advance(policyId:string,generation:number){if(!permit || permit.policyId!==policyId)throw new Error('paper_reserve_manual_resume_required');permit={...permit,generation};},
    get armed(){if(!permit)return false;try{const proof=checkPaperReserveAuthority(c(),now(),db);if(proof.hash!==permit.proofHash){permit=null;return false;}return true;}catch{permit=null;return false;}},
  };
}
export type PaperReserveAuthority = ReturnType<typeof createPaperReserveAuthority>;
