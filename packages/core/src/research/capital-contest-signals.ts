import { capitalHash } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D,budgetAmount as amount,budgetText as text } from '../execution/native-rules.js';
import { momentumTargets,momentumMinimumHistory } from '../strategies/momentum.js';
import { rotationTargets } from '../strategies/rotation.js';
import {hrpWeights,inverseVolWeights} from '../portfolio/risk-budget.js';
import { volTargetExposure,volTargetMinimumHistory } from '../strategies/vol-target.js';
import type { InstrumentKey } from '../types/index.js';
import { CAPITAL_REPLAY_DAY as DAY,type ReplayMarketFrame } from './capital-replay-types.js';
import type { ReplayDecisionCut } from './capital-replay-kernel.js';
import type { CapitalContestManifestV1,ContestCandidateV1,ContestInputManifestV1,ContestDecisionEvidence,ContestMomentum } from './capital-contest-types.js';
function momentumConfig(m:ContestMomentum){const {lookbackDaysEnsemble,relativeScoreSpreadFloor,...base}=m;return {...base,...(lookbackDaysEnsemble?{lookbackDaysEnsemble:[...lookbackDaysEnsemble]}:{}),...(relativeScoreSpreadFloor===undefined?{}:{relativeScoreSpreadFloor})};}
export function contestHistory(m:CapitalContestManifestV1,data:ContestInputManifestV1,c:ContestCandidateV1,atMs:number){
 const count=Math.max(c.lookbackDays+1,c.volatilityDays+1,c.momentum?momentumMinimumHistory(momentumConfig(c.momentum)):0,c.volatility?volTargetMinimumHistory(c.volatility):0);
 const through=Math.floor((atMs-c.decisionDelayMs)/DAY)*DAY;
 const rows=[...data.warmup,...data.market].filter(r=>r.endMs<=through).slice(-count);
 const complete=rows.length===count&&rows.at(-1)?.endMs===through&&rows.every((r,i)=>!i||r.atMs===rows[i-1]!.endMs);
 const prices:Partial<Record<InstrumentKey,number[]>>={};
 for(const id of [...m.replay.assets].sort()){
  const member=data.membership.filter(x=>x.assetId===id&&x.fromMs<=atMs&&atMs<x.toMs);
  const eligible=member.length===1&&member[0]!.eligible&&(member[0]!.assurance==='scenario'||member[0]!.observedAtMs<member[0]!.fromMs);
  if(!eligible||!complete||rows.some(r=>r.assets[id]?.closeUsd===null||r.assets[id]?.closeUsd===undefined||m.replay.availabilityBasis==='observed'&&!(data.availability??[]).some(a=>a.assetId===id&&a.endMs===r.endMs&&a.observedAtMs<=atMs)))continue;
  const values=rows.map(r=>Number(r.assets[id]!.closeUsd));if(values.every(x=>Number.isFinite(x)&&x>0))prices[id as InstrumentKey]=values;
 }
 return {prices,rows,through,complete};
}
function capTargets(m:CapitalContestManifestV1,variantId:string,raw:Readonly<Record<string,number>>):Record<string,string>{
 const p=m.scenarios.find(v=>v.id===variantId)!.policy,cap=D.min(p.maxPositionFraction,p.accountMaxPositionFraction),totalCap=D.min(p.maxInvestedFraction,p.accountMaxInvestedFraction);
 const clipped=Object.fromEntries(Object.entries(raw).map(([id,w])=>[id,D.min(cap,Math.max(0,w)).toDecimalPlaces(10,D.ROUND_DOWN)]));
 const sum=Object.values(clipped).reduce((s,w)=>s.add(w),new D(0)),scale=sum.gt(totalCap)?totalCap.div(sum):new D(1);
 return Object.fromEntries(Object.entries(clipped).map(([id,w])=>[id,text(w.mul(scale).toDecimalPlaces(10,D.ROUND_DOWN))]));
}
function rawSignal(m:CapitalContestManifestV1,c:ContestCandidateV1,data:ContestInputManifestV1,cut:ReplayDecisionCut){
 const h=contestHistory(m,data,c,cut.decisionAtMs),raw:Record<string,number>={},reasons:string[]=[];
 if(['cash','hold','passive'].includes(c.family)){if(c.family!=='cash')for(const [id,w] of Object.entries(c.baseWeights))raw[id]=Number(w);return {raw,reasons,history:h};}
 if(!h.complete||Object.keys(h.prices).length!==m.replay.assets.length){reasons.push('signal_history_or_membership_incomplete');return {raw,reasons,history:h};}
 if(c.family==='trend')for(const [id,closes] of Object.entries(h.prices)){const xs=closes!;raw[id]=xs.at(-1)!>xs[xs.length-1-c.lookbackDays]!?Number(c.baseWeights[id]??0):0;}
 if(c.family==='rotation'){
  const held=Object.entries(cut.positions).filter(([id,q])=>amount(q).gt(0)&&(cut.initial||cut.marks[id]!==undefined&&amount(q).mul(cut.marks[id]!).gte(c.dustUsd))).map(([id])=>id as InstrumentKey);
  const ranked=rotationTargets(h.prices,{topN:c.topN,lookbackDays:c.lookbackDays,volatilityDays:c.volatilityDays,absoluteFilter:true,weighting:c.weighting==='hrp'?'equal':c.weighting,holdBufferMultiple:c.buffer},held);
  for(const p of ranked.picks)raw[p.assetId]=p.weight;
  if(ranked.eligible<3||Object.values(h.prices).filter(xs=>xs!.at(-1)!>xs![xs!.length-1-c.lookbackDays]!).length<3)reasons.push('buffer_not_fully_exercised');
 }
 if(c.family==='allocator')for(const t of momentumTargets(Object.entries(c.baseWeights).map(([assetId,w])=>({assetId:assetId as InstrumentKey,weight:Number(w)})),h.prices,momentumConfig(c.momentum!) ).targets)raw[t.assetId]=t.weight;
 if(c.family!=='rotation'&&c.weighting!=='equal'||c.weighting==='hrp'){
  const ids=Object.keys(raw).filter(id=>raw[id]!>0).sort();
  if(ids.length){const returns=ids.map(id=>{const xs=h.prices[id as InstrumentKey]!;return xs.slice(-c.volatilityDays).map((p,i)=>p/xs[xs.length-c.volatilityDays+i-1]!-1);});
   const weights=c.weighting==='hrp'?hrpWeights(returns):inverseVolWeights(returns),exposure=ids.reduce((s,id)=>s+raw[id]!,0);
   ids.forEach((id,i)=>{raw[id]=weights[i]!*exposure;});
  }
 }
 if(c.volatility){const ids=Object.keys(h.prices),mix=h.rows.map((_,i)=>ids.reduce((s,id)=>s+(h.prices[id as InstrumentKey]![i]!/h.prices[id as InstrumentKey]![0]!)*Number(c.baseWeights[id]??0),0));const v=volTargetExposure(mix,c.volatility);for(const id of Object.keys(raw))raw[id]=raw[id]!*v.exposure;}
 return {raw,reasons,history:h};
}
/** One adapter instance per actual book; no future frame, next-open funding or pending intention is a holding. */
export function contestDecisionSource(m:CapitalContestManifestV1,c:ContestCandidateV1,data:ContestInputManifestV1,variantId:string){
 let targets:Readonly<Record<string,string>>={},first=true;
 return (cut:ReplayDecisionCut):ContestDecisionEvidence=>{
  let signal=rawSignal(m,c,data,cut),fittedThroughMs:number|null=null;
  const fold=m.folds.find(f=>f.validationFromMs<=cut.executionAtMs&&cut.executionAtMs<f.validationToMs);
  if(c.family==='exposure'){
   const source=m.candidates.find(x=>x.id===c.exposureOf)!;
   if(!fold){signal={...signal,reasons:['prior_training_artifact_unavailable']};}
   else{
    const training=[...data.warmup,...data.market].filter(r=>r.atMs>=fold.trainFromMs&&r.endMs<=fold.trainToMs);
    const exposures:number[]=[];
    for(const row of training){const sample=rawSignal(m,source,data,{...cut,decisionAtMs:row.atMs+source.decisionDelayMs,executionAtMs:row.endMs,positions:{},marks:{},initial:true});
     if(!sample.reasons.includes('signal_history_or_membership_incomplete'))exposures.push(Object.values(capTargets(m,variantId,sample.raw)).reduce((s,w)=>s+Number(w),0));}
    if(!exposures.length)signal={...signal,reasons:['prior_training_artifact_unavailable']};
    else{const mean=exposures.reduce((s,x)=>s+x,0)/exposures.length,base=Object.values(c.baseWeights).reduce((s,x)=>s+Number(x),0);signal={...signal,raw:Object.fromEntries(Object.entries(c.baseWeights).map(([id,w])=>[id,base>0?Number(w)/base*mean:0])),reasons:[]};fittedThroughMs=fold.trainToMs;}
   }
  }
  const scheduled=c.family==='cash'||c.family==='hold'?first:(cut.executionAtMs-c.anchorMs)%(c.cadenceDays*DAY)===0;
  const candidate=capTargets(m,variantId,signal.raw),riskExits=Object.keys(cut.positions).filter(id=>{const xs=signal.history.prices[id as InstrumentKey];return amount(cut.positions[id]!).gt(0)&&(['trend','rotation'].includes(c.family)&&xs!==undefined&&xs.at(-1)!<=xs[xs.length-1-c.lookbackDays]!||c.family==='cash')&&signal.reasons.every(r=>r==='buffer_not_fully_exercised');});
  const insufficient=signal.reasons.some(r=>r!=='buffer_not_fully_exercised');
  let hardTargets:Record<string,string>|null=null;
  if(cut.activeEquityUsd!==undefined&&cut.activeEquityUsd!==null&&amount(cut.activeEquityUsd).gt(0)){
   const heldWeights=Object.fromEntries(Object.entries(cut.positions).filter(([id])=>cut.marks[id]!==undefined).map(([id,q])=>[id,Number(amount(q).mul(cut.marks[id]!).div(cut.activeEquityUsd!))]));
   const clipped=capTargets(m,variantId,heldWeights);
   if(Object.entries(heldWeights).some(([id,w])=>amount(clipped[id]??'0').add('0.0000000001').lt(w))){hardTargets=clipped;for(const [id,w] of Object.entries(heldWeights))if(amount(clipped[id]??'0').lt(w)&&!riskExits.includes(id))riskExits.push(id);}
  }
  if(hardTargets)targets=hardTargets;else if(!insufficient&&(scheduled||riskExits.length))targets=scheduled?candidate:{...targets,...Object.fromEntries(riskExits.map(id=>[id,'0']))};
  const body={executionAtMs:cut.executionAtMs,decisionAtMs:cut.decisionAtMs,availableAtMs:cut.decisionAtMs,observedThroughMs:signal.history.through,policyHash:capitalHash(c),
   status:insufficient&&!hardTargets?'insufficient_history' as const:scheduled||riskExits.length?(Object.values(targets).some(w=>amount(w).gt(0))?'targets' as const:'abstain' as const):'not_scheduled' as const,
   targets:{...targets},riskExits,priority:[...m.replay.assets].sort(),fill:{fraction:'1',delayFrames:0}};
  first=false;return {decision:{...body,id:capitalHash(body)},bookHash:capitalHash(cut),historyHash:capitalHash(signal.history.rows),reasons:signal.reasons,foldId:fold?.id??null,fittedThroughMs};
 };
}
export function contestCloseRows(data:ContestInputManifestV1):readonly ReplayMarketFrame[]{return [...data.warmup,...data.market];}
