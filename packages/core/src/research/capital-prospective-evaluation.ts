import {capitalHash} from '../portfolio/capital-ledger.js';
import {prospectiveBookPerformance} from './capital-prospective-book.js';
import {budgetAmount as a,budgetText as t} from '../execution/native-rules.js';
import {benchmarkRelativeConfidence} from './benchmark-confidence.js';
import {combinatoriallySymmetricCrossValidation} from './cscv.js';
import {moments,periodSharpe,deflatedSharpeForTrials} from '../significance/index.js';
import {forwardEdgeLowerConfidenceBoundPct} from './forward-edge.js';
import {PROSPECTIVE_DAY as DAY,type ProspectiveDesign,type ProspectiveBookRevision,type ProspectiveEvaluation,type ProspectivePhase,type ProspectiveCoverage} from './capital-prospective-types.js';
/** Pure evaluation of an explicitly permitted cut. Final candidate identity is already frozen. */
export function evaluateProspectiveCut(d:ProspectiveDesign,registrationId:string,phase:ProspectivePhase,rows:readonly ProspectiveBookRevision[],coverage:ProspectiveCoverage,nowMs:number,trialCount:number|null,frozen?:{candidateId:string;development:ProspectiveEvaluation},check:()=>void=()=>{}):ProspectiveEvaluation {
 trialCount=trialCount===null?null:Math.max(trialCount,d.trialHistory.count);
 const from=phase==='development'?d.startMs:d.finalStartMs,to=phase==='development'?d.developmentEndMs:d.endMs,groups=new Map<string,ProspectiveBookRevision[]>();
 for(const row of rows){if(row.registrationId!==registrationId||row.slotMs<from||row.slotMs>to)throw new Error('prospective_evaluation_cut_mismatch');groups.set(row.streamId,[...(groups.get(row.streamId)??[]),row]);}
 const series=new Map<string,{dates:number[];returns:number[]}>(),metrics:{-readonly [K in keyof ProspectiveEvaluation['cells'][number]]:ProspectiveEvaluation['cells'][number][K]}[]=[],globalReasons=[...coverage.reasonCodes],diagnostics:Record<string,number|null>={};
 if((to-from)/DAY<d.gates.minimumDays)globalReasons.push('prospective_minimum_days_not_met');if(trialCount===null||d.trialHistory.state==='known-lower-bound')globalReasons.push('prospective_trial_history_unavailable');
 for(const [streamId,entries] of groups){check();const ordered=[...entries].sort((x,y)=>x.slotMs-y.slotMs),first=ordered[0]!,last=ordered.at(-1)!,reasons=[...new Set(ordered.flatMap(r=>r.reasons))];
  if(first.slotMs!==from||last.slotMs!==to||ordered.some((r,i)=>i>0&&(r.slotMs!==ordered[i-1]!.slotMs+DAY||r.previousId!==ordered[i-1]!.id)))reasons.push('prospective_series_gap');
  const completePeriod=first.slotMs===from&&last.slotMs===to&&!reasons.includes('prospective_series_gap');
  const performance=prospectiveBookPerformance(ordered,d.originProfileId),reports=performance.total,report=reports.length===1?reports[0]:undefined,sleeve=performance.sleeve.length===1?performance.sleeve[0]:undefined;
  const value=(key:keyof NonNullable<typeof report>['metrics'])=>report?.metrics[key].state==='available'?report.metrics[key].value:null;
  const daily=[...new Map((report?.points??[]).filter(p=>p.atMs%DAY===0&&p.unitNavUsd!==null).map(p=>[p.atMs,p])).values()];const returns:number[]=[],dates:number[]=[];
  for(let i=1;i<daily.length;i++){if(daily[i]!.atMs!==daily[i-1]!.atMs+DAY||!a(daily[i-1]!.unitNavUsd!).gt(0)){reasons.push('prospective_daily_nav_gap');break;}returns.push(a(daily[i]!.unitNavUsd!).div(daily[i-1]!.unitNavUsd!).sub(1).toNumber());dates.push(daily[i]!.atMs);}
  if(dates.length!==(to-from)/DAY)reasons.push('prospective_daily_nav_gap');
  if(ordered.some(r=>r.book.fills.some(f=>f.postingAtMs>to)))reasons.push('prospective_fee_posting_incomplete');
  const receipts=(purpose:'principal'|'profit')=>d.flows.filter(f=>f.atMs>=from&&f.atMs<=to&&f.evidenceComplete&&(f.kind==='withdrawal'||f.kind==='confirm_outflow')).reduce((s,f)=>{const source=f.kind==='confirm_outflow'?d.flows.find(p=>p.id===f.linkedId):f;return source?.purpose===purpose?s.add(source.userReceiptUsd):s;},a('0'));
  const equity=value('equityUsd'),held=Object.entries(last.book.positions).filter(([,q])=>a(q).gt(0)),positionValues=held.map(([id,q])=>last.closingMarks[id]===undefined?null:a(q).mul(last.closingMarks[id]!)),expenses=d.externalExpenses.filter(e=>e.atMs>=from&&e.atMs<=to).reduce((s,e)=>s.add(e.amountUsd),a('0'));
  metrics.push({streamId,armId:last.armId,capitalUsd:last.capitalUsd,costId:last.costId,observedThroughMs:last.slotMs,financialPeriodComplete:completePeriod,economicPnlUsd:completePeriod?value('economicPnlUsd'):null,remainingEquityUsd:equity,activeEquityUsd:sleeve?.metrics.equityUsd.state==='available'?sleeve.metrics.equityUsd.value:null,activeReturnPct:completePeriod&&sleeve?.metrics.timeWeightedReturnPct.state==='available'?sleeve.metrics.timeWeightedReturnPct.value:null,timeBelowHighPct:completePeriod?value('timeBelowHighPct'):null,principalRecoveryUsd:t(receipts('principal')),profitReceiptsUsd:t(receipts('profit')),concentrationPct:equity===null||!a(equity).gt(0)||positionValues.some(v=>v===null)?null:t(positionValues.reduce<ReturnType<typeof a>>((s,v)=>v!==null&&v.gt(s)?v:s,a('0')).div(equity).mul(100)),floorBreaches:last.floorBreaches-first.floorBreaches,blockedIntentions:last.actions.infeasible-first.actions.infeasible,forgoneCompoundingUsd:null,returnPct:completePeriod?value('timeWeightedReturnPct'):null,drawdownPct:completePeriod?value('maxDrawdownPct'):null,turnoverUsd:t(a(last.turnoverUsd).sub(first.turnoverUsd)),feesUsd:t(a(last.book.fees).sub(first.book.fees)),reservedUsd:last.book.reserved,receiptsUsd:t(a(last.book.receipts).sub(first.book.receipts)),userNetOutcomeUsd:!completePeriod||equity===null?null:t(a(equity).add(last.book.receipts).sub(first.book.receipts).sub(expenses)),modeledActions:last.actions.modeledFrictionBearing-first.actions.modeledFrictionBearing,actualPaperActions:0,reasons:[...new Set(reasons)]});
  if(!reasons.length&&report)series.set(streamId,{dates,returns});
 }
 for(const cell of metrics){const arm=d.arms.find(a=>a.id===cell.armId),reference=metrics.find(m=>m.armId===arm?.controlOf&&m.capitalUsd===cell.capitalUsd&&m.costId===cell.costId);if(reference?.userNetOutcomeUsd!==null&&reference?.userNetOutcomeUsd!==undefined&&cell.userNetOutcomeUsd!==null)cell.forgoneCompoundingUsd=t(a(reference.userNetOutcomeUsd).sub(cell.userNetOutcomeUsd));}
 if(metrics.length===0)globalReasons.push('prospective_books_missing');
 const weighted=(armId:string,costId:string):{dates:number[];returns:number[]}|null=>{
  let result:{dates:number[];returns:number[]}|null=null;
  for(const [capital,w] of Object.entries(d.capitalWeights)){if(!a(w).gt(0))continue;const cell=metrics.find(m=>m.armId===armId&&m.costId===costId&&m.capitalUsd===capital),s=cell?series.get(cell.streamId):null;if(!s)return null;
   if(result&&capitalHash(s.dates)!==capitalHash(result.dates))return null;
   if(!result)result={dates:[...s.dates],returns:s.returns.map(x=>x*Number(w))};else result.returns=result.returns.map((x,i)=>x+s.returns[i]!*Number(w));
  }return result;
 };
 const selectable=d.arms.filter(c=>c.selectable&&c.group==='signal'),candidates=phase==='final'?selectable.filter(c=>c.id===frozen?.candidateId):selectable;
 if(phase==='final'&&(!frozen||frozen.development.registrationId!==registrationId||frozen.development.phase!=='development'||frozen.development.status!=='passed'||frozen.development.candidateId!==frozen.candidateId))throw new Error('prospective_frozen_evidence_mismatch');
 const base=d.costs.find(c=>c.multiplier===1)!,matrix=selectable.map(c=>weighted(c.id,base.id)?.returns??[]);
 const pbo=phase==='final'?frozen!.development.diagnostics['pbo']??null:combinatoriallySymmetricCrossValidation(matrix,d.gates.partitions).probabilityOfBacktestOverfitting;
 diagnostics['pbo']=pbo;diagnostics['trialCount']=trialCount;const survivors:{id:string;score:number}[]=[],candidateFailures:string[]=[];
 for(const candidate of candidates){check();const failures:string[]=[],bounds:number[]=[];
  for(const cost of d.costs){check();const sample=weighted(candidate.id,cost.id);if(!sample){failures.push('matched_nav_unavailable');continue;}
   const cells=metrics.filter(m=>m.armId===candidate.id&&m.costId===cost.id&&a(d.capitalWeights[m.capitalUsd]??'0').gt(0));
   if(cells.some(c=>c.drawdownPct===null||Math.abs(Number(c.drawdownPct))>d.gates.maxDrawdownPct))failures.push('drawdown_gate');
   const actions=d.gates.actionClass==='actual_paper_settled'?0:Math.min(...cells.map(c=>c.modeledActions));diagnostics[`${candidate.id}:${cost.id}:actions`]=actions;if(!Number.isFinite(actions)||actions<d.gates.minimumActions)failures.push('minimum_action_evidence_missing');
   if(sample.returns.length/d.gates.blockDays<d.gates.minEffectiveBlocks)failures.push('effective_blocks_insufficient');
   for(const days of d.gates.rollingDays){const paths:number[]=[];for(let i=days;i<=sample.returns.length;i++)paths.push((sample.returns.slice(i-days,i).reduce((v,r)=>v*(1+r),1)-1)*100);const worst=paths.length?Math.min(...paths):null;diagnostics[`${candidate.id}:${cost.id}:worstRolling${days}Pct`]=worst;if(worst===null||worst<d.gates.minWorstRollingReturnPct)failures.push('worst_rolling_unavailable_or_failed');}
   const sharpe=periodSharpe(sample.returns),shape=moments([...sample.returns]);const dsr=sharpe===null||trialCount===null?null:deflatedSharpeForTrials(sharpe,sample.returns.length,shape.skew,shape.kurt,[...d.trialHistory.sharpeTrials],trialCount);diagnostics[`${candidate.id}:${cost.id}:dsr`]=dsr;
   if(dsr===null||dsr<d.gates.minDsr)failures.push('dsr_unavailable_or_failed');if(pbo===null||pbo>d.gates.maxPbo)failures.push('pbo_unavailable_or_failed');
   const controls=d.arms.filter(c=>c.group==='control'&&['cash','passive','exposure'].includes(c.signal.family));
   if(!['cash','passive','exposure'].every(f=>controls.some(c=>c.signal.family===f)))failures.push('matched_controls_missing');
   for(const control of controls){check();const reference=weighted(control.id,cost.id);if(!reference||capitalHash(reference.dates)!==capitalHash(sample.dates)){failures.push('matched_control_unavailable');continue;}
    const interval=benchmarkRelativeConfidence(sample.returns,reference.returns,{resamples:d.gates.bootstrapResamples,meanBlockLength:d.gates.blockDays,confidenceLevel:1-0.05/Math.max(1,selectable.length*d.costs.length*controls.length),seed:d.gates.seed});
    const low=interval.lowerMeanDailyExcess;diagnostics[`${candidate.id}:${cost.id}:${control.id}:lowerExcess`]=low;if(low===null||low<=d.gates.minExcessPct/100)failures.push('paired_uncertainty_unavailable_or_failed');else bounds.push(low);
    const foldStarts=[from,...d.foldEndsMs.filter(t=>t>from&&t<to)],foldEnds=[...d.foldEndsMs.filter(t=>t>from&&t<to),to];
    for(let n=0;n<foldStarts.length;n++){const indices=sample.dates.flatMap((at,i)=>at>foldStarts[n]!&&at<=foldEnds[n]!?[i]:[]);if(!indices.length||indices.reduce((s,i)=>s+sample.returns[i]!-reference.returns[i]!,0)<=0)failures.push('chronological_fold_gate');}
   }
  }
  if(failures.length)candidateFailures.push(...[...new Set(failures)].map(r=>`${candidate.id}:${r}`));else survivors.push({id:candidate.id,score:Math.min(...bounds)});
 }
 survivors.sort((x,y)=>y.score-x.score||x.id.localeCompare(y.id));const selected=phase==='final'?frozen!.candidateId:survivors[0]?.id??null;
 const choicePassed=selected!==null&&survivors.some(c=>c.id===selected),reasons=[...new Set([...globalReasons,...candidateFailures])];
 // Score only matched primary capital cuts: correlated capital rows do not multiply action samples.
 if(selected){for(const cost of d.costs){const selectedRows=rows.filter(r=>r.armId===selected&&r.costId===cost.id),dates=[...new Set(selectedRows.flatMap(r=>r.edgeScores.map(s=>s.atMs)))].sort((a,b)=>a-b),gross:number[]=[],net:number[]=[];
   for(const at of dates){let g=0,n=0,complete=true;for(const [capital,w] of Object.entries(d.capitalWeights)){if(!a(w).gt(0))continue;const score=selectedRows.find(r=>r.capitalUsd===capital&&r.slotMs===at)?.edgeScores.find(s=>s.atMs===at);if(!score){complete=false;break;}g+=Number(score.grossPct)*Number(w);n+=Number(score.netPct)*Number(w);}if(complete){gross.push(g);net.push(n);}}
   const methodSupported=d.gates.blockDays===7&&d.gates.bootstrapResamples===2000;diagnostics[`${cost.id}:grossEdgeLowerBoundPct`]=methodSupported?forwardEdgeLowerConfidenceBoundPct(gross,d.gates.seed):null;diagnostics[`${cost.id}:netEdgeLowerBoundPct`]=methodSupported?forwardEdgeLowerConfidenceBoundPct(net,d.gates.seed):null;
  }}
 const qualified=phase==='final'&&choicePassed&&!globalReasons.length&&d.costs.every(c=>(diagnostics[`${c.id}:grossEdgeLowerBoundPct`]??0)>0&&(diagnostics[`${c.id}:netEdgeLowerBoundPct`]??0)>0);
 if(phase==='final'&&!qualified)reasons.push('prospective_normalized_paper_edge_unavailable');
 const status:ProspectiveEvaluation['status']=globalReasons.length?'insufficient':choicePassed?'passed':phase==='development'?'none':'failed';
 const coverageInputs={...coverage,asOfMs:0};
 const body={registrationId,phase,inputHash:capitalHash({designId:d.id,rows:rows.map(r=>r.id),coverage:coverageInputs,trialCount,frozen:frozen?.development.id??null}),atMs:Math.min(nowMs,to+d.protocol.latenessMs),candidateId:selected,status,reasons,cells:metrics,diagnostics,sourceHashes:[...new Set(rows.map(r=>r.captureId))],paperQualificationEligible:qualified,liveExecutionPermitted:false as const,orderSubmissionPermitted:false as const};return {...body,id:capitalHash(body)};
}
