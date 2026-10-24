import { BudgetDecimal as D, budgetAmount as amount, budgetText as text } from '../execution/native-rules.js';
import { capitalHash, type CapitalMetric } from '../portfolio/capital-ledger.js';
import { reserveUnavailable, reserveValue } from '../portfolio/profit-reserve.js';
import type { CapitalReplayEventV1, ReplayFill, ReplayOpening } from './capital-replay-types.js';

export interface ReplayLot { quantity: string; costUsd: string | null }
export interface ReplayObservation { id: string; atMs: number; sequence: number; equityUsd: string | null; activeUsd: string | null;
  cashUsd: string; reasons: string[] }
export interface ReplayFinancialEvent { id: string; kind: 'contribution'|'outflow'|'trade'|'fee'|'income'|'internal_transfer'|'unknown';
  atMs: number; flowUsd: string | null; sleeveFlowUsd: string | null; feeUsd: string | null; incomeUsd: string;
  receiptUsd: string; before: string; after: string; complete: boolean; feeAtMs: number }
export interface ReplayBook {
  scopeId: string; openingUsd: string; cash: string; positions: Record<string,string>; lots: Record<string,ReplayLot[]>;
  realized: string; realizedKnown: boolean; completedWins: number; winsKnown: boolean;
  episodes: Record<string,{profit:string;known:boolean}>; contributions: string; outflows: string; receipts: string;
  income: string; fees: string; standaloneFees: string; reserved: string; taxHold: string;
  receivables: Record<string,{amount:string;receipt:string;known:boolean}>;
  fills: ReplayFill[]; events: CapitalReplayEventV1[]; observations: ReplayObservation[]; financial: ReplayFinancialEvent[];
  applied: Set<string>; reasons: Set<string>; sequence: number;
}
export function createReplayBook(scopeId:string,opening:ReplayOpening):ReplayBook {
  return {scopeId,openingUsd:opening.capitalUsd,cash:opening.cashUsd,positions:Object.fromEntries(opening.assets.map(a=>[a.assetId,a.quantity])),
    lots:Object.fromEntries(opening.assets.map(a=>[a.assetId,[{quantity:a.quantity,costUsd:a.costUsd}]])),
    realized:'0',realizedKnown:true,completedWins:0,winsKnown:true,episodes:Object.fromEntries(opening.assets.filter(a=>amount(a.quantity).gt(0)).map(a=>[a.assetId,{profit:'0',known:false}])),
    contributions:'0',outflows:'0',receipts:'0',income:'0',fees:'0',standaloneFees:'0',reserved:'0',taxHold:'0',receivables:{},
    fills:[],events:[],observations:[],financial:[],applied:new Set(),reasons:new Set(),sequence:0};
}
export function replayEquity(book:ReplayBook,marks:Readonly<Record<string,string>>):string|null {
  let equity=amount(book.cash);
  for(const [id,q] of Object.entries(book.positions))if(amount(q).gt(0)){
    if(marks[id]===undefined)return null;equity=equity.add(amount(q).mul(marks[id]!));
  }
  for(const r of Object.values(book.receivables)){if(!r.known)return null;equity=equity.add(r.amount);}
  return text(equity);
}
export function observeReplayBook(book:ReplayBook,marks:Readonly<Record<string,string>>,atMs:number):ReplayObservation {
  const equityUsd=replayEquity(book,marks),reasons=equityUsd===null?['valuation_missing']:[];
  const body={atMs,sequence:book.sequence++,equityUsd,activeUsd:equityUsd===null?null:text(amount(equityUsd).sub(book.reserved).sub(book.taxHold)),cashUsd:book.cash,reasons};
  const result={...body,id:capitalHash({scopeId:book.scopeId,...body})};book.observations.push(result);return result;
}
export function journalReplay(book:ReplayBook,atMs:number,kind:string,sourceId:string,detail:string):CapitalReplayEventV1 {
  if(book.events.length>=100_000)throw new Error('replay_event_bound');
  const body={previousId:book.events.at(-1)?.id??null,atMs,sequence:book.sequence++,kind,sourceId,detail,cashUsd:book.cash,positions:{...book.positions}};
  const event={...body,id:capitalHash({scopeId:book.scopeId,...body})};book.events.push(event);return event;
}
/** Exact total acquisition cost is stored; received-asset fees never create a synthetic execution price. */
export function applyReplayFill(book:ReplayBook,fill:ReplayFill):void {
  if(book.applied.has(fill.id))return;
  const cash=amount(book.cash).sub(fill.cashDebitUsd).add(fill.cashCreditUsd),held=amount(book.positions[fill.assetId]??'0');
  if(cash.lt(0)||fill.side==='sell'&&held.lt(fill.quantity))throw new Error('replay_fill_exceeds_book');
  const queue=book.lots[fill.assetId]??[];
  if(fill.side==='buy'){
    if(held.isZero())book.episodes[fill.assetId]={profit:'0',known:true};
    queue.push({quantity:fill.deliveredQuantity,costUsd:fill.cashDebitUsd});
    book.positions[fill.assetId]=text(held.add(fill.deliveredQuantity));
  }else{
    let remaining=amount(fill.quantity),basis=new D(0),known=true;
    while(remaining.gt(0)&&queue.length){
      const lot=queue[0]!,take=D.min(lot.quantity,remaining);
      if(lot.costUsd===null)known=false;
      else{const consumed=take.eq(lot.quantity)?amount(lot.costUsd):amount(lot.costUsd).mul(take).div(lot.quantity);basis=basis.add(consumed);lot.costUsd=text(amount(lot.costUsd).sub(consumed));}
      lot.quantity=text(amount(lot.quantity).sub(take));remaining=remaining.sub(take);if(amount(lot.quantity).isZero())queue.shift();
    }
    if(remaining.gt(0))throw new Error('replay_lot_ownership');
    const pnl=amount(fill.cashCreditUsd).sub(fill.cashDebitUsd).sub(basis);
    if(known)book.realized=text(amount(book.realized).add(pnl));else book.realizedKnown=false;
    const ep=book.episodes[fill.assetId]??{profit:'0',known:false};ep.profit=text(amount(ep.profit).add(pnl));ep.known&&=known;
    book.positions[fill.assetId]=text(held.sub(fill.quantity));
    if(amount(book.positions[fill.assetId]!).isZero()){
      if(!ep.known)book.winsKnown=false;else if(amount(ep.profit).gt(0))book.completedWins++;
      book.episodes=Object.fromEntries(Object.entries(book.episodes).filter(([key])=>key!==fill.assetId));
    }else book.episodes[fill.assetId]=ep;
  }
  book.lots[fill.assetId]=queue;book.cash=text(cash);book.fees=text(amount(book.fees).add(fill.feeUsd));
  book.applied.add(fill.id);book.fills.push(fill);journalReplay(book,fill.atMs,'modeled_fill',fill.id,`${fill.side}; fee ${fill.feeQuantity} ${fill.feeAsset}`);
}
export function replayInvestment(book:ReplayBook,marks:Readonly<Record<string,string>>):{realized:CapitalMetric;unrealized:CapitalMetric;wins:CapitalMetric} {
  let unrealized=new D(0),known=true;
  for(const [id,lots] of Object.entries(book.lots))for(const lot of lots)if(amount(lot.quantity).gt(0)){
    if(lot.costUsd===null||marks[id]===undefined)known=false;else unrealized=unrealized.add(amount(lot.quantity).mul(marks[id]!).sub(lot.costUsd));
  }
  const metric=(v:string):CapitalMetric=>({...reserveValue(v,[book.scopeId]),method:'capital-replay-fifo-investment-v1'});
  return {realized:book.realizedKnown?metric(text(amount(book.realized).add(book.income).sub(book.standaloneFees))):reserveUnavailable('cost_basis_unavailable'),
    unrealized:known?metric(text(unrealized)):reserveUnavailable('cost_basis_or_marks_unavailable'),
    wins:book.winsKnown&&book.realizedKnown?metric(String(book.completedWins)):reserveUnavailable('episode_accounting_incomplete')};
}
