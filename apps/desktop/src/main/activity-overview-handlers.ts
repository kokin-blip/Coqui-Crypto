import { sha256Hex, activityWindowStart, activityOrderCompare, prepareActivityOverview, projectActivityMetrics, projectActivityOrder,
  projectActivityTotalHistory, windowActivityTotal, type ActivityPoint } from '@coqui/core';
import type { ChannelRequest, ChannelResponse } from '@coqui/contracts';
import { getDecisionDetail, readTradingActivity, readActivityValuations, tradingActivityScopes, tradingActivityRevision, type Db } from '@coqui/storage';
import type { ActivityMark } from './trading-activity-handlers.js';
import type { ChannelHandlers } from './dispatch.js';

type Filter=ChannelRequest<'trading.activity.overview'>;
type Order=ChannelResponse<'trading.activity.overview'>['orders']['items'][number];
interface Cursor { key:string;atMs:number;fromMs:number;toMs:number;filter:string }
const identity=(filter:Filter,profileId:string)=>sha256Hex(JSON.stringify([profileId,filter.scopeId,filter.connectionId,filter.productId,filter.period,filter.timeZone]));
const failure=()=>({ok:false as const,issues:[{path:[],code:'activity_selection_unavailable'}]});

export function createActivityOverviewHandlers(input:{profileId:string;database:Db;now:()=>number;mark:(productId:string)=>ActivityMark|null}):ChannelHandlers {
  let revision='';
  const cache=new Map<string,{facts:ReturnType<typeof readTradingActivity>;prepared:ReturnType<typeof prepareActivityOverview>;
    valuations:ReturnType<typeof readActivityValuations>;total:Map<string,ActivityPoint[]>}>();
  const read=(filter:Filter)=>{
    const catalog=tradingActivityScopes(input.profileId,input.database);
    const scope=catalog.scopes.find(scope=>scope.id===filter.scopeId);
    if(scope===undefined||!catalog.accounts.some(account=>account.scopeId===scope.id&&
      (account.connectionId===filter.connectionId||filter.connectionId===null)))return null;
    const account=catalog.accounts.find(account=>account.scopeId===scope.id)!;
    const connectionId=account.connectionId; // Null means the source’s entire attributed account, never another wallet.
    const current=tradingActivityRevision(input.profileId,input.database);
    if(current!==revision){cache.clear();revision=current;}
    const key=JSON.stringify([scope.id,connectionId]);let cached=cache.get(key);
    if(cached===undefined){
      const facts=readTradingActivity(input.profileId,scope,connectionId,'*',input.database,{fillsOnly:true});
      const recent=facts.historyComplete?null:readTradingActivity(input.profileId,scope,connectionId,'*',input.database,{fillsOnly:true,recent:true});
      // Latest rows remain current even when the oldest cost-basis replay hits its cap.
      const prepared=prepareActivityOverview({...facts,entries:recent===null?facts.entries:[...facts.entries,...recent.entries]});
      cached={facts,prepared,valuations:readActivityValuations(input.profileId,scope,connectionId,input.database),total:new Map()};
      if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,cached);
    }
    const now=input.now();
    const earliest=[...cached.facts.fills,...cached.valuations].reduce((earliest,point)=>Math.min(earliest,point.atMs),now);
    const fromMs=activityWindowStart(now,filter.period,filter.timeZone,earliest);
    return {...cached,scope,account,now,fromMs};
  };
  const metrics=(result:NonNullable<ReturnType<typeof read>>,filter:Filter,fromMs=result.fromMs,toMs=result.now)=>{
    const marks:Record<string,ActivityMark>={};
    for(const productId of result.prepared.positions.keys()){
      const current=input.mark(productId),recorded=result.facts.marks[productId];
      const mark=recorded!==undefined&&(current?.atMs??0)<recorded.atMs?recorded:current;
      if(mark!==null)marks[productId]=mark;
    }
    return projectActivityMetrics(result.prepared,{productId:filter.productId,fromMs,now:toMs,marks});
  };
  const page=(orders:readonly Order[],filter:Filter,fromMs:number,toMs:number,historyComplete:boolean,limit:number,cursor:Cursor|null)=>{
    const eligible=cursor===null?orders:orders.filter(order=>activityOrderCompare(order,{...order,key:cursor.key,atMs:cursor.atMs})>0);
    const items=eligible.slice(0,limit);const last=items.at(-1);
    return {items,nextCursor:eligible.length>items.length&&last!==undefined?JSON.stringify({key:last.key,atMs:last.atMs,fromMs,toMs,filter:identity(filter,input.profileId)} satisfies Cursor):null,
      historyComplete,asOfMs:toMs};
  };
  const parseCursor=(value:string,filter:Filter):Cursor|null=>{
    try{const parsed=JSON.parse(value) as Cursor;
      return typeof parsed.key==='string'&&Number.isSafeInteger(parsed.atMs)&&parsed.atMs>=0&&Number.isSafeInteger(parsed.fromMs)&&parsed.fromMs>=0&&
        Number.isSafeInteger(parsed.toMs)&&parsed.toMs>=parsed.fromMs&&parsed.toMs<=input.now()&&parsed.filter===identity(filter,input.profileId)?parsed:null;
    }catch{return null;}
  };
  return {
    'trading.activity.overview':(filter:Filter)=>{
      const result=read(filter);if(result===null)return failure();
      const {orders,...values}=metrics(result,filter);
      const totalKey=filter.productId??'*';let total=result.total.get(totalKey);
      if(total===undefined){total=projectActivityTotalHistory(result.prepared,result.valuations,filter.productId);result.total.set(totalKey,total);}
      const evidence=result.prepared.input.entries.filter(entry=>filter.productId===null||entry.productId===filter.productId).map(entry=>entry.atMs);
      for(const [product,mark] of Object.entries(result.facts.marks))if(filter.productId===null||filter.productId===product)evidence.push(mark.atMs);
      return {ok:true,value:{profileId:input.profileId,scope:result.scope,connectionId:result.account.connectionId,accountLabel:result.account.label,
        productId:filter.productId,period:filter.period,fromMs:result.fromMs,asOfMs:result.now,
        evidenceAtMs:evidence.length>0?evidence.reduce((latest,value)=>Math.max(latest,value),0):null,historyComplete:result.facts.historyComplete,...values,
        totalChart:windowActivityTotal(total,result.fromMs,result.now),
        orders:page(orders,filter,result.fromMs,result.now,result.facts.historyComplete,20,null)}};
    },
    'trading.activity.orders':(filter:ChannelRequest<'trading.activity.orders'>)=>{
      const result=read(filter);if(result===null)return failure();
      const cursor=filter.cursor===null?null:parseCursor(filter.cursor,filter);if(filter.cursor!==null&&cursor===null)return failure();
      const fromMs=cursor?.fromMs??result.fromMs,toMs=cursor?.toMs??result.now;
      return {ok:true,value:page(metrics(result,filter,fromMs,toMs).orders,filter,fromMs,toMs,result.facts.historyComplete,filter.limit,cursor)};
    },
    'trading.activity.order-detail':(filter:ChannelRequest<'trading.activity.order-detail'>)=>{
      const result=read(filter);if(result===null)return failure();
      const order=projectActivityOrder(result.prepared,filter.orderKey,result.fromMs,result.now);
      const lifetime=projectActivityOrder(result.prepared,filter.orderKey,0,result.now);
      if(order===null||lifetime===null||filter.productId!==null&&order.productId!==filter.productId)return failure();
      const cursor=filter.cursor===null?null:parseCursor(filter.cursor,filter);
      if(filter.cursor!==null&&(cursor===null||!cursor.filter.endsWith(identity(filter,input.profileId))))return failure();
      if(cursor!==null&&!cursor.key.startsWith(`${sha256Hex(filter.orderKey)}:`))return failure();
      const toMs=cursor?.toMs??result.now;
      const all=[...result.prepared.groups.get(filter.orderKey)!].filter(fill=>fill.atMs<=toMs).sort((a,b)=>b.atMs-a.atMs||(a.id<b.id?1:-1));
      const lastId=cursor?.key.slice(65);
      const eligible=cursor===null?all:all.filter(fill=>fill.atMs<cursor.atMs||fill.atMs===cursor.atMs&&fill.id<lastId!);
      const selected=eligible.slice(0,100);
      const ids=new Set(selected.map(fill=>fill.id));
      const entries=new Map(result.prepared.input.entries.filter(entry=>entry.kind==='fill'&&ids.has(entry.id)).map(entry=>[entry.id,entry]));
      const fills=selected.map(fill=>({...entries.get(fill.id)!,realizedPnlUsd:result.prepared.profits.get(fill.id)??null}));
      const last=selected.at(-1);
      const nextCursor=eligible.length>selected.length&&last!==undefined?JSON.stringify({key:`${sha256Hex(filter.orderKey)}:${last.id}`,atMs:last.atMs,
        fromMs:result.fromMs,toMs,filter:identity(filter,input.profileId)} satisfies Cursor):null;
      let reason=order.reason;
      if(reason===null){
        const decisionId=result.facts.entries.find(fill=>ids.has(fill.id)&&fill.decisionId!==null)?.decisionId;
        const detail=decisionId==null?null:getDecisionDetail(input.profileId,decisionId,input.database);
        const recorded=detail?.events.map(item=>item.event).reverse().find(event=>'reasonCode' in event.detail);
        if(recorded!==undefined&&'reasonCode' in recorded.detail)reason=`Decision ${decisionId}: ${String(recorded.detail.reasonCode)}`;
      }
      return {ok:true,value:{order:{...order,reason},lifetime,fills,nextCursor,
        historyComplete:result.facts.historyComplete,asOfMs:result.now}};
    },
  };
}
