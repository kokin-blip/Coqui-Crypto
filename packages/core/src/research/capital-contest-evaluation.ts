import {budgetAmount as amount} from '../execution/native-rules.js';
import { capitalHash } from '../portfolio/capital-ledger.js';
import { periodSharpe,moments,deflatedSharpeForTrials } from '../significance/index.js';
import { combinatoriallySymmetricCrossValidation } from './cscv.js';
import { CAPITAL_REPLAY_DAY as DAY } from './capital-replay-types.js';
import type { CapitalContestManifestV1,ContestCellV1,ContestPathV1,ContestStatistic,ContestInterval,ContestChoice,ContestResultV1 } from './capital-contest-types.js';
const unavailable=(...reasons:string[]):ContestStatistic=>({status:'unavailable',reasons});
const available=(value:number):ContestStatistic=>Number.isFinite(value)?{status:'available',value}:unavailable('numerical_failure');
export function contestDailyReturns(cell:ContestCellV1):{dates:number[];returns:number[]}|null{
 if(cell.result.state==='unavailable'||cell.result.totalPerformance.length!==1)return null;
 const rows=cell.result.totalPerformance[0]!.points;
 const byDate=new Map<number,number>();for(const row of rows)if(row.atMs%DAY===0&&row.unitNavUsd!==null)byDate.set(row.atMs,Number(row.unitNavUsd));
 const dates=[...byDate.keys()].sort((a,b)=>a-b),returns:number[]=[];
 for(let i=1;i<dates.length;i++){if(dates[i]!-dates[i-1]!!==DAY||byDate.get(dates[i-1]!)!<=0)return null;const r=byDate.get(dates[i]!)!/byDate.get(dates[i-1]!)!-1;if(!Number.isFinite(r))return null;returns.push(r);}
 return {dates:dates.slice(1),returns};
}
export function contestDifferences(m:CapitalContestManifestV1,cells:readonly ContestCellV1[]):Record<string,ContestStatistic>{
 return Object.fromEntries(m.contrasts.map(c=>{
  let sum=0;for(const [capital,w] of Object.entries(m.primaryWeights)){if(Number(w)===0)continue;
   const find=(armId:string)=>cells.find(x=>x.trial.armId===armId&&x.trial.variantId===c.variantId&&x.trial.capitalUsd===capital);
   const left=find(c.left),right=find(c.right);if(!left||!right||left.result.state!=='complete'||right.result.state!=='complete')return [c.id,unavailable('contrast_cell_incomplete_or_infeasible')];
   const metric=(x:ContestCellV1):number|null=>{if(c.metric==='userNetOutcomePct')return x.result.summary.userNetOutcomeUsd===null?null:amount(x.result.summary.userNetOutcomeUsd).div(capital).mul(100).toNumber();const v=x.result.metrics[c.metric];return v?.state==='available'?Number(v.value):null;};
   const l=metric(left),r=metric(right);if(l===null||r===null)return [c.id,unavailable('contrast_metric_unavailable')];sum+=(l-r)*Number(w);
  }return [c.id,available(sum)];
 }));
}
export function contestQuantile(values:readonly number[],p:number):number{
 if(!values.length||values.some(v=>!Number.isFinite(v))||p<0||p>1)throw new Error('contest_quantile_invalid');
 const s=[...values].sort((a,b)=>a-b),at=p*(s.length-1),i=Math.floor(at);return s[i]!+(s[Math.min(i+1,s.length-1)]!-s[i]!)*(at-i);
}
export function contestIntervals(m:CapitalContestManifestV1,observed:Readonly<Record<string,ContestStatistic>>,paths:readonly ContestPathV1[],pathReasons:readonly string[]=[]):ContestInterval[]{
 const K=m.contrasts.filter(c=>c.primary).length;
 return m.contrasts.map(c=>{
  const estimate=observed[c.id]??unavailable('contrast_missing'),samples=paths.map(p=>p.differences[c.id]),familySize=c.primary?K:Math.max(1,m.contrasts.length);
  const tail=m.inference.alpha/(2*familySize),reasons=[...pathReasons];
  if(estimate.status==='unavailable')reasons.push(...estimate.reasons);
  if(paths.length!==m.inference.resamples||!paths.length||samples.some(s=>s?.status!=='available'))reasons.push('resample_inventory_incomplete_or_unavailable');
  if(paths.length*tail<m.inference.minTailReplications)reasons.push('insufficient_tail_resolution');
  let lower:null|number=null,upper:null|number=null;
  if(!reasons.length&&estimate.status==='available'){
   const values=samples.map(s=>s?.status==='available'?s.value:NaN);lower=2*estimate.value-contestQuantile(values,1-tail);upper=2*estimate.value-contestQuantile(values,tail);
  }
  return {id:c.id,estimate,lower,upper,reasons:[...new Set(reasons)],method:'paired-bonferroni-basic-bootstrap-v1',familySize,resamples:paths.length};
 });
}
function cohortDaily(m:CapitalContestManifestV1,cells:readonly ContestCellV1[],armId:string,variantId:string){
 const rows=Object.entries(m.primaryWeights).filter(([,w])=>Number(w)>0).map(([capital,w])=>({weight:Number(w),cell:cells.find(c=>c.trial.armId===armId&&c.trial.variantId===variantId&&c.trial.capitalUsd===capital)}));
 const tracks=rows.map(row=>row.cell?contestDailyReturns(row.cell):null);
 if(tracks.some(t=>t===null)||new Set(tracks.map(t=>t!.dates.join(','))).size!==1)return null;
 return {dates:tracks[0]!.dates,returns:tracks[0]!.returns.map((_,i)=>tracks.reduce((s,t,j)=>s+t!.returns[i]!*rows[j]!.weight,0))};
}
export function selectContestCandidate(m:CapitalContestManifestV1,cells:readonly ContestCellV1[],intervals:readonly ContestInterval[]):ContestChoice{
 const reasons:string[]=[],diagnostics:Record<string,ContestStatistic>={},survivors:{id:string;score:number}[]=[];
 const candidates=m.arms.filter(a=>a.selectable),failed=new Map(candidates.map(a=>[a.id,[] as string[]]));
 for(const variant of m.scenarios){
  const tracks=candidates.map(a=>cohortDaily(m,cells,a.id,variant.id));
  const aligned=tracks.every(t=>t!==null)&&new Set(tracks.map(t=>t!.dates.join(','))).size===1;
  const pbo=aligned?combinatoriallySymmetricCrossValidation(tracks.map(t=>t!.returns),m.selection.partitions):null;
  diagnostics[`pbo:${variant.id}`]=pbo?.probabilityOfBacktestOverfitting==null?unavailable('pbo_insufficient_or_unaligned'):available(pbo.probabilityOfBacktestOverfitting);
  for(const [i,a] of candidates.entries()){
   const fail=failed.get(a.id)!;if(cells.length!==m.trials.length||m.trials.some(t=>!cells.some(c=>c.trial.id===t.id)))fail.push('complete_inventory_required');const xs=tracks[i]?.returns??[],sr=periodSharpe(xs),shape=xs.length?moments(xs):null;
   const dsr=m.trialHistory.state!=='known-lower-bound'&&sr!==null&&shape?deflatedSharpeForTrials(sr,xs.length,shape.skew,shape.kurt,[...m.trialHistory.sharpeTrials],m.trialHistory.count):null;
   diagnostics[`dsr:${variant.id}:${a.id}`]=dsr===null?unavailable('dsr_trial_history_or_sample_unavailable'):available(dsr);
   if(xs.length<m.selection.minObservations)fail.push('minimum_observations');
   if(dsr===null||dsr<m.selection.minDsr)fail.push('dsr_gate');
   if(pbo?.probabilityOfBacktestOverfitting==null||pbo.probabilityOfBacktestOverfitting>m.selection.maxPbo)fail.push('pbo_gate');
   for(const [capital,w] of Object.entries(m.primaryWeights)){if(Number(w)<=0)continue;const cell=cells.find(c=>c.trial.armId===a.id&&c.trial.variantId===variant.id&&c.trial.capitalUsd===capital),dd=cell?.result.metrics['maxDrawdownPct'];
    if(!cell||cell.result.state!=='complete'||cell.result.summary.executedFills<m.selection.minActions||dd?.state!=='available'||Math.abs(Number(dd.value))>m.selection.maxDrawdownPct)fail.push('capital_feasibility_actions_or_drawdown');
   }
   for(const cell of cells.filter(c=>c.trial.armId===a.id&&c.trial.variantId===variant.id&&Number(m.primaryWeights[c.trial.capitalUsd]??0)>0))for(const days of m.selection.rollingDays){const metric=cell.result.metrics[`worstRolling${days}ReturnPct`];if(metric?.state!=='available'||Number(metric.value)<m.selection.minimumWorstRollingReturnPct)fail.push('worst_rolling_gate');}
   const primary=m.contrasts.filter(c=>c.primary&&c.left===a.id&&c.group==='S'&&c.variantId===variant.id),controls=new Set(primary.map(c=>(()=>{const control=m.candidates.find(x=>x.id===m.arms.find(a=>a.id===c.right)?.candidateId);return control?.family==='exposure'&&control.exposureOf!==a.candidateId?'wrong_exposure_control':control?.family;})()));
   if(!controls.has('passive')||!controls.has('exposure'))fail.push('required_passive_and_exposure_contrasts_missing');
   for(const contrast of primary)for(const fold of m.folds){let difference=0,missing=false;
    for(const [capital,w] of Object.entries(m.primaryWeights)){if(Number(w)<=0)continue;
     const get=(arm:string)=>{const c=cells.find(c=>c.trial.armId===arm&&c.trial.variantId===variant.id&&c.trial.capitalUsd===capital),points=c?.result.totalPerformance[0]?.points??[];let first:string|null=null,last:string|null=null;for(const p of points){if(p.atMs===fold.validationFromMs)first=p.unitNavUsd;if(p.atMs===fold.validationToMs)last=p.unitNavUsd;}return first!==null&&last!==null&&Number(first)>0?Number(last)/Number(first)*100-100:null;};
     const l=get(contrast.left),r=get(contrast.right);if(l===null||r===null)missing=true;else difference+=(l-r)*Number(w);
    }if(missing||difference<m.selection.minimumFoldExcessPct)fail.push('chronological_fold_gate');
   }
   if(primary.some(c=>{const b=intervals.find(i=>i.id===c.id);return b?.lower==null||b.lower<=c.minimumDifference;}))fail.push('paired_uncertainty_gate');
  }
 }
 for(const a of candidates){const fail=failed.get(a.id)!;if(fail.length)reasons.push(...fail.map(r=>`${a.id}:${r}`));else{const bounds=m.contrasts.filter(c=>c.primary&&c.left===a.id&&c.group==='S').map(c=>intervals.find(i=>i.id===c.id)?.lower??-Infinity);survivors.push({id:a.candidateId,score:Math.min(...bounds)});}}
 survivors.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));return {candidateId:survivors[0]?.id??null,status:survivors.length?'conditional_development_choice':'none',reasons:[...new Set(reasons)],diagnostics};
}
export function assembleContestResult(m:CapitalContestManifestV1,cells:readonly ContestCellV1[],paths:readonly ContestPathV1[],pathReasons:readonly string[]=[]):ContestResultV1{
 const intervals=contestIntervals(m,contestDifferences(m,cells),paths,pathReasons),choice=selectContestCandidate(m,cells,intervals);
 const distributionChoices=m.arms.filter(a=>a.group==='R').map(a=>{
  const reasons:string[]=[],armCells=cells.filter(c=>c.trial.armId===a.id);
  for(const c of armCells){const ref=cells.find(x=>x.trial.capitalUsd===c.trial.capitalUsd&&x.trial.variantId===c.trial.variantId&&m.arms.find(a=>a.id===x.trial.armId)?.group==='R'&&m.arms.find(a=>a.id===x.trial.armId)?.shareBps===0);
   if(!ref||c.result.state!=='complete'||ref.result.state!=='complete'||c.result.summary.userNetOutcomeUsd===null||ref.result.summary.userNetOutcomeUsd===null)reasons.push('distribution_reference_or_metrics_unavailable');
   else if(amount(ref.result.summary.userNetOutcomeUsd).sub(c.result.summary.userNetOutcomeUsd).gt(amount(c.trial.capitalUsd).mul(m.distributionObjective.maxSacrificePct).div(100))||c.result.summary.floorBreaches>m.distributionObjective.maxFloorBreaches||amount(c.result.summary.reservedUsd).add(c.result.summary.receiptsUsd).lt(m.distributionObjective.minimumReservedOrReceivedUsd))reasons.push('distribution_objective_failed');
  }
  if(a.capMode==='economic_cash_review')reasons.push('counterfactual_cap_requires_separate_policy_review');
  return {armId:a.id,status:reasons.length?'none' as const:'meets_declared_objective' as const,reasons:[...new Set(reasons)]};
 });
 const body={version:m.version,manifestHash:capitalHash(m),confirmatoryEligible:false as const,liveExecutionPermitted:false as const,cellIds:cells.map(c=>c.trial.id),cellHashes:cells.map(c=>c.result.id),pathIds:paths.map(p=>p.id),intervals,choice,distributionChoices,
 limitations:['Development only; no promotion/registration/financial authority.','Conditional stationary fixed-universe joint paths; boundary joins are artificial.','Basic Bonferroni bootstrap coverage is approximate, not finite-sample guaranteed.','Every resampled path reruns signals, calibration, actual books, funding, costs and reserve policy.','Capital sizes and bootstrap replications are not independent alpha trials.','Negative TrendVol evidence, historical reports and consumed holdout remain unchanged.']};
 return {...body,id:capitalHash(body)};
}
