import { budgetEvidence, cashClaim, projectAccountBudget, type CashClaimV1 } from '../execution/account-budget.js';
import { evaluateCapitalFeasibility, type CapitalFeasibilityInputV1, type FeasibilityIntentV1, type FeasibleOrderV1 } from '../execution/capital-feasibility.js';
import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, inapplicableNativeRule } from '../execution/native-rules.js';
import { capitalHash } from '../portfolio/capital-ledger.js';
import { replayEquity, type ReplayBook } from './capital-replay-book.js';
import { replayRulesAt } from './capital-replay-tape.js';
import type { CapitalReplaySpecV1, ReplayVariant, ReplayMarketFrame, ReplayFill } from './capital-replay-types.js';

export interface ReplayPendingOrder { id:string; assetId:string; side:'buy'|'sell'; quantity:string; remaining:string;
  dueMs:number|null; cashHold:string; riskExit:boolean; strategyRef:string; fixedPaid:boolean }
export function replayMarks(frame:ReplayMarketFrame,phase:'open'|'close'):Record<string,string>{
  return Object.fromEntries(Object.entries(frame.assets).flatMap(([id,a])=>{const p=phase==='open'?a.openUsd:a.closeUsd;return p===null?[]:[[id,p]];}));
}
export function replayClaims(book:ReplayBook,pending:readonly ReplayPendingOrder[],includeReserves:boolean):CashClaimV1[]{
  const entries=[...(includeReserves?[{id:'profit',assetId:'USD',amount:book.reserved,purpose:'profit_reserve' as const},
    {id:'tax',assetId:'USD',amount:book.taxHold,purpose:'tax_hold' as const}]:[]),
    ...pending.map(p=>({id:p.id,assetId:p.side==='buy'?'USD':p.assetId,amount:p.side==='buy'?p.cashHold:p.remaining,purpose:'order' as const}))];
  return entries.filter(e=>amount(e.amount).gt(0)).map(e=>cashClaim({scopeId:book.scopeId,originKey:e.id,replacesId:null,assetId:e.assetId,
    amount:e.amount,purpose:e.purpose,state:pending.find(p=>p.id===e.id)?.dueMs===null?'unknown':'committed',reflectedIn:[],reflectionEvidence:[],evidenceRefs:['virtual_replay_subset']}));
}
export function replayExecutionFrame(book:ReplayBook,spec:CapitalReplaySpecV1,v:ReplayVariant,frame:ReplayMarketFrame,
  intents:readonly FeasibilityIntentV1[],pending:readonly ReplayPendingOrder[],usedTurnover:string,includeReserves=true,ordersUsed=0):CapitalFeasibilityInputV1{
  const now=frame.atMs,marks=replayMarks(frame,'open'),reasons:string[]=[];
  if(v.cost.feeCurrency==='unsupported')reasons.push('fee_asset_valuation_unsupported');
  if(v.cost.feeBasis!=='execution_notional')reasons.push('fee_basis_unsupported');
  const assets=spec.assets.flatMap(id=>{
    const m=frame.assets[id],rule=spec.rules.filter(r=>r.assetId===id&&now>=r.fromMs&&now<r.toMs);
    if(m?.quoteAtMs!==null&&m?.quoteAtMs!==undefined&&m.quoteAtMs>now)reasons.push('quote_from_future');
    if(!m||m.openUsd===null){reasons.push('market_mark_missing');return [];}
    if(rule.length!==1){reasons.push('native_rule_history_missing_or_conflicting');return [];}
    const mid=amount(m.openUsd),mult=v.cost.multiplier,spread=mid.mul(v.cost.spreadBps).mul(mult).div(10_000);
    const wanted=intents.filter(i=>i.assetId===id).reduce((sum,i)=>sum.add(i.deltaQuantity),new D(0)).abs().mul(mid);
    const impact=mid.mul(v.cost.impactBps).mul(wanted.div(v.cost.impactRefUsd).sqrt()).mul(mult).div(10_000);
    const bid=(m.bidUsd===null?mid.sub(spread):mid.sub(mid.sub(m.bidUsd).mul(mult))).sub(impact),ask=(m.askUsd===null?mid.add(spread):mid.add(amount(m.askUsd).sub(mid).mul(mult))).add(impact);
    if(bid.lte(0)){reasons.push('impact_bound_nonpositive_price');return [];}
    return [{assetId:id,markUsd:m.openUsd,rules:{...replayRulesAt(rule[0]!,now),...(m.tradable?{}:{tradable:false})},
      quote:{bid:text(bid),ask:text(ask),atMs:m.bidUsd===null?now:m.quoteAtMs??0}}];
  });
  const fees={id:capitalHash(v.cost),rate:text(amount(v.cost.feeRate).mul(v.cost.multiplier)),currency:v.cost.feeCurrency==='received'?'received' as const:'USD' as const,
    fixedUsd:v.cost.fixedUsd,slippageBps:text(amount(v.cost.slippageBps).mul(v.cost.multiplier)),assurance:'scenario' as const,expiresAtMs:now+30_000};
  const source=budgetEvidence({scopeId:book.scopeId,bookId:book.scopeId,provider:'local_paper',environment:'simulation',observedAtMs:now,expiresAtMs:now+30_000,
    cashUsd:book.cash,equityUsd:replayEquity(book,marks),venueEligibleUsd:inapplicableNativeRule('virtual_cash_only'),positions:{...book.positions},marks,
    quotes:Object.fromEntries(assets.map(a=>[a.assetId,a.quote])),ruleIds:assets.map(a=>a.rules.id),fees,complete:reasons.length===0,
    holdMatchingComplete:true,authority:'isolated_book',assurance:'scenario',reasonCodes:reasons,evidenceRefs:[spec.marketTapeHash,'scenario_not_account_observation']});
  const budget=projectAccountBudget(source,replayClaims(book,pending,includeReserves),now);
  return {budget,expectedRevision:budget.revision,nowMs:now,assets,intents,policy:{...v.policy,maxOrders:Math.max(0,v.policy.maxOrders-ordersUsed),usedTurnoverUsd:usedTurnover},fees};
}
export function evaluateReplayOrder(input:CapitalFeasibilityInputV1){return evaluateCapitalFeasibility(input);}
export function replayFillFromOrder(order:FeasibleOrderV1,quantity:string,v:ReplayVariant,frame:ReplayMarketFrame,operationId:string,sequence:number,fixedPaid=false):ReplayFill{
  const q=amount(quantity),price=amount(order.executionPriceUsd),notional=q.mul(price),rate=amount(v.cost.feeRate).mul(v.cost.multiplier),fixed=fixedPaid?new D(0):amount(v.cost.fixedUsd);
  const received=v.cost.feeCurrency==='received',fee=notional.mul(rate),mid=amount(frame.assets[order.assetId]!.openUsd!);
  const raw=frame.assets[order.assetId]!,half=raw.bidUsd===null?mid.mul(v.cost.spreadBps).mul(v.cost.multiplier).div(10_000):
    order.side==='buy'?amount(raw.askUsd!).sub(mid).mul(v.cost.multiplier):mid.sub(raw.bidUsd).mul(v.cost.multiplier);
  const adverse=order.side==='buy'?price.sub(mid):mid.sub(price),preSlip=order.side==='buy'?price.div(new D(1).add(amount(v.cost.slippageBps).mul(v.cost.multiplier).div(10_000))):
    price.div(new D(1).sub(amount(v.cost.slippageBps).mul(v.cost.multiplier).div(10_000)));
  const slip=price.sub(preSlip).abs(),impact=D.max(0,adverse.sub(half).sub(slip));
  const body={assetId:order.assetId,atMs:frame.atMs,sequence,side:order.side,quantity:text(q),
    deliveredQuantity:text(order.side==='buy'&&received?q.mul(new D(1).sub(rate)):q),executionPriceUsd:text(price),notionalUsd:text(notional),
    cashDebitUsd:text(order.side==='buy'?notional.add(received?0:fee).add(fixed):fixed),cashCreditUsd:text(order.side==='sell'?notional.sub(fee):new D(0)),
    feeUsd:text(fee.add(fixed)),feeAsset:order.side==='buy'&&received?order.assetId:'USD',feeQuantity:text(order.side==='buy'&&received?q.mul(rate):fee),fixedFeeUsd:text(fixed),
    spreadUsd:text(q.mul(half)),slippageUsd:text(q.mul(slip)),impactUsd:text(q.mul(impact)),postingAtMs:frame.atMs+v.cost.feePostingLagFrames*86_400_000};
  return {...body,id:capitalHash({operationId,...body})};
}
