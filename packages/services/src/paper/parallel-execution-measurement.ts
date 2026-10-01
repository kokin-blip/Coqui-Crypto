import { Decimal } from 'decimal.js';
import type { ParallelPaperEvent } from '@coqui/storage';
const parse = (value:unknown) => {try { const result=new Decimal(String(value));return result.isFinite()?result:null; } catch {return null;} };
/** Observed fill VWAP relative to the last pre-submission arrival midpoint; equity is never a slippage proxy. */
export function parallelExecutionMeasurements(events:readonly ParallelPaperEvent[]) {
  const ids=[...new Set(events.filter((event)=>event.kind==='external_order').map((event)=>String(event.detail['orderId'])))];
  return ids.map((orderId)=>{
    const order=[...events].reverse().find((event)=>event.kind==='external_order'&&event.detail['orderId']===orderId)!;
    const clientOrderId=String(order.detail['clientOrderId']);
    const attempted=events.find((event)=>event.kind==='submit_attempt'&&event.detail['clientOrderId']===clientOrderId);
    const arrival=[...events].reverse().find((event)=>event.kind==='pre_order_quote'&&event.detail['clientOrderId']===clientOrderId&&attempted&&event.at<=attempted.at);
    const fills=events.filter((event)=>event.kind==='external_fill'&&event.detail['orderId']===orderId);
    const seen=new Set<string>();let quantity=new Decimal(0),notional=new Decimal(0),first:number|null=null,last:number|null=null,unknown=false;
    for(const fill of fills) {
      const id=String(fill.detail['activityId']);if(seen.has(id)) continue;seen.add(id);
      const qty=parse(fill.detail['quantity']),price=parse(fill.detail['price']);
      const at=typeof fill.detail['at']==='string'?Date.parse(fill.detail['at']):NaN;
      if(!qty||!price||qty.lte(0)||price.lte(0)) {unknown=true;continue;}
      quantity=quantity.plus(qty);notional=notional.plus(qty.mul(price));
      if(Number.isFinite(at)) {first=Math.min(first??at,at);last=Math.max(last??at,at);} else unknown=true;
    }
    const midpoint=parse(arrival?.detail['midpoint']);const vwap=quantity.gt(0)?notional.div(quantity):null;
    const sign=order.detail['side']==='buy'?1:order.detail['side']==='sell'?-1:null;
    const subsequent=last===null?null:events.find((event)=>event.kind==='intraday_check'&&event.at>last!&&
      typeof event.detail['quotes']==='object'&&event.detail['quotes']!==null&&String(order.detail['symbol']).replace('/','') in event.detail['quotes']);
    const quote=subsequent?(subsequent.detail['quotes'] as Record<string,{bid:string;ask:string;atMs:number}>)[String(order.detail['symbol']).replace('/','')]:null;
    const matchedMid=quote?new Decimal(quote.bid).plus(quote.ask).div(2):null;
    return {orderId,clientOrderId,status:order.detail['status'],observedFilledQuantity:quantity.toString(),
      fillVwap:vwap?.toString()??null,arrivalMidpoint:midpoint?.toString()??null,arrivalAtMs:arrival?.at??null,
      signedShortfallUsd:vwap&&midpoint&&sign!==null?quantity.mul(vwap.minus(midpoint)).mul(sign).toString():null,
      firstFillLatencyMs:first!==null&&attempted&&first>=attempted.at?first-attempted.at:null,
      completionLatencyMs:last!==null&&attempted&&last>=attempted.at&&order.detail['status']==='filled'?last-attempted.at:null,
      partialFillObserved:events.some((event)=>event.kind==='external_order'&&event.detail['orderId']===orderId&&event.detail['status']==='partially_filled'),
      subsequentMatchedMidpoint:matchedMid?.toString()??null,subsequentMarkAtMs:quote?.atMs??null,
      signedPostFillMoveUsd:vwap&&matchedMid&&sign!==null?quantity.mul(matchedMid.minus(vwap)).mul(sign).toString():null,
      coverage:unknown||!midpoint||!vwap?'unavailable_or_partial':'observed',feesIncluded:false,modeled:false};
  });
}
