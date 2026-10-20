import { Decimal } from 'decimal.js';
import { projectPaperPosition, projectPaperPositionTimeline, samePaperQuantity, type ActivityFill } from './paper-activity.js';

export interface ActivityOverviewEntry {
  id:string; productId:string; kind:string; atMs:number; side:'buy'|'sell'|null;
  quantity:string|null; priceUsd:string|null; feeUsd:string|null; orderId:string|null;
  accountId:string|null; connectionId:string|null; instrumentKey:string|null; status:string;
  reason:string|null; timestampSource:string;
}
export interface ActivityValuation {
  atMs:number;
  positions:Record<string,{quantity:string;valueUsd:string|null}>|null;
  /** Equity-only observations are accepted solely for a sealed, scoped simulation. */
  simulationEquityUsd:string|null;
}
export interface ActivityOrder {
  key:string; orderId:string|null; productId:string; accountId:string|null; connectionId:string|null;
  side:'buy'|'sell'|null; atMs:number; status:string; quantity:string|null; averagePriceUsd:string|null;
  feeUsd:string|null; realizedPnlUsd:string|null; fillCount:number; lifetimeFillCount:number;
  timestampEstimated:boolean; reason:string|null;
}
export interface ActivityPoint { atMs:number; valueUsd:string|null }
const sum=(values:readonly string[])=>values.reduce((s,v)=>s.add(v),new Decimal(0)).toFixed();
const nullableSum=(values:readonly (string|null)[])=>values.some(v=>v===null)?null:sum(values as string[]);
export const activityOrderKey=(entry:ActivityOverviewEntry):string=>JSON.stringify([
  entry.connectionId,entry.accountId,entry.instrumentKey??entry.productId,entry.orderId??`fill:${entry.id}`,entry.side,
]);
export const activityOrderCompare=(a:ActivityOrder,b:ActivityOrder):number=>b.atMs-a.atMs||(a.key<b.key?1:a.key>b.key?-1:0);

/** Replay all available history once, before filtering the visible window. */
export function prepareActivityOverview(input:{fills:readonly ActivityFill[];entries:readonly ActivityOverviewEntry[];
  opening:Readonly<Record<string,string>>;balances:Readonly<Record<string,string>>;historyComplete:boolean}) {
  const products=[...new Set([...Object.keys(input.opening),...Object.keys(input.balances),...input.fills.map(f=>f.productId)])];
  const positions=new Map<string,ReturnType<typeof projectPaperPosition>>();
  const profits=new Map<string,string|null>();
  const fillsByProduct=new Map<string,ActivityFill[]>();
  for(const fill of input.fills){const list=fillsByProduct.get(fill.productId)??[];list.push(fill);fillsByProduct.set(fill.productId,list);}
  const mismatches=new Set<string>();
  for(const productId of products){
    const position=projectPaperPosition({fills:fillsByProduct.get(productId)??[],openingQuantity:input.opening[productId]??'0',markUsd:null});
    positions.set(productId,position);
    if(input.balances[productId]!==undefined&&!samePaperQuantity(input.balances[productId]!,position.quantity))mismatches.add(productId);
    for(const exit of position.exits)profits.set(exit.fillId,input.historyComplete&&!mismatches.has(productId)?exit.realizedPnlUsd:null);
  }
  const groups=new Map<string,ActivityOverviewEntry[]>();const seen=new Set<string>();
  const latestStates=new Map<string,ActivityOverviewEntry>();
  for(const entry of input.entries){
    if(entry.kind==='order'&&entry.orderId!==null){const key=JSON.stringify([entry.productId,entry.orderId]);const previous=latestStates.get(key);if(previous===undefined||previous.atMs<entry.atMs)latestStates.set(key,entry);}
    if(entry.kind!=='fill'||seen.has(entry.id))continue;seen.add(entry.id);
    const key=activityOrderKey(entry);const group=groups.get(key)??[];group.push(entry);groups.set(key,group);
  }
  return {input,positions,profits,groups,latestStates,mismatches,fillsByProduct};
}
export type PreparedActivityOverview=ReturnType<typeof prepareActivityOverview>;

export function activityWindowStart(now:number,period:'today'|'7d'|'30d'|'all',timeZone:string,earliest:number):number {
  if(period==='all')return Math.min(now,earliest);
  if(period!=='today')return Math.max(0,now-(period==='7d'?7:30)*86_400_000);
  const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const today=format.format(now);let low=Math.max(0,now-36*3_600_000),high=now;
  while(low<high){const mid=Math.floor((low+high)/2);if(format.format(mid)===today)high=mid;else low=mid+1;}
  return low;
}

/** Preserve endpoints, extrema and gap boundaries without fabricating observations. */
export function boundActivityPoints(points:readonly ActivityPoint[],limit=256):ActivityPoint[] {
  if(points.length<=limit)return [...points];
  const keep=new Set<number>([0,points.length-1]);
  points.forEach((point,index)=>{
    if(point.valueUsd===null&&(points[index-1]?.valueUsd!==null||points[index+1]?.valueUsd!==null)){
      keep.add(index);if(index>0)keep.add(index-1);if(index+1<points.length)keep.add(index+1);
    }
  });
  if(keep.size>limit)return [];
  const buckets=Math.floor((limit-keep.size)/2);
  for(let bucket=0;bucket<buckets;bucket++){
    const start=Math.floor(bucket*points.length/buckets),end=Math.floor((bucket+1)*points.length/buckets);
    let min=-1,max=-1;
    for(let i=start;i<end;i++){const value=points[i]!.valueUsd;if(value===null)continue;
      if(min<0||new Decimal(value).lt(points[min]!.valueUsd!))min=i;
      if(max<0||new Decimal(value).gt(points[max]!.valueUsd!))max=i;
    }
    if(min>=0)keep.add(min);if(max>=0)keep.add(max);
  }
  return [...keep].sort((a,b)=>a-b).map(index=>points[index]!);
}

export function projectActivityOrder(prepared:PreparedActivityOverview,key:string,fromMs:number,toMs:number):ActivityOrder|null {
  const lifetime=prepared.groups.get(key);if(lifetime===undefined)return null;
  const fills=lifetime.filter(fill=>fill.atMs>=fromMs&&fill.atMs<=toMs);if(fills.length===0)return null;
  const last=[...fills].sort((a,b)=>b.atMs-a.atMs||(a.id<b.id?1:-1))[0]!;
  const quantity=nullableSum(fills.map(f=>f.quantity));
  const notional=fills.every(f=>f.quantity!==null&&f.priceUsd!==null)?sum(fills.map(f=>new Decimal(f.quantity!).mul(f.priceUsd!).toFixed())):null;
  const state=last.orderId===null?undefined:prepared.latestStates.get(JSON.stringify([last.productId,last.orderId]));
  return {key,orderId:last.orderId,productId:last.productId,accountId:last.accountId,connectionId:last.connectionId,
    side:last.side,atMs:last.atMs,status:state?.status??last.status,quantity,
    averagePriceUsd:quantity===null||notional===null||new Decimal(quantity).isZero()?null:new Decimal(notional).div(quantity).toFixed(),
    feeUsd:nullableSum(fills.map(f=>f.feeUsd)),realizedPnlUsd:last.side==='sell'?nullableSum(fills.map(f=>prepared.profits.get(f.id)??null)):null,
    fillCount:fills.length,lifetimeFillCount:lifetime.length,timestampEstimated:fills.some(f=>f.timestampSource!=='recorded_fill'),
    reason:state?.reason??last.reason};
}

export function projectActivityMetrics(prepared:PreparedActivityOverview,input:{productId:string|null;fromMs:number;now:number;
  marks:Readonly<Record<string,{priceUsd:string;atMs:number|null}>>}) {
  const selected=(productId:string)=>input.productId===null||productId===input.productId;
  const orders=[...prepared.groups.keys()].map(key=>projectActivityOrder(prepared,key,input.fromMs,input.now))
    .filter((order):order is ActivityOrder=>order!==null&&selected(order.productId)).sort(activityOrderCompare);
  const exits=[...prepared.positions].filter(([id])=>selected(id)).flatMap(([,position])=>position.exits)
    .filter(exit=>exit.atMs>=input.fromMs&&exit.atMs<=input.now).sort((a,b)=>a.atMs-b.atMs||(a.fillId<b.fillId?-1:1));
  const values=exits.map(exit=>prepared.profits.get(exit.fillId)??null);
  const historyComplete=prepared.input.historyComplete;
  const realizedPnlUsd=historyComplete?nullableSum(values):null;
  let knownOpen=new Decimal(0),openComplete=historyComplete,stale=false,missingMark=false;
  for(const [productId,position] of prepared.positions){
    if(!selected(productId))continue;
    if(prepared.mismatches.has(productId)){openComplete=false;continue;}
    if(new Decimal(position.quantity).isZero())continue;
    const mark=input.marks[productId];
    if(mark===undefined){openComplete=false;missingMark=true;continue;}
    knownOpen=knownOpen.add(new Decimal(position.knownQuantity).mul(mark.priceUsd).minus(position.knownBasisUsd));
    if(!position.basisComplete)openComplete=false;
    if(mark.atMs===null||input.now-mark.atMs>60_000)stale=true;
  }
  let wins=0,losses=0,breakeven=0,unknownExits=0;
  for(const order of orders.filter(order=>order.side==='sell')){
    if(order.realizedPnlUsd===null)unknownExits++;
    else if(new Decimal(order.realizedPnlUsd).gt(0))wins++;
    else if(new Decimal(order.realizedPnlUsd).lt(0))losses++;else breakeven++;
  }
  const grouped=new Map<number,Decimal>();
  for(const exit of exits){const value=prepared.profits.get(exit.fillId);if(value!=null)grouped.set(exit.atMs,(grouped.get(exit.atMs)??new Decimal(0)).add(value));}
  let cumulative=new Decimal(0);const closedPoints:ActivityPoint[]=[{atMs:input.fromMs,valueUsd:'0'}];
  for(const [atMs,value] of grouped){cumulative=cumulative.add(value);const point={atMs,valueUsd:cumulative.toFixed()};
    if(closedPoints.at(-1)!.atMs===atMs)closedPoints[closedPoints.length-1]=point;else closedPoints.push(point);}
  if(closedPoints.at(-1)!.atMs<input.now)closedPoints.push({atMs:input.now,valueUsd:cumulative.toFixed()});
  const points=realizedPnlUsd===null?[]:boundActivityPoints(closedPoints);
  return {orders,realizedPnlUsd,knownRealizedPnlUsd:sum(values.filter((v):v is string=>v!==null)),
    unrealizedPnlUsd:openComplete?knownOpen.toFixed():null,knownUnrealizedPnlUsd:missingMark?null:knownOpen.toFixed(),
    valuation:!openComplete?(missingMark?'unavailable' as const:'partial' as const):stale?'stale' as const:'fresh' as const,
    wins,losses,breakeven,unknownExits,executedOrders:orders.length,
    closedChart:{points,available:points.length>0,reason:realizedPnlUsd===null?'Complete fill history, fees and cost basis are required.':null,
      startAtMs:points.length>0?input.fromMs:null,lastEvidenceAtMs:exits.at(-1)?.atMs??null}};
}

/** Snapshot replay is cached by the caller; today’s prices never enter historical P/L. */
export function projectActivityTotalHistory(prepared:PreparedActivityOverview,valuations:readonly ActivityValuation[],productId:string|null):ActivityPoint[] {
  const ordered=[...new Map(valuations.map(value=>[value.atMs,value])).values()].sort((a,b)=>a.atMs-b.atMs);
  const products=[...new Set([...prepared.positions.keys(),...ordered.flatMap(value=>Object.keys(value.positions??{}))])]
    .filter(id=>productId===null||id===productId);
  const totals=ordered.map(()=>new Decimal(0));const complete=ordered.map(()=>prepared.input.historyComplete);
  for(const id of products){
    const timeline=projectPaperPositionTimeline({fills:prepared.fillsByProduct.get(id)??[],openingQuantity:prepared.input.opening[id]??'0',
      observations:ordered.map(value=>({atMs:value.atMs,quantity:value.positions?.[id]?.quantity??null,valueUsd:value.positions?.[id]?.valueUsd??null}))});
    timeline.forEach((point,index)=>{if(point.totalPnlUsd===null)complete[index]=false;else totals[index]=totals[index]!.add(point.totalPnlUsd);});
  }
  return ordered.map((valuation,index)=>({atMs:valuation.atMs,valueUsd:valuation.positions===null?
    productId===null&&prepared.input.historyComplete?valuation.simulationEquityUsd:null:
    complete[index]?totals[index]!.toFixed():null}));
}

export function windowActivityTotal(points:readonly ActivityPoint[],fromMs:number,toMs:number) {
  const window=points.filter(point=>point.atMs>=fromMs&&point.atMs<=toMs);
  const baseline=window.find(point=>point.valueUsd!==null);
  const valid=window.filter(point=>point.valueUsd!==null);
  const available=valid.length>=2;
  const relative=available?window.filter(point=>point.atMs>=baseline!.atMs).map(point=>({atMs:point.atMs,
    valueUsd:point.valueUsd===null?null:new Decimal(point.valueUsd).minus(baseline!.valueUsd!).toFixed()})):[];
  const bounded=boundActivityPoints(relative);
  return {points:bounded,available:available&&bounded.length>0,
    reason:!available?'Two attributable recorded valuations with complete basis are required.':bounded.length===0?'Too many history gaps to summarize safely.':null,
    startAtMs:available?baseline!.atMs:null,lastEvidenceAtMs:valid.at(-1)?.atMs??null};
}
