import { Decimal } from 'decimal.js';
type Activity={readonly id:string;readonly activity_type:string;readonly transaction_time?:string;readonly created_at?:string;readonly date?:string;
  readonly qty?:string;readonly price?:string;readonly side?:string;readonly symbol?:string;readonly order_id?:string;
  readonly net_amount?:string;readonly status?:string;readonly currency?:string};
type Order={readonly id:string;readonly filled_qty:string;readonly symbol:string;readonly side:string};
export interface BrokerCashEvidence {
  readonly openingCashUsd:string;readonly cashUsd:string;readonly startedAtMs:number;readonly complete:boolean;
  readonly activities:readonly Activity[];readonly orders:readonly Order[];
}
const D=Decimal.clone({precision:40});
const money=(value:unknown)=>{if(typeof value!=='string')throw new TypeError('invalid_money');const n=new D(value);if(!n.isFinite())throw new TypeError('invalid_money');return n;};
/** Reconcile observations without creating a cash journal or allocating unlinked fees. */
export function reconcileBrokerCash(input:BrokerCashEvidence,adjustmentsUsd:string,openingEquityUsd:string) {
  const unavailable={reconciled:false,residualUsd:null as string|null,journalDetailsComplete:false,fillCount:0};
  try {
    if(!input.complete||input.orders.length>=500||!money(input.openingCashUsd).eq(openingEquityUsd))return unavailable;
    let cash=money(input.openingCashUsd).add(adjustmentsUsd),openingFunding=new D(0),recordedAdjustments=new D(0),fillCount=0;
    const ids=new Set<string>(),fills=new Map<string,{qty:Decimal;symbol:string;side:string}>();
    for(const a of input.activities){
      if(!a.id||ids.has(a.id))return unavailable;ids.add(a.id);
      const at=Date.parse(a.activity_type==='FILL'?a.transaction_time??'':a.created_at??a.date??'');
      if(!Number.isFinite(at))return unavailable;
      if(a.activity_type==='FILL'){
        if(at<input.startedAtMs||!a.order_id||!a.symbol||!/^\w+\/?USD$/u.test(a.symbol)||!['buy','sell'].includes(a.side??''))return unavailable;
        const qty=money(a.qty),price=money(a.price);if(qty.lte(0)||price.lte(0))return unavailable;
        // Alpaca's USD cash ledger rounds each execution amount to cents.
        cash=cash.add(qty.mul(price).toDecimalPlaces(2,D.ROUND_HALF_UP).mul(a.side==='buy'?-1:1));fillCount++;
        const prior=fills.get(a.order_id),symbol=a.symbol.replace('/','');
        if(prior&&(prior.symbol!==symbol||prior.side!==a.side))return unavailable;
        fills.set(a.order_id,{qty:(prior?.qty??new D(0)).add(qty),symbol,side:a.side!});
      }else{
        if(a.status!=='executed'||a.currency!=='USD')return unavailable;
        const amount=money(a.net_amount);
        if(['JNLC','CSD','CSW'].includes(a.activity_type)){
          if(a.qty!==undefined||!amount.eq(amount.toDecimalPlaces(2)))return unavailable;
          if(at<input.startedAtMs)openingFunding=openingFunding.add(amount);else recordedAdjustments=recordedAdjustments.add(amount);
        }else if(['CFEE','FEE'].includes(a.activity_type)){
          if(at<input.startedAtMs)return unavailable;
          if(a.qty!==undefined){if(!a.symbol||!amount.isZero()||money(a.qty).gt(0))return unavailable;}
          else cash=cash.add(amount);
        }else return unavailable;
      }
    }
    if(!openingFunding.eq(input.openingCashUsd))return unavailable;
    if(!recordedAdjustments.isZero()&&!recordedAdjustments.eq(adjustmentsUsd))return unavailable;
    const orderIds=new Set<string>();
    for(const order of input.orders){
      if(!order.id||orderIds.has(order.id))return unavailable;orderIds.add(order.id);
      const fill=fills.get(order.id),qty=money(order.filled_qty);
      if(qty.lt(0)||!qty.eq(fill?.qty??0)||fill&&(fill.symbol!==order.symbol.replace('/','')||fill.side!==order.side))return unavailable;
    }
    if([...fills.keys()].some(id=>!orderIds.has(id)))return unavailable;
    const residual=money(input.cashUsd).minus(cash);
    return {reconciled:residual.isZero(),residualUsd:residual.toFixed(2),journalDetailsComplete:recordedAdjustments.eq(adjustmentsUsd),fillCount};
  }catch{return unavailable;}
}
