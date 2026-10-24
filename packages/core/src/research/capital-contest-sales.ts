import {budgetAmount as amount,budgetText as text,BudgetDecimal as D} from '../execution/native-rules.js';
import type {ReplayBook} from './capital-replay-book.js';
import {replayExecutionFrame,evaluateReplayOrder,replayMarks,type ReplayPendingOrder} from './capital-replay-execution.js';
import type {CapitalReplaySpecV1,ReplayVariant,ReplayMarketFrame} from './capital-replay-types.js';
import type {ReservePreview} from '../portfolio/profit-reserve.js';
import type {ContestSaleConsequence} from './capital-contest-types.js';
/** Full-exit diagnostic only; no smallest-sale/lot optimization, funds, journal or order mutation. */
export function contestSaleConsequences(book:ReplayBook,spec:CapitalReplaySpecV1,v:ReplayVariant,preview:ReservePreview,frame:ReplayMarketFrame,pending:readonly ReplayPendingOrder[],usedTurnover:string):ContestSaleConsequence[]{
 const g=preview.freshProfitUsd;if(g.state!=='available'||amount(g.value).lte(0)||v.reserve.shareBps===0)return [];
 const requested=amount(g.value).mul(v.reserve.shareBps).div(10000),cash=preview.caps.cashUsd,realized=preview.caps.realizedUsd;
 if(cash.state==='available'&&realized.state==='available'&&amount(cash.value).gte(requested)&&amount(realized.value).gte(requested))return [];
 return Object.entries(book.positions).filter(([,q])=>amount(q).gt(0)).map(([assetId,quantity])=>{
  const base={previewId:preview.id,assetId,quantity,fundsEligibility:false as const};
  const missing=(...reasonCodes:string[]):ContestSaleConsequence=>({...base,status:'unavailable',notionalUsd:null,modeledCostUsd:null,realizedGainUsd:null,cashAfterUsd:null,residualQuantity:null,evidenceRef:null,reasonCodes});
  const lots=book.lots[assetId]??[];if(!lots.length||lots.some(l=>l.costUsd===null))return missing('sale_basis_unavailable');
  const intent={assetId,deltaQuantity:text(amount(quantity).neg()),reason:'rebalance' as const,strategyRef:'hypothetical_full_exit_only'};
  const input=replayExecutionFrame(book,spec,v,frame,[intent],pending,usedTurnover),result=evaluateReplayOrder({...input,requireFullRequest:true}),order=result.orders[0];
  if(result.state!=='feasible'||!order||!amount(order.quantity).eq(quantity))return missing(...result.reasonCodes,...result.blocked.flatMap(b=>b.reasons),...result.riskResiduals,'full_exit_consequence_unavailable');
  const net=amount(order.cashCreditUsd).sub(order.cashDebitUsd),basis=lots.reduce((s,l)=>s.add(l.costUsd!),new D(0)),mark=replayMarks(frame,'open')[assetId];if(mark===undefined)return missing('sale_mark_unavailable');
  return {...base,status:'hypothetical_full_exit',notionalUsd:order.notionalUsd,modeledCostUsd:text(amount(quantity).mul(mark).sub(net)),realizedGainUsd:text(net.sub(basis)),cashAfterUsd:text(amount(book.cash).add(net)),residualQuantity:text(amount(quantity).sub(order.quantity)),evidenceRef:result.id,reasonCodes:['full-exit diagnostic; not an optimal minimum sale or a reserve funding instruction']};
 });
}
