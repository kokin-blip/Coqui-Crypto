import {contestScenarioSpec} from './capital-contest-manifest.js';
import { capitalHash } from '../portfolio/capital-ledger.js';
import { replayCapitalKernel } from './capital-replay-kernel.js';
import { contestDecisionSource } from './capital-contest-signals.js';
import {contestSaleConsequences} from './capital-contest-sales.js';
import {contestAttribution} from './capital-contest-report.js';
import {reviewContestEconomicCash} from './capital-contest-reserves.js';
import { contestExecutionPolicy } from './capital-contest-execution.js';
import type { CapitalContestManifestV1,ContestInputManifestV1,ContestTrialV1,ContestCellV1,ContestDecisionEvidence,ContestSaleConsequence } from './capital-contest-types.js';
/** Private simulation only. Replay variants are copied; no observed ledger or operational reserve service. */
export function replayContestCell(m:CapitalContestManifestV1,data:ContestInputManifestV1,trial:ContestTrialV1,check:()=>void=()=>{},reference?:readonly ContestDecisionEvidence[]):ContestCellV1{
 const arm=m.arms.find(a=>a.id===trial.armId)!,candidate=m.candidates.find(c=>c.id===arm.candidateId)!,v=m.scenarios.find(v=>v.id===trial.variantId)!;
 const variant={...v,id:trial.variantId,reserve:{...v.reserve,goal:arm.shareBps?'preview' as const:'keep_invested' as const,shareBps:arm.shareBps,minimumBatchUsd:arm.minimumBatchUsd,retainedCapitalUsd:arm.retainedCapitalUsd}};
 const spec={...contestScenarioSpec(m,v.id),pathId:capitalHash({manifest:capitalHash(m),trial}),variants:[variant]};
 const source=contestDecisionSource(m,candidate,data,v.id),decisions:ContestDecisionEvidence[]=[],saleConsequences:ContestSaleConsequence[]=[];
 const result=replayCapitalKernel(spec,{market:data.market,decisions:[]},{id:trial.id,capitalUsd:trial.capitalUsd,variantId:v.id,arm:'policy'},
  {check,inspectReserve:(book,preview,frame,pending,used)=>{if(arm.group==='R')saleConsequences.push(...contestSaleConsequences(book,spec,variant,preview,frame,pending,used));},operatingIntents:m.operatingRequests.find(r=>r.capitalUsd===trial.capitalUsd)!.intents,...(arm.capMode==='economic_cash_review'?{reviewReserve:reviewContestEconomicCash}:{}),decisionDelayMs:candidate.decisionDelayMs,adjust:contestExecutionPolicy(arm),decide(cut){
   const e=reference?.find(e=>e.decision.executionAtMs===cut.executionAtMs)??(reference?null:source(cut));
   if(!e)throw new Error('contest_reference_target_missing');decisions.push(e);return e.decision;
  }});
 const limitations=['offline simulation; no qualification or financial authority','Prior-training exposure controls fit target exposure; residual realized exposure differences remain visible.'];
 const metrics={...result.metrics,...contestAttribution(result,m.selection.rollingDays)};if(arm.capMode==='economic_cash_review')limitations.push('Counterfactual contest-economic-cash-cap-v1 funds simulated cash without requiring realized profit; actual realized/basis evidence and all other caps remain intact. No operational P3 reducer accepts it.');
 const reasons=[...new Set(decisions.flatMap(e=>e.reasons).filter(r=>r!=='buffer_not_fully_exercised'))];
 const {id:kernelResultId,...old}=result;if(kernelResultId!==capitalHash(old))throw new Error('contest_kernel_result_corrupt');const body={...old,metrics,state:reasons.length?'unavailable' as const:result.state,reasonCodes:[...result.reasonCodes,...reasons]};
 return {trial,result:{...body,id:capitalHash(body)},saleConsequences,decisions,targetHash:capitalHash(decisions.map(e=>e.decision)),limitations};
}
export function contestReferenceArm(m:CapitalContestManifestV1){return m.arms.find(a=>a.group==='S'&&a.selectable&&m.candidates.find(c=>c.id===a.candidateId)?.family==='trend');}
export function referenceForTrial(m:CapitalContestManifestV1,trial:ContestTrialV1){const a=contestReferenceArm(m);if(!a)throw new Error('contest_reference_trend_missing');return m.trials.find(t=>t.armId===a.id&&t.capitalUsd===trial.capitalUsd&&t.variantId===trial.variantId)!;}
