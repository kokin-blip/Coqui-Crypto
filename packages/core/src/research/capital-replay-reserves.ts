import { capitalHash } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D, budgetAmount as amount, budgetText as text } from '../execution/native-rules.js';
import { reserveBaseline, openReserveCycle, applyModeledReserve } from '../portfolio/profit-reserve-state.js';
import { reservePolicy, evaluateProfitReserve, reserveValue as value, reserveUnavailable,
  type ReservePolicy, type ReserveState, type ReserveFinancialInput } from '../portfolio/profit-reserve.js';
import { reserveCapitalWitness } from '../portfolio/reserve-capital-witness.js';
import { replayInvestment, replayEquity, type ReplayBook } from './capital-replay-book.js';
import { replayExecutionFrame, type ReplayPendingOrder } from './capital-replay-execution.js';
import type { CapitalReplaySpecV1, ReplayVariant, ReplayCell, ReplayMarketFrame } from './capital-replay-types.js';
import type { FeasibilityIntentV1 } from '../execution/capital-feasibility.js';

export function replayReservePolicy(spec:CapitalReplaySpecV1,v:ReplayVariant,cell:ReplayCell,scopeId:string):ReservePolicy{
  return reservePolicy({scopeId,originProfileId:spec.originProfileId,previousId:null,createdAtMs:v.activationAtMs,
    settings:cell.arm==='policy'?v.reserve:{...v.reserve,goal:'keep_invested',shareBps:0}});
}
export function replayReserveFinancial(book:ReplayBook,spec:CapitalReplaySpecV1,v:ReplayVariant,frame:ReplayMarketFrame,
  marks:Readonly<Record<string,string>>,pending:readonly ReplayPendingOrder[],usedTurnover:string,intents:readonly FeasibilityIntentV1[]){
  const base=replayExecutionFrame(book,spec,v,frame,intents,pending,usedTurnover,false),executable=replayExecutionFrame(book,spec,v,frame,intents,pending,usedTurnover,true);
  const b=base.budget,e=executable.budget,equity=replayEquity(book,marks),investment=replayInvestment(book,marks),reasons=[...book.reasons,...b.reasonCodes];
  if(b.activeEquityUsd!==null&&e.activeEquityUsd!==null&&!amount(b.activeEquityUsd).sub(e.activeEquityUsd).eq(amount(book.reserved).add(book.taxHold)))throw new Error('replay_reserve_double_subtraction');
  if(book.fills.some(f=>f.postingAtMs>frame.atMs))reasons.push('fee_accounting_incomplete');
  if(pending.length)reasons.push('pending_operation_unresolved');
  if(Object.keys(book.receivables).length)reasons.push('external_receipt_pending');
  const eq=equity===null?reserveUnavailable('valuation_missing'):value(equity);
  const economic=equity===null||book.reasons.has('flow_unverified')?reserveUnavailable('financial_history_incomplete'):
    value(text(amount(equity).add(book.outflows).sub(book.openingUsd).sub(book.contributions)));
  const f:ReserveFinancialInput={scopeId:book.scopeId,epochId:capitalHash({scopeId:book.scopeId,start:spec.fromMs}),fromMs:spec.fromMs,toMs:frame.atMs,
    assurance:'scenario',observedAtMs:frame.atMs,expiresAtMs:frame.atMs+30_000,economicPnlUsd:economic,realizedPnlUsd:investment.realized,unrealizedPnlUsd:investment.unrealized,
    openingEquityUsd:value(book.openingUsd),sourceCutHash:capitalHash({event:book.events.at(-1)?.id??null,budget:b.revision}),trackingLimitations:['offline_simulation_not_account_verification'],
    observedCashUsd:value(book.cash),riskAssetValueUsd:equity===null?eq:value(text(Object.entries(book.positions).reduce((s,[id,q])=>s.add(amount(q).mul(marks[id]??0)),new D(0)))),
    equityUsd:eq,activeEquityUsd:eq,spendableUsd:b.spendableUsd===null?reserveUnavailable(...b.reasonCodes):value(b.spendableUsd),
    contributionsUsd:value(book.contributions),netOutflowsUsd:value(book.outflows),confirmedReceiptsUsd:value(book.receipts),incomeUsd:value(book.income),
    feesUsd:reasons.includes('fee_accounting_incomplete')?reserveUnavailable('fee_accounting_incomplete'):value(book.fees),completedWins:investment.wins,
    actualReservedUsd:value('0'),actualTaxHoldUsd:value('0'),actualPendingUsd:value('0'),priorProfitBackedUsd:value('0'),reasonCodes:[...new Set(reasons)].sort(),
    evidenceRefs:[spec.marketTapeHash,spec.decisionTapeHash,b.id,'isolated_virtual_book'],budgetRevision:b.revision,generation:0};
  return {financial:f,frame:base,executable};
}
export function reviewReplayReserve(book:ReplayBook,spec:CapitalReplaySpecV1,v:ReplayVariant,frame:ReplayMarketFrame,marks:Readonly<Record<string,string>>,
  pending:readonly ReplayPendingOrder[],usedTurnover:string,intents:readonly FeasibilityIntentV1[],policy:ReservePolicy,state:ReserveState|null){
  const cut=replayReserveFinancial(book,spec,v,frame,marks,pending,usedTurnover,intents);
  let current=state;
  if(current===null||current.baseline==='awaiting_evidence')current=reserveBaseline(policy,current,cut.financial,capitalHash({scope:book.scopeId,event:'baseline',at:frame.atMs}),frame.atMs);
  current=openReserveCycle(policy,current,cut.financial,capitalHash({scope:book.scopeId,event:'cycle',at:frame.atMs}),frame.atMs);
  const floor=reserveCapitalWitness(cut.frame,v.operatingObjective),preview=evaluateProfitReserve(policy,current,cut.financial,floor,frame.atMs);
  if(preview.state!=='eligible')return {state:current,preview,assessment:null};
  const applied=applyModeledReserve(policy,current,preview,capitalHash({scope:book.scopeId,event:'assess',at:frame.atMs,state:current.id}),frame.atMs);
  return {state:applied.state,preview,assessment:applied.assessment};
}
