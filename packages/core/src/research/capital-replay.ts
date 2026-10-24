import { assembleCapitalReplayResult, capitalReplayJsonBytes } from './capital-replay-report.js';
import { capitalHash, type CapitalMetric } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D, budgetAmount as amount, budgetText as text } from '../execution/native-rules.js';
import type { FeasibilityIntentV1 } from '../execution/capital-feasibility.js';
import { reserveBaseline, releaseModeledReserve } from '../portfolio/profit-reserve-state.js';
import { reserveValue, reserveUnavailable, type ReserveState } from '../portfolio/profit-reserve.js';
import { createReplayBook, observeReplayBook, journalReplay, applyReplayFill, replayInvestment, replayEquity, type ReplayFinancialEvent } from './capital-replay-book.js';
import { applyReplayFlow, replayPerformance } from './capital-replay-accounting.js';
import { evaluateReplayOrder, replayExecutionFrame, replayFillFromOrder, replayMarks, type ReplayPendingOrder } from './capital-replay-execution.js';
import { replayReserveFinancial, replayReservePolicy, reviewReplayReserve } from './capital-replay-reserves.js';
import { validateCapitalReplay } from './capital-replay-tape.js';
import { CAPITAL_REPLAY_DAY as DAY, type CapitalReplaySpecV1, type CapitalReplayTapeV1,
  type CapitalReplayResultV1, type ReplayCell, type ReplayCellResult, type ReplayTrace, type ReplayMarketFrame } from './capital-replay-types.js';

export interface ReplayRunControl { readonly check?:()=>void }
/** One independent virtual book. No network, database, order writer or registration capability. */
export function replayCapitalCell(spec:CapitalReplaySpecV1,tape:CapitalReplayTapeV1,cell:ReplayCell,control:ReplayRunControl={}):ReplayCellResult{
  const v=spec.variants.find(v=>v.id===cell.variantId)!,opening=spec.openings.find(o=>o.capitalUsd===cell.capitalUsd)!;
  const scopeId=capitalHash({spec:capitalHash(spec),cell}),book=createReplayBook(scopeId,opening),policy=replayReservePolicy(spec,v,cell,scopeId);
  const fills=book.fills,events=book.events,traces:ReplayTrace[]=[],feasibility:ReplayCellResult['feasibility'][number][]=[],previews:ReplayCellResult['reservePreviews'][number][]=[],assessments:ReplayCellResult['assessments'][number][]=[];
  const pending:ReplayPendingOrder[]=[],appliedFlows=new Set<string>(),reasons=new Set<string>();
  let state:ReserveState|null=null,turnover='0',usedTurnover=v.policy.usedTurnoverUsd,window=-1,requestedOrders=0,blockedOrders=0,floorBreaches=0,heldOnce=false;
  let yieldActiveBase='0',yieldReserveBase='0',completedThrough=spec.fromMs;let executionFailed=false;
  let targets:Readonly<Record<string,string>>={},lastMarks:Record<string,string>={},desired:Record<string,string>={};
  const financial=(frame:ReplayMarketFrame,kind:ReplayFinancialEvent['kind'],flow:string|null,sleeve:string|null,fee:string|null,income:string,receipt:string,before:string,sourceId:string,feeAtMs=frame.atMs)=>{
    const after=observeReplayBook(book,replayMarks(frame,'open'),frame.atMs);
    book.financial.push({id:capitalHash({scopeId,sourceId,sequence:book.sequence}),kind,atMs:frame.atMs,flowUsd:flow,sleeveFlowUsd:sleeve,
      feeUsd:fee,incomeUsd:income,receiptUsd:receipt,before,after:after.id,complete:flow!==null,feeAtMs});
  };
  const release=(frame:ReplayMarketFrame,dollars:string,key:string)=>{
    if(!state)throw new Error('replay_reserve_not_initialized');
    const before=observeReplayBook(book,replayMarks(frame,'open'),frame.atMs);
    state=releaseModeledReserve(state,dollars,key,frame.atMs);book.reserved=state.reservedUsd;
    journalReplay(book,frame.atMs,'modeled_release',key,'H and cumulative allocation unchanged');financial(frame,'internal_transfer','0',dollars,'0','0','0',before.id,key);
  };
  const accrue=(frame:ReplayMarketFrame,activeCash:string,reserveCash:string,days:number)=>{
    const income=amount(activeCash).mul(new D(1).add(v.activeDailyYield).pow(days).sub(1)).add(amount(reserveCash).mul(new D(1).add(v.reserveDailyYield).pow(days).sub(1)));
    if(income.lte(0))return;
    const before=observeReplayBook(book,replayMarks(frame,'open'),frame.atMs);book.cash=text(amount(book.cash).add(income));book.income=text(amount(book.income).add(income));
    const key=capitalHash({scopeId,yield:frame.atMs,days});journalReplay(book,frame.atMs,'modeled_interest',key,'Cash subsets accrued once; interest credited to active cash, tax-hold yield zero');financial(frame,'income','0','0','0',text(income),'0',before.id,key);
  };
  const intentsFor=(marks:Record<string,string>,priority:readonly string[],riskExits:readonly string[],ref:string):FeasibilityIntentV1[]=>{
    const equity=replayEquity(book,marks);if(equity===null)return [];
    const active=amount(equity).sub(book.reserved).sub(book.taxHold);desired={};
    return priority.flatMap(id=>{
      if(marks[id]===undefined){if(amount(targets[id]??'0').gt(0)||amount(book.positions[id]??'0').gt(0))reasons.add('market_mark_missing');return [];}
      const q=D.max(0,active).mul(targets[id]??'0').div(marks[id]!).sub(book.positions[id]??'0');desired[id]=text(q);
      return q.isZero()?[]:[{assetId:id,deltaQuantity:text(q),reason:riskExits.includes(id)?'risk_exit' as const:q.lt(0)?'rebalance' as const:'entry' as const,strategyRef:ref}];
    });
  };
  const trace=(frame:ReplayMarketFrame,phase:'open'|'close')=>{
    const marks=replayMarks(frame,phase),equity=replayEquity(book,marks),active=equity===null?null:amount(equity).sub(book.reserved).sub(book.taxHold);
    const budget=replayExecutionFrame(book,spec,v,{...frame,assets:Object.fromEntries(Object.entries(frame.assets).map(([id,a])=>[id,{...a,openUsd:phase==='close'?a.closeUsd:a.openUsd}]))},[],pending,usedTurnover).budget;
    let maximum=new D(0),drift=new D(0);
    if(active?.gt(0))for(const id of spec.assets){if(marks[id]===undefined&&amount(book.positions[id]??'0').gt(0))continue;
      const w=amount(book.positions[id]??'0').mul(marks[id]??0).div(active);maximum=D.max(maximum,w);drift=drift.add(w.sub(targets[id]??'0').abs());}
    const obs=observeReplayBook(book,marks,phase==='open'?frame.atMs:frame.endMs);
    traces.push({atMs:obs.atMs,phase,equityUsd:equity,activeUsd:active===null?null:text(active),cashUsd:book.cash,spendableUsd:budget.spendableUsd,
      reservedUsd:book.reserved,taxHoldUsd:book.taxHold,pendingUsd:text(Object.values(book.receivables).reduce((sum,r)=>sum.add(r.amount),new D(0))),
      positions:{...book.positions},targets:{...targets},desired:{...desired},maximumWeight:active?.gt(0)?text(maximum):null,drift:active?.gt(0)?text(drift):null,
      reasonCodes:[...budget.reasonCodes,...obs.reasons]});
    if(budget.reasonCodes.includes('budget_underfunded')){reasons.add('reserve_or_order_underfunded');journalReplay(book,obs.atMs,'modeled_incident',obs.id,'Underfunded claims retained; new allocations blocked');}
    if(active!==null&&active.lt(v.reserve.retainedCapitalUsd)&&amount(book.reserved).gt(0))floorBreaches++;
  };
  const fill=(frame:ReplayMarketFrame,intent:FeasibilityIntentV1,key:string,fraction:string,delay:number|null,ordersUsed:number,existing:ReplayPendingOrder|null)=>{
    const costVariant=existing?.fixedPaid?{...v,cost:{...v.cost,fixedUsd:'0'}}:v;
    const input=replayExecutionFrame(book,spec,costVariant,frame,[intent],pending.filter(p=>p!==existing),usedTurnover,true,ordersUsed);
    const report=evaluateReplayOrder(input);feasibility.push(report);
    if(report.state==='unavailable')for(const r of report.reasonCodes)reasons.add(r);
    for(const residual of report.riskResiduals)reasons.add(residual);
    const candidate=report.orders[0];
    const order=candidate?.side==='buy'&&report.riskResiduals.length?undefined:candidate;
    if(!order){blockedOrders++;journalReplay(book,frame.atMs,'blocked_intention',key,[...report.reasonCodes,...report.blocked.flatMap(b=>b.reasons),...report.riskResiduals].join(','));return 0;}
    const rule=input.assets.find(a=>a.assetId===order.assetId)!.rules;
    const inc=amount(rule.quantityIncrement.state==='known'?rule.quantityIncrement.value:'1');
    const q=amount(order.quantity).mul(fraction).div(inc).floor().mul(inc);
    let didFill=0,actualDebit=new D(0);
    if(q.gt(0)){
      const before=observeReplayBook(book,replayMarks(frame,'open'),frame.atMs),f=replayFillFromOrder(order,text(q),costVariant,frame,key,book.sequence,existing?.fixedPaid??false);
      applyReplayFill(book,f);actualDebit=amount(f.cashDebitUsd);turnover=text(amount(turnover).add(f.notionalUsd));usedTurnover=text(amount(usedTurnover).add(f.notionalUsd));
      financial(frame,'trade','0','0',f.feeUsd,'0','0',before.id,f.id,f.postingAtMs);didFill=1;
    }
    const rest=existing?amount(existing.remaining).sub(q):amount(order.quantity).sub(q);
    if(existing){existing.remaining=text(rest);existing.fixedPaid ||= didFill>0;if(rest.lte(0))pending.splice(pending.indexOf(existing),1);else existing.dueMs=null;}
    else if(rest.gt(0))pending.push({id:key,assetId:intent.assetId,side:order.side,quantity:order.quantity,remaining:text(rest),
      dueMs:delay===null?null:frame.atMs+Math.max(1,delay)*DAY,cashHold:order.side==='buy'?text(D.max(0,amount(order.cashDebitUsd).sub(actualDebit))):'0',
      riskExit:intent.reason==='risk_exit',strategyRef:intent.strategyRef,fixedPaid:didFill>0});
    return 1;
  };
  try{
    const first=tape.market[0]!,initialMarks=first.atMs===spec.fromMs?replayMarks(first,'open'):{};
    const initial=observeReplayBook(book,initialMarks,spec.fromMs);
    if(initial.equityUsd!==null&&!amount(initial.equityUsd).eq(opening.capitalUsd))throw new Error('replay_opening_equity_mismatch');
    if(initial.equityUsd===null)reasons.add('opening_valuation_missing');
    for(const [index,frame] of tape.market.entries()){
      control.check?.();
      if(v.flows.some(f=>f.atMs<frame.atMs&&!appliedFlows.has(f.id)))book.reasons.add('flow_unverified');
      const marks=replayMarks(frame,'open');lastMarks=replayMarks(frame,'close');
      const win=Math.floor((frame.atMs-spec.fromMs)/v.turnoverWindowMs);if(win!==window){usedTurnover=v.policy.usedTurnoverUsd;window=win;}
      if(index>0){const missingDays=(frame.atMs-tape.market[index-1]!.endMs)/DAY;if(missingDays>0)accrue(frame,yieldActiveBase,yieldReserveBase,missingDays);}
      let ordersUsed=0;
      for(const p of [...pending])if(p.dueMs!==null&&p.dueMs<=frame.atMs){
        const result=fill(frame,{assetId:p.assetId,deltaQuantity:text(amount(p.remaining).mul(p.side==='buy'?1:-1)),reason:p.riskExit?'risk_exit':p.side==='buy'?'entry':'rebalance',strategyRef:p.strategyRef},p.id,'1',null,ordersUsed,p);
        ordersUsed+=result;if(!result)p.dueMs=null;
      }
      if(state===null&&frame.atMs>=v.activationAtMs){const f=replayReserveFinancial(book,spec,v,frame,marks,pending,usedTurnover,[]).financial;
        state=reserveBaseline(policy,null,f,capitalHash({scopeId,baseline:frame.atMs}),frame.atMs);}
      for(const flow of [...v.flows].filter(f=>f.atMs===frame.atMs).sort((a,b)=>a.sequence-b.sequence)){
        if(appliedFlows.has(flow.id))continue;
        if(flow.kind==='release'){release(frame,flow.amountUsd,flow.id);appliedFlows.add(flow.id);continue;}
        if(flow.fromReserve)release(frame,text(amount(flow.amountUsd).add(flow.feeUsd)),`${flow.id}:release`);
        const before=observeReplayBook(book,marks,frame.atMs),result=applyReplayFlow(book,flow);appliedFlows.add(flow.id);
        if(!flow.evidenceComplete)book.reasons.add('flow_unverified');
        journalReplay(book,frame.atMs,`simulated_${flow.kind}`,flow.id,`${flow.purpose}; no real transfer`);
        financial(frame,result.kind,result.externalUsd,result.externalUsd,result.feeUsd,flow.kind==='income'?flow.amountUsd:'0',result.receiptUsd,before.id,flow.id);
      }
      const decision=tape.decisions.find(d=>d.executionAtMs===frame.atMs);
      let scheduled=false,priority:readonly string[]=spec.assets,riskExits:readonly string[]=[];
      if(cell.arm==='cash'){targets={};scheduled=index===0&&Object.values(book.positions).some(q=>amount(q).gt(0));}
      else if(cell.arm==='hold'||cell.arm==='passive'){targets=spec.benchmarkWeights;scheduled=cell.arm==='hold'?!heldOnce:index%spec.passiveCadenceFrames===0;}
      else if(decision){priority=decision.priority;riskExits=decision.riskExits;if(decision.status==='targets'||decision.status==='abstain'){targets=decision.targets;scheduled=true;}}
      const intents=scheduled?intentsFor(marks,priority,riskExits,decision?.id??`${cell.arm}:${frame.atMs}`):[];
      if(scheduled){heldOnce=true;requestedOrders+=intents.length;
        for(const intent of [...intents].sort((a,b)=>Number(amount(a.deltaQuantity).gt(0))-Number(amount(b.deltaQuantity).gt(0)))){
          if(pending.some(p=>p.assetId===intent.assetId)){blockedOrders++;journalReplay(book,frame.atMs,'blocked_pending',intent.strategyRef,'Pending/unknown order retains its hold');continue;}
          const model=cell.arm==='policy'||cell.arm==='reinvest'?decision?.fill:{fraction:'1',delayFrames:0};
          const fraction=model?.delayFrames===0?model.fraction:'0';
          ordersUsed+=fill(frame,intent,capitalHash({scopeId,decision:intent.strategyRef,asset:intent.assetId}),fraction??'1',model?model.delayFrames:0,ordersUsed,null);
        }
      }
      const cadence=v.reserve.cadence==='daily'?DAY:v.reserve.cadence==='weekly'?7*DAY:v.reserve.cadence==='monthly'?30*DAY:null;
      const due=frame.atMs>=v.activationAtMs&&(cadence===null?v.reviewAtMs.includes(frame.atMs):(frame.atMs-v.activationAtMs)%cadence===0);
      if(due&&state){
        const before=observeReplayBook(book,marks,frame.atMs),beforeReserved=amount(book.reserved).add(book.taxHold);
        const review=reviewReplayReserve(book,spec,v,frame,marks,pending,usedTurnover,intents,policy,state);state=review.state;previews.push(review.preview);
        if(review.assessment){assessments.push(review.assessment);book.reserved=state.reservedUsd;book.taxHold=state.taxHoldUsd;
          journalReplay(book,frame.atMs,'modeled_assessment',review.assessment.id,'Reserve is a cash subset, not a receipt');
          const moved=amount(book.reserved).add(book.taxHold).sub(beforeReserved);financial(frame,'internal_transfer','0',text(moved.neg()),'0','0','0',before.id,review.assessment.id);}
      }
      const diagnostic=evaluateReplayOrder(replayExecutionFrame(book,spec,v,frame,[],pending,usedTurnover));
      feasibility.push(diagnostic);for(const r of [...diagnostic.riskResiduals,...(diagnostic.state==='unavailable'?diagnostic.reasonCodes:[])])reasons.add(r);
      trace(frame,'open');
      const closing={...frame,atMs:frame.endMs,assets:Object.fromEntries(Object.entries(frame.assets).map(([id,a])=>[id,{...a,openUsd:a.closeUsd}]))};
      accrue(closing,text(D.max(0,amount(book.cash).sub(book.reserved).sub(book.taxHold))),book.reserved,1);
      trace(frame,'close');
      yieldActiveBase=text(D.max(0,amount(book.cash).sub(book.reserved).sub(book.taxHold)));yieldReserveBase=book.reserved;completedThrough=frame.endMs;
    }
    for(const flow of v.flows)if(!appliedFlows.has(flow.id)){reasons.add('flow_time_mark_unavailable');book.reasons.add('flow_unverified');journalReplay(book,flow.atMs,'unapplied_flow',flow.id,'No supported flow-time mark; dependent metrics unavailable');}
    for(const d of tape.decisions)if(!tape.market.some(f=>f.atMs===d.executionAtMs)){reasons.add('decision_market_gap');journalReplay(book,d.executionAtMs,'blocked_missing_frame',d.id,'Decision not executed; no interpolated market');}
  }catch(error){executionFailed=true;book.reasons.add('execution_history_incomplete');reasons.add(error instanceof Error?error.message:'replay_cell_failure');}
  if(pending.length)reasons.add('pending_order_unresolved');
  const terminal=tape.market.at(-1)!;if(terminal.endMs!==spec.toMs){lastMarks={};observeReplayBook(book,{},spec.toMs);reasons.add('terminal_mark_missing');}
  const equity=executionFailed||book.reasons.has('flow_unverified')||completedThrough!==spec.toMs?null:replayEquity(book,lastMarks),active=equity===null?null:text(amount(equity).sub(book.reserved).sub(book.taxHold));
  const totalPerformance=replayPerformance(book,spec.originProfileId,false),sleevePerformance=replayPerformance(book,spec.originProfileId,true),investment=replayInvestment(book,lastMarks);
  const externalExpense=text(v.externalExpenses.reduce((s,e)=>s.add(e.amountUsd),new D(0)));
  const metric=(value:string|null,method:string):CapitalMetric=>value===null?reserveUnavailable('valuation_missing'):{...reserveValue(value,[scopeId]),method};
  const economic=equity===null||book.reasons.has('flow_unverified')?null:text(amount(equity).add(book.outflows).sub(book.openingUsd).sub(book.contributions));
  const metrics:Record<string,CapitalMetric>={...(totalPerformance[0]?.metrics??{}),realizedPnlUsd:investment.realized,unrealizedPnlUsd:investment.unrealized,
    economicPnlUsd:metric(economic,'capital-replay-equity-minus-external-capital-v1'),activeEquityUsd:metric(active,'virtual-active-equity'),completedWins:investment.wins};
  metrics['equityUsd']=metric(equity,'virtual-total-managed-equity');
  metrics['balanceChangeUsd']=metric(equity===null?null:text(amount(equity).sub(book.openingUsd)),'raw-equity-change-not-investment-profit');
  for(const [key,value] of Object.entries({contributionsUsd:book.contributions,netOutflowsUsd:book.outflows,confirmedUserReceiptsUsd:book.receipts,feesUsd:book.fees,incomeUsd:book.income}))metrics[key]=metric(value,'simulated-capital-ledger');
  metrics['sleeveTimeWeightedReturnPct']=sleevePerformance.length===1?sleevePerformance[0]!.metrics.timeWeightedReturnPct:reserveUnavailable('multiple_capital_return_segments');
  if(totalPerformance.length!==1||totalPerformance[0]?.fromMs!==spec.fromMs||totalPerformance[0]?.toMs!==spec.toMs)
    for(const key of ['timeWeightedReturnPct','annualizedReturnPct','moneyWeightedReturnPct','maxDrawdownPct','volatilityPct','sharpe','sortino','calmar','timeBelowHighPct'])metrics[key]=reserveUnavailable('multiple_or_incomplete_capital_return_segments');
  if(book.reasons.has('flow_unverified'))for(const key of ['equityUsd','balanceChangeUsd','activeEquityUsd','contributionsUsd','netOutflowsUsd','confirmedUserReceiptsUsd','feesUsd','incomeUsd','economicPnlUsd','timeWeightedReturnPct','sleeveTimeWeightedReturnPct','moneyWeightedReturnPct','annualizedReturnPct','maxDrawdownPct','volatilityPct','sharpe','sortino','calmar','timeBelowHighPct'])metrics[key]=reserveUnavailable('financial_history_incomplete');
  const sum=(key:'feeUsd'|'spreadUsd'|'slippageUsd'|'impactUsd')=>text(fills.reduce((s,f)=>s.add(f[key]),new D(0)));
  const summary={endingEquityUsd:equity,activeUsd:active,reservedUsd:book.reserved,taxHoldUsd:book.taxHold,receiptsUsd:book.receipts,contributionsUsd:book.contributions,outflowsUsd:book.outflows,
    turnoverUsd:turnover,feesUsd:book.fees,spreadUsd:sum('spreadUsd'),slippageUsd:sum('slippageUsd'),impactUsd:sum('impactUsd'),externalExpenseUsd:externalExpense,
    userNetOutcomeUsd:equity===null?null:text(amount(equity).add(book.receipts).sub(externalExpense)),requestedOrders,blockedOrders,executedFills:fills.length,floorBreaches};
  if(book.fills.some(f=>f.postingAtMs>spec.toMs))metrics['feesUsd']=reserveUnavailable('fee_accounting_incomplete');
  const codes=[...new Set([...reasons,...book.reasons])].sort();
  const unavailable=equity===null||codes.some(c=>!c.startsWith('position_limit:')&&!['invested_limit','pending_order_unresolved'].includes(c));
  const body={cell,scopeId,state:unavailable?'unavailable' as const:blockedOrders||codes.length?'infeasible' as const:'complete' as const,reasonCodes:codes,
    fills,events,traces,feasibility,reservePreviews:previews,assessments,reserveState:state,totalPerformance,sleevePerformance,metrics,summary};
  return {...body,id:capitalHash(body)};
}
export function replayCapitalPath(spec:CapitalReplaySpecV1,tape:CapitalReplayTapeV1,control:ReplayRunControl={}):CapitalReplayResultV1{
  validateCapitalReplay(spec,tape);const cells:ReplayCellResult[]=[];let size=0;
  for(const cell of spec.cells){control.check?.();const result=replayCapitalCell(spec,tape,cell,control);control.check?.();size+=capitalReplayJsonBytes(result);if(size>64*1024*1024)throw new Error('replay_output_bound');cells.push(result);}
  return assembleCapitalReplayResult(spec,cells);
}
