import { calculateCapitalPerformance, type CapitalPerformanceReport } from '../portfolio/capital-performance.js';
import { capitalHash, type CapitalEventRevision, type CapitalValuation, type CapitalSourceBatch } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D, budgetAmount as amount, budgetText as text } from '../execution/native-rules.js';
import type { ReplayBook, ReplayFinancialEvent, ReplayObservation } from './capital-replay-book.js';
import type { ReplayFlow } from './capital-replay-types.js';

export function applyReplayFlow(book:ReplayBook,flow:ReplayFlow):{externalUsd:string|null;feeUsd:string;receiptUsd:string;kind:ReplayFinancialEvent['kind']} {
  const a=amount(flow.amountUsd),fee=amount(flow.feeUsd);let external=new D(0),receipt=new D(0),kind:ReplayFinancialEvent['kind']='internal_transfer';
  if(book.applied.has(flow.id))throw new Error('replay_duplicate_flow_application');
  if(!flow.evidenceComplete){book.reasons.add('flow_unverified');book.applied.add(flow.id);return {externalUsd:null,feeUsd:'0',receiptUsd:'0',kind:'unknown'};}
  const credit=flow.kind==='contribution'||flow.kind==='income'||flow.kind==='reverse_outflow'?a:new D(0);
  const debit=flow.kind==='withdrawal'||flow.kind==='pending_outflow'||flow.kind==='fee_adjustment'?a:new D(0);
  if(amount(book.cash).add(credit).sub(debit).sub(fee).lt(0))throw new Error('replay_outflow_underfunded');
  if(flow.kind==='contribution'){book.cash=text(amount(book.cash).add(a).sub(fee));book.contributions=text(amount(book.contributions).add(a));external=a;kind='contribution';}
  else if(flow.kind==='withdrawal'||flow.kind==='pending_outflow'){
    if(amount(book.cash).lt(a.add(fee)))throw new Error('replay_outflow_underfunded');
    book.cash=text(amount(book.cash).sub(a).sub(fee));
    if(flow.kind==='pending_outflow')book.receivables[flow.id]={amount:flow.amountUsd,receipt:flow.userReceiptUsd,known:flow.evidenceComplete};
    else{external=a.neg();receipt=amount(flow.userReceiptUsd);kind='outflow';}
  }else if(flow.kind==='confirm_outflow'||flow.kind==='reverse_outflow'){
    const r=flow.linkedId===null?undefined:book.receivables[flow.linkedId];
    if(!r||!a.eq(r.amount))throw new Error('replay_pending_leg_unmatched');
    if(flow.kind==='confirm_outflow'){external=a.neg();receipt=amount(r.receipt);kind='outflow';}
    else book.cash=text(amount(book.cash).add(a));
    book.cash=text(amount(book.cash).sub(fee));book.receivables=Object.fromEntries(Object.entries(book.receivables).filter(([key])=>key!==flow.linkedId));
  }else if(flow.kind==='income'){book.cash=text(amount(book.cash).add(a).sub(fee));book.income=text(amount(book.income).add(a));kind='income';}
  else if(flow.kind==='fee_adjustment'){book.cash=text(amount(book.cash).sub(a).sub(fee));kind='fee';}
  else if(flow.kind==='internal_transfer')book.cash=text(amount(book.cash).sub(fee));
  if(amount(book.cash).lt(0))throw new Error('replay_negative_cash');
  const charged=fee.add(flow.kind==='fee_adjustment'?a:0);
  book.fees=text(amount(book.fees).add(charged));book.standaloneFees=text(amount(book.standaloneFees).add(charged));
  if(external.lt(0))book.outflows=text(amount(book.outflows).sub(external));book.receipts=text(amount(book.receipts).add(receipt));
  book.applied.add(flow.id);
  return {externalUsd:flow.evidenceComplete?text(external):null,feeUsd:text(charged),receiptUsd:text(receipt),kind:flow.evidenceComplete?kind:'unknown'};
}
/** Scenario evidence stays in memory/the research artifact; no observed capital rows are written. */
export function replayPerformance(book:ReplayBook,originProfileId:string,sleeve:boolean):CapitalPerformanceReport[] {
  const scopeId=capitalHash({scopeId:book.scopeId,sleeve}),scope={id:scopeId,provider:'local_paper' as const,environment:'simulation' as const,
    accountIdentityHash:scopeId,currency:'USD' as const,originProfileId,createdAtMs:book.observations[0]?.atMs??0};
  const obs=book.observations;
  if(!obs.length)return [];
  const batchBody={scopeId,source:'capital-replay-scenario',requestedAtMs:obs[0]!.atMs,observedAtMs:obs.at(-1)!.atMs,recordedAtMs:obs.at(-1)!.atMs,
    coverage:{fromMs:obs[0]!.atMs,toMs:obs.at(-1)!.atMs,complete:true,paginationComplete:true,membershipComplete:true,reasonCodes:[]},
    memberIdentityHashes:[scopeId],evidenceRefs:[book.scopeId],payload:{assurance:'scenario'}};
  const batch:CapitalSourceBatch={...batchBody,id:capitalHash(batchBody)};
  const map=(o:ReplayObservation):CapitalValuation=>({id:capitalHash({id:o.id,sleeve}),scopeId,sourceBatchId:batch.id,replacesId:null,atMs:o.atMs,
    sequence:o.sequence,observedAtMs:o.atMs,equityUsd:sleeve?o.activeUsd:o.equityUsd,cashUsd:o.cashUsd,legs:[],verified:(sleeve?o.activeUsd:o.equityUsd)!==null,
    missingComponents:o.reasons,evidenceRefs:[o.id,'simulated_not_observed_account']});
  const valuations=obs.map(map),byId=new Map(obs.map((o,i)=>[o.id,valuations[i]!]));
  const events:CapitalEventRevision[]=book.financial.map(e=>{
    const flow=sleeve?e.sleeveFlowUsd:e.flowUsd;
    const body={scopeId,sourceBatchId:batch.id,logicalKey:e.id,revisionHash:e.id,replacesId:null,correctionAuthority:null,
      kind:e.kind,status:e.complete?'confirmed' as const:'pending' as const,effectiveTime:{precision:'instant' as const,fromMs:e.atMs,toMs:e.atMs},observedAtMs:e.atMs,recordedAtMs:e.atMs,
      legs:[],externalFlowUsd:flow,flowVerified:e.complete&&flow!==null,confirmedUserReceiptUsd:e.receiptUsd,feeUsd:e.feeAtMs>obs.at(-1)!.atMs?null:e.feeUsd,incomeUsd:e.incomeUsd,
      beforeValuationId:byId.get(e.before)?.id??null,afterValuationId:byId.get(e.after)?.id??null,evidenceRefs:[e.id,'simulation'],reasonCodes:e.complete?[]:['simulated_evidence_incomplete']};
    return {...body,id:capitalHash(body)};
  });
  // A genuine zero NAV or full redemption ends a return segment. Funding restarts a linked segment.
  const segments:CapitalValuation[][]=[];let current:CapitalValuation[]=[];
  for(const v of valuations){
    if(!current.length){if(v.equityUsd!==null&&amount(v.equityUsd).gt(0)||!segments.length)current.push(v);}
    else current.push(v);
    if(v.equityUsd!==null&&amount(v.equityUsd).isZero()&&current.length){segments.push(current);current=[];}
  }
  if(current.length)segments.push(current);
  return segments.map((rows,index)=>{
    const epoch={id:capitalHash({scopeId,start:rows[0]!.id,index}),scopeId,openingValuationId:rows[0]!.id,
      predecessorId:index?capitalHash({scopeId,start:segments[index-1]![0]!.id,index:index-1}):null,
      reason:index?'capital_restarted' as const:'verified_origin' as const,historicalLimitations:['simulated_development_only']};
    return calculateCapitalPerformance({scope,epoch,batches:[batch],events,valuations:rows,fromMs:rows[0]!.atMs,toMs:rows.at(-1)!.atMs});
  });
}
