import {capitalHash} from '../portfolio/capital-ledger.js';
import {BudgetDecimal as D,budgetAmount as a,budgetText as t,knownNativeRule} from '../execution/native-rules.js';
import {budgetEvidence} from '../execution/account-budget.js';
import {projectAccountBudget,cashClaim} from '../execution/account-budget.js';
import {evaluateCapitalFeasibility,type CapitalFeasibilityInputV1,type FeasibilityIntentV1} from '../execution/capital-feasibility.js';
import {momentumTargets,momentumMinimumHistory} from '../strategies/momentum.js';
import {rotationTargets} from '../strategies/rotation.js';
import {hrpWeights,inverseVolWeights} from '../portfolio/risk-budget.js';
import {volTargetExposure,volTargetMinimumHistory} from '../strategies/vol-target.js';
import type {InstrumentKey} from '../types/index.js';
import {scoreForwardEdgeEvent} from './forward-edge.js';
import {createReplayBook,replayEquity,observeReplayBook,applyReplayFill,replayInvestment,type ReplayBook} from './capital-replay-book.js';
import {applyReplayFlow,replayPerformance} from './capital-replay-accounting.js';
import {replayFillFromOrder} from './capital-replay-execution.js';
import {reservePolicy,reserveValue as v,evaluateProfitReserve,type ReserveFinancialInput} from '../portfolio/profit-reserve.js';
import {reserveBaseline,applyModeledReserve,releaseModeledReserve} from '../portfolio/profit-reserve-state.js';
import {reserveCapitalWitness} from '../portfolio/reserve-capital-witness.js';
import type {ProspectiveDesign,ProspectiveArm,ProspectiveFrame,ProspectiveBookRevision,SerializedReplayBook,ProspectiveEdgePending,ProspectiveEdgeScore} from './capital-prospective-types.js';
import type {ReplayCost,ReplayOpening,ReplayVariant} from './capital-replay-types.js';
import {PROSPECTIVE_DAY as DAY} from './capital-prospective-types.js';
const serialize=(b:ReplayBook):SerializedReplayBook=>({...b,applied:[...b.applied].filter(id=>!b.fills.some(f=>f.id===id)),reasons:[...b.reasons]});
function restore(b:SerializedReplayBook):ReplayBook{const c=JSON.parse(JSON.stringify(b)) as SerializedReplayBook;return {...c,applied:new Set(c.applied),reasons:new Set(c.reasons),events:[],observations:[],financial:[],fills:c.fills.filter(f=>f.postingAtMs>(c.observations.at(-1)?.atMs??0))};}
/** Same immutable FIFO/fee primitives as P4; checkpoint is incremental, never a forged offline spec. */
function targets(d:ProspectiveDesign,c:ProspectiveArm,f:ProspectiveFrame,prior:ProspectiveBookRevision|null):Record<string,string>|null {
 const s=c.signal;if(s.family==='cash')return {};
 if(s.family==='hold'&&prior?.actions.decisions)return null;
 const scheduled=(f.slotMs-s.anchorMs)%(s.cadenceDays*DAY)===0;
 const momentum=s.momentum,config=momentum?(( {lookbackDaysEnsemble,relativeScoreSpreadFloor,...base})=>({...base,...(lookbackDaysEnsemble?{lookbackDaysEnsemble:[...lookbackDaysEnsemble]}:{}),...(relativeScoreSpreadFloor===undefined?{}:{relativeScoreSpreadFloor})}))(momentum):null;
 const required=Math.max(s.lookbackDays+1,s.volatilityDays+1,config?momentumMinimumHistory(config):0,s.volatility?volTargetMinimumHistory(s.volatility):0);
 const through=Math.floor((f.slotMs-s.decisionDelayMs)/DAY)*DAY,h=f.history.filter(h=>h.endMs<=through).slice(-required);
 const needsHistory=!['cash','hold','passive','exposure'].includes(s.family);
 if(needsHistory&&(h.length<required||h.at(-1)?.endMs!==through||h.some(row=>d.assets.some(id=>row.closes[id]===undefined))))throw new Error('prospective_signal_history_missing');
 const prices=Object.fromEntries(d.assets.map(id=>[id,h.map(row=>Number(row.closes[id]))])) as Record<InstrumentKey,number[]>;
 let raw:Record<string,string>={...s.baseWeights};
 if(s.family==='trend')raw=Object.fromEntries(Object.entries(raw).filter(([id])=>a(h.at(-1)!.closes[id]!).gt(h[h.length-1-s.lookbackDays]!.closes[id]!)));
 if(s.family==='rotation'){
  const held=Object.entries(prior?.book.positions??{}).filter(([id,q])=>a(q).gt(0)&&a(q).mul(f.market.assets[id]!.closeUsd!).gte(s.dustUsd)).map(([id])=>id as InstrumentKey);
  const r=rotationTargets(prices,{topN:s.topN,lookbackDays:s.lookbackDays,volatilityDays:s.volatilityDays,absoluteFilter:true,weighting:s.weighting==='hrp'?'equal':s.weighting,holdBufferMultiple:s.buffer},held);
  raw=Object.fromEntries(r.picks.map(p=>[p.assetId,String(p.weight)]));
 }
 if(s.family==='allocator'){if(!config)throw new Error('prospective_signal_configuration_missing');raw=Object.fromEntries(momentumTargets(Object.entries(s.baseWeights).map(([assetId,w])=>({assetId:assetId as InstrumentKey,weight:Number(w)})),prices,config).targets.map(p=>[p.assetId,String(p.weight)]));}
 if(s.family!=='rotation'&&s.weighting!=='equal'||s.weighting==='hrp'){
  const ids=Object.keys(raw).filter(id=>a(raw[id]!).gt(0)).sort();
  if(ids.length){const returns=ids.map(id=>{const xs=prices[id as InstrumentKey]!;return xs.slice(-s.volatilityDays).map((p,i)=>p/xs[xs.length-s.volatilityDays+i-1]!-1);}),weights=s.weighting==='hrp'?hrpWeights(returns):inverseVolWeights(returns),exposure=ids.reduce((v,id)=>v+Number(raw[id]),0);ids.forEach((id,i)=>{raw[id]=String(weights[i]!*exposure);});}
 }
 if(s.volatility){const ids=Object.keys(prices),mix=h.map((_,i)=>ids.reduce((v,id)=>v+prices[id as InstrumentKey]![i]!/prices[id as InstrumentKey]![0]!*Number(s.baseWeights[id]??0),0)),v=volTargetExposure(mix,s.volatility);raw=Object.fromEntries(Object.entries(raw).map(([id,w])=>[id,t(a(w).mul(v.exposure))]));}
 if(!scheduled){const exits=Object.keys(prior?.book.positions??{}).filter(id=>a(prior!.book.positions[id]!).gt(0)&&['trend','rotation'].includes(s.family)&&a(raw[id]??'0').isZero());if(!exits.length)return null;raw=Object.fromEntries(d.assets.map(id=>[id,exits.includes(id)?'0':t(a(prior?.book.positions[id]??'0').mul(f.market.assets[id]!.closeUsd!).div(replayEquity(restore(prior!.book),Object.fromEntries(d.assets.map(k=>[k,f.market.assets[k]!.closeUsd!])))??'1'))]));}

 const cap=D.min(d.policy.maxPositionFraction,d.policy.accountMaxPositionFraction),totalCap=D.min(d.policy.maxInvestedFraction,d.policy.accountMaxInvestedFraction);
 raw=Object.fromEntries(Object.entries(raw).map(([id,w])=>[id,t(D.min(cap,w))]));const sum=Object.values(raw).reduce((n,w)=>n.add(w),new D(0));
 return sum.gt(totalCap)?Object.fromEntries(Object.entries(raw).map(([id,w])=>[id,t(a(w).mul(totalCap).div(sum))])):raw;
}
export function prospectiveExecutionFrame(d:ProspectiveDesign,b:ReplayBook,f:ProspectiveFrame,cost:ReplayCost,usedTurnoverUsd:string,includeReserves=true,intents:readonly FeasibilityIntentV1[]=[]):CapitalFeasibilityInputV1 {
 const marks=Object.fromEntries(d.assets.flatMap(id=>f.market.assets[id]?.openUsd===null?[]:[[id,f.market.assets[id]!.openUsd!]]));
 const fees={id:capitalHash(cost),rate:t(a(cost.feeRate).mul(cost.multiplier)),currency:cost.feeCurrency==='received'?'received' as const:'USD' as const,fixedUsd:cost.fixedUsd,slippageBps:t(a(cost.slippageBps).mul(cost.multiplier)),assurance:'scenario' as const,expiresAtMs:f.market.atMs+30_000};
 const assets=d.assets.map(id=>{const m=f.market.assets[id]!,mid=a(m.openUsd!),wanted=intents.filter(x=>x.assetId===id).reduce((s,x)=>s.add(x.deltaQuantity),new D(0)).abs().mul(mid),impact=mid.mul(cost.impactBps).mul(wanted.div(cost.impactRefUsd).sqrt()).mul(cost.multiplier).div(10_000),spread=mid.mul(cost.spreadBps).mul(cost.multiplier).div(10_000);
  return {assetId:id,markUsd:m.openUsd!,rules:f.rules[id]!,quote:{bid:t(mid.sub(mid.sub(m.bidUsd!).mul(cost.multiplier)).sub(spread).sub(impact)),ask:t(mid.add(a(m.askUsd!).sub(mid).mul(cost.multiplier)).add(spread).add(impact)),atMs:f.market.atMs}};});
 const source=budgetEvidence({scopeId:b.scopeId,bookId:b.scopeId,provider:'local_paper',environment:'simulation',observedAtMs:f.market.atMs,expiresAtMs:f.market.atMs+30_000,cashUsd:b.cash,equityUsd:replayEquity(b,marks),venueEligibleUsd:knownNativeRule(b.cash),positions:{...b.positions},marks,quotes:Object.fromEntries(assets.map(x=>[x.assetId,x.quote])),ruleIds:assets.map(x=>x.rules.id),fees,complete:true,holdMatchingComplete:true,authority:'isolated_book',assurance:'scenario',reasonCodes:[],evidenceRefs:[f.batchHash,'prospective_shadow_simulation']});
 const claims=includeReserves?[['reserve',b.reserved],['tax',b.taxHold]].filter(([,value])=>a(value!).gt(0)).map(([kind,value])=>cashClaim({scopeId:b.scopeId,originKey:kind!,replacesId:null,assetId:'USD',amount:value!,purpose:kind==='reserve'?'profit_reserve':'tax_hold',state:'committed',reflectedIn:[],reflectionEvidence:[],evidenceRefs:[b.scopeId]})):[];
 const budget=projectAccountBudget(source,claims,f.market.atMs);return {budget,expectedRevision:budget.revision,nowMs:f.market.atMs,assets,intents,policy:{...d.policy,usedTurnoverUsd},fees};
}
export function advanceProspectiveBook(d:ProspectiveDesign,registrationId:string,captureId:string,f:ProspectiveFrame,arm:ProspectiveArm,opening:ReplayOpening,cost:ReplayCost,prior:ProspectiveBookRevision|null):ProspectiveBookRevision {
 const streamId=capitalHash({registrationId,armId:arm.id,capitalUsd:opening.capitalUsd,costId:cost.id}),phase=f.slotMs<d.finalStartMs?'development' as const:'final' as const;
 if(prior&&(prior.streamId!==streamId||prior.slotMs+DAY!==f.slotMs))throw new Error('prospective_book_continuity_missing');
 const b=prior?restore(prior.book):createReplayBook(streamId,opening),reasons=[...b.reasons],actions=prior?{...prior.actions}:{decisions:0,abstentions:0,infeasible:0,modeledFrictionBearing:0,actualPaperSettled:0 as const,assessments:0};
 const closing=Object.fromEntries(d.assets.flatMap(id=>f.market.assets[id]?.closeUsd===null?[]:[[id,f.market.assets[id]!.closeUsd!]])),marks=Object.fromEntries(d.assets.flatMap(id=>f.market.assets[id]?.openUsd===null?[]:[[id,f.market.assets[id]!.openUsd!]]));
 if(!prior&&f.slotMs!==d.startMs)throw new Error('prospective_opening_slot_missing');
 if(!prior&&replayEquity(b,closing)!==opening.capitalUsd)reasons.push('prospective_opening_valuation_mismatch');
 observeReplayBook(b,closing,f.slotMs);let turnover=prior?.turnoverUsd??'0',used='0',floorBreaches=prior?.floorBreaches??0,state=prior?.reserveState??null;
 const tradingCut=f.slotMs<d.endMs&&f.slotMs!==d.developmentEndMs&&(f.slotMs<d.developmentEndMs||f.slotMs>=d.finalStartMs);
 const consumed=!!prior?.pendingTargets&&prior.targetAvailableAtMs!==null&&f.market.atMs>prior.targetAvailableAtMs;
 let edgePending:ProspectiveEdgePending|null=null;const edgeScores:ProspectiveEdgeScore[]=[];
 if(prior?.edgePending){const p=prior.edgePending,actual=replayEquity(b,closing),counter=Object.entries(p.positions).reduce((s,[id,q])=>s.add(a(q).mul(closing[id]??'0')),a(p.cashUsd));
  const supported=actual!==null&&Object.keys(p.positions).every(id=>closing[id]!==undefined)&&cost.feePostingLagFrames===0&&a(d.yield.activeDaily).isZero()&&a(d.yield.reserveDaily).isZero()&&!d.flows.some(x=>x.atMs>p.fromMs&&x.atMs<=f.slotMs);
  const score=scoreForwardEdgeEvent({atMs:f.slotMs,turnoverUsd:p.turnoverUsd,actualEndingEquityUsd:actual??'0',noTradeEndingEquityUsd:t(counter),recordedCostUsd:p.costUsd,valuationComplete:supported,stateHash:p.sourceHash});if(score)edgeScores.push({atMs:f.slotMs,grossPct:score.grossEdgePct,netPct:score.netEdgePct,sourceHash:capitalHash({captureId,prior:p.sourceHash})});
 }
 const financial=(atMs:number,kind:ReplayBook['financial'][number]['kind'],flowUsd:string|null,sleeveFlowUsd:string|null,before:string,after:string,feeUsd:string|null,receiptUsd='0',incomeUsd='0')=>b.financial.push({id:capitalHash({streamId,captureId,sequence:b.sequence++}),kind,atMs,flowUsd,sleeveFlowUsd,feeUsd,incomeUsd,receiptUsd,before,after,complete:flowUsd!==null,feeAtMs:atMs});
 if(prior){const interest=D.max(0,a(prior.book.cash).sub(prior.book.reserved).sub(prior.book.taxHold)).mul(d.yield.activeDaily).add(a(prior.book.reserved).mul(d.yield.reserveDaily));if(!interest.isZero()){const flow={id:capitalHash({streamId,captureId,kind:'modeled_yield'}),atMs:f.slotMs,sequence:0,kind:'income' as const,amountUsd:t(interest),feeUsd:'0',userReceiptUsd:'0',purpose:'other' as const,linkedId:null,fromReserve:false,evidenceComplete:true},before=observeReplayBook(b,closing,f.slotMs);applyReplayFlow(b,flow);const after=observeReplayBook(b,closing,f.slotMs);financial(f.slotMs,'income','0','0',before.id,after.id,'0','0',flow.amountUsd);}}
 for(const flow of d.flows.filter(x=>x.atMs<=f.market.atMs&&!b.applied.has(x.id)).sort((x,y)=>x.atMs-y.atMs||x.sequence-y.sequence)){
  const flowMarks=flow.atMs===f.market.atMs?marks:flow.atMs===f.slotMs?closing:{};
  const before=observeReplayBook(b,flowMarks,flow.atMs);let released='0';
  if(flow.fromReserve||flow.kind==='release'){if(!state)throw new Error('replay_outflow_underfunded');state=releaseModeledReserve(state,flow.amountUsd,flow.id,flow.atMs);b.reserved=state.reservedUsd;released=flow.amountUsd;}
  if(flow.kind==='release'){applyReplayFlow(b,{...flow,kind:'internal_transfer'});const after=observeReplayBook(b,flowMarks,flow.atMs);financial(flow.atMs,'internal_transfer','0',released,before.id,after.id,flow.feeUsd);continue;}
  const result=applyReplayFlow(b,flow),after=observeReplayBook(b,flowMarks,flow.atMs);financial(flow.atMs,result.kind,result.externalUsd,result.externalUsd===null?null:t(a(result.externalUsd).add(released)),before.id,after.id,result.feeUsd,result.receiptUsd,flow.kind==='income'?flow.amountUsd:'0');
 }
 if(consumed&&prior?.pendingTargets&&tradingCut){
  const equity=replayEquity(b,marks);if(equity===null)reasons.push('prospective_marks_missing');
  else {
   const active=a(equity).sub(b.reserved).sub(b.taxHold),intents=d.assets.flatMap(id=>{const target=prior.pendingTargets![id]??'0',q=active.mul(target).div(marks[id]!).sub(b.positions[id]??'0'),riskExit=q.lt(0)&&a(target).isZero()&&['trend','rotation'].includes(arm.signal.family);return q.isZero()||!riskExit&&active.gt(0)&&q.abs().mul(marks[id]!).div(active).lte(arm.executionBand)?[]:[{assetId:id,deltaQuantity:t(q),reason:riskExit?'risk_exit' as const:'rebalance' as const,strategyRef:arm.strategyHash}];});
   if(intents.length){const frame=prospectiveExecutionFrame(d,b,f,cost,used,true,intents),result=evaluateCapitalFeasibility(frame);
    if(result.state==='unavailable'||result.riskResiduals.length){actions.infeasible++;reasons.push(...result.reasonCodes,...result.riskResiduals);}else {
     actions.infeasible+=result.blocked.length;let filled=0,edgeTurnover=new D(0),edgeCosts=new D(0);const beforeCash=b.cash,beforePositions={...b.positions};
     for(const order of result.orders){const before=observeReplayBook(b,marks,f.market.atMs),variant={cost} as ReplayVariant,fill=replayFillFromOrder(order,order.quantity,variant,f.market,captureId,b.sequence++);applyReplayFill(b,fill);const after=observeReplayBook(b,marks,f.market.atMs);financial(fill.atMs,'trade','0','0',before.id,after.id,fill.feeUsd);b.financial[b.financial.length-1]!.feeAtMs=fill.postingAtMs;turnover=t(a(turnover).add(fill.notionalUsd));used=t(a(used).add(fill.notionalUsd));edgeTurnover=edgeTurnover.add(fill.notionalUsd);edgeCosts=edgeCosts.add(fill.feeUsd).add(fill.spreadUsd).add(fill.slippageUsd).add(fill.impactUsd);filled++;}
     if(filled){if(edgeCosts.gt(0))actions.modeledFrictionBearing++;edgePending={cashUsd:beforeCash,positions:beforePositions,turnoverUsd:t(edgeTurnover),costUsd:t(edgeCosts),fromMs:f.market.atMs,sourceHash:captureId};}
    }
   }else actions.abstentions++;
  }
 }
 let nextTargets:Record<string,string>|null=null;
 try{if(tradingCut){nextTargets=targets(d,arm,f,prior);if(nextTargets!==null)actions.decisions++;}}catch(error){reasons.push(error instanceof Error?error.message:'prospective_signal_unavailable');}
 const equity=replayEquity(b,marks),investment=replayInvestment(b,marks),pnl=equity===null?null:t(a(equity).sub(b.openingUsd).sub(b.contributions).add(b.outflows));
 const frame=prospectiveExecutionFrame(d,b,f,cost,used,false),req={...frame,intents:nextTargets===null?[]:d.assets.flatMap(id=>{const q=equity===null?a('0'):a(equity).mul(nextTargets[id]??'0').div(marks[id]!).sub(b.positions[id]??'0');return q.isZero()?[]:[{assetId:id,deltaQuantity:t(q),reason:'rebalance' as const,strategyRef:arm.strategyHash}];})};
 const fInput:ReserveFinancialInput={scopeId:b.scopeId,epochId:streamId,fromMs:d.startMs,toMs:f.market.atMs,assurance:'scenario',observedAtMs:f.market.atMs,expiresAtMs:f.market.atMs+30_000,openingEquityUsd:v(b.openingUsd),observedCashUsd:v(b.cash),riskAssetValueUsd:v(equity===null?'0':t(a(equity).sub(b.cash))),sourceCutHash:captureId,trackingLimitations:['Modeled prospective shadow; not account evidence'],economicPnlUsd:pnl===null?investment.unrealized:v(pnl),realizedPnlUsd:investment.realized,unrealizedPnlUsd:investment.unrealized,equityUsd:equity===null?investment.unrealized:v(equity),activeEquityUsd:equity===null?investment.unrealized:v(equity),spendableUsd:v(b.cash),contributionsUsd:v(b.contributions),netOutflowsUsd:v(b.outflows),confirmedReceiptsUsd:v(b.receipts),incomeUsd:v(b.income),feesUsd:b.fills.some(x=>x.postingAtMs>f.market.atMs)?{state:'unavailable',reasonCodes:['fee_accounting_incomplete'],missingEvidence:['fee_accounting_incomplete'],restoration:['Wait for modeled posting time.']}:v(b.fees),completedWins:investment.wins,actualReservedUsd:v(b.reserved),actualTaxHoldUsd:v(b.taxHold),actualPendingUsd:v('0'),priorProfitBackedUsd:v('0'),reasonCodes:[...reasons,...(Object.keys(b.receivables).length?['pending_external_flow_unresolved']:[])],evidenceRefs:[captureId],budgetRevision:frame.budget.revision,generation:0};
 const policy=reservePolicy({scopeId:b.scopeId,originProfileId:d.originProfileId,previousId:null,createdAtMs:d.startMs,settings:arm.reserve});
 if(!state)state=reserveBaseline(policy,null,{...fInput,economicPnlUsd:v('0')},'opening',f.market.atMs);
 if(tradingCut&&arm.reserve.shareBps>0){
  const witness=reserveCapitalWitness(req,'fixed_request'),preview=evaluateProfitReserve(policy,state,fInput,witness,f.market.atMs);
  if(preview.state==='eligible'){const before=observeReplayBook(b,marks,f.market.atMs),result=applyModeledReserve(policy,state,preview,captureId,f.market.atMs);state=result.state;b.reserved=state.reservedUsd;b.taxHold=state.taxHoldUsd;actions.assessments++;const after=observeReplayBook(b,marks,f.market.atMs);financial(f.market.atMs,'internal_transfer','0',t(a(preview.reserveUsd.state==='available'?preview.reserveUsd.value:'0').neg()),before.id,after.id,'0');}
 }
 const risk=evaluateCapitalFeasibility(prospectiveExecutionFrame(d,b,f,cost,used,true));if(risk.riskResiduals.length)reasons.push('prospective_existing_exposure_requires_reconciliation',...risk.riskResiduals);
 if(equity!==null&&a(equity).sub(b.reserved).sub(b.taxHold).lt(arm.reserve.retainedCapitalUsd))floorBreaches++;
 if(tradingCut)observeReplayBook(b,marks,f.market.atMs);for(const r of reasons)b.reasons.add(r);
 // Only current deltas and outstanding fees are retained; reports reconstruct the immutable chain.
 const body={registrationId,streamId,armId:arm.id,capitalUsd:opening.capitalUsd,costId:cost.id,phase,slotMs:f.slotMs,previousId:prior?.id??null,captureId,closingMarks:closing,book:serialize(b),reserveState:state,pendingTargets:nextTargets??(consumed||!tradingCut?null:prior?.pendingTargets??null),targetAvailableAtMs:nextTargets!==null?f.observedAtMs:consumed||!tradingCut?null:prior?.targetAvailableAtMs??null,actions,usedTurnoverUsd:used,turnoverUsd:turnover,floorBreaches,reasons:[...new Set(reasons)],performance:[],sleeve:[],edgePending,edgeScores};
 return {...body,id:capitalHash(body)};
}
export function prospectiveBookPerformance(rows:readonly ProspectiveBookRevision[],profileId:string){
 if(!rows.length)return {total:[],sleeve:[]};const ordered=[...rows].sort((a,b)=>a.slotMs-b.slotMs);const last=ordered.at(-1)!;const b=restore(last.book);
 b.observations=ordered.flatMap(r=>r.book.observations).filter(o=>o.atMs<=last.slotMs).sort((a,b)=>a.atMs-b.atMs||a.sequence-b.sequence);b.financial=ordered.flatMap(r=>r.book.financial).filter(e=>e.atMs<=last.slotMs);return {total:replayPerformance(b,profileId,false),sleeve:replayPerformance(b,profileId,true)};
}
export function unavailableProspectiveBook(registrationId:string,captureId:string,f:ProspectiveFrame,arm:ProspectiveArm,opening:ReplayOpening,cost:ReplayCost,prior:ProspectiveBookRevision|null,reason:string):ProspectiveBookRevision{
 const streamId=capitalHash({registrationId,armId:arm.id,capitalUsd:opening.capitalUsd,costId:cost.id}),b=prior?restore(prior.book):createReplayBook(streamId,opening);b.reasons.add('flow_unverified');observeReplayBook(b,{},f.slotMs);b.observations[b.observations.length-1]!.equityUsd=null;b.observations[b.observations.length-1]!.activeUsd=null;b.observations[b.observations.length-1]!.reasons.push(reason);
 const body={registrationId,streamId,armId:arm.id,capitalUsd:opening.capitalUsd,costId:cost.id,phase:prior?.phase??'development' as const,slotMs:f.slotMs,previousId:prior?.id??null,captureId,closingMarks:{},book:serialize(b),reserveState:prior?.reserveState??null,pendingTargets:null,targetAvailableAtMs:null,actions:{...(prior?.actions??{decisions:0,abstentions:0,infeasible:0,modeledFrictionBearing:0,actualPaperSettled:0 as const,assessments:0}),infeasible:(prior?.actions.infeasible??0)+1},usedTurnoverUsd:'0',turnoverUsd:prior?.turnoverUsd??'0',floorBreaches:prior?.floorBreaches??0,reasons:[reason],performance:[],sleeve:[],edgePending:null,edgeScores:[]};return {...body,id:capitalHash(body)};
}
