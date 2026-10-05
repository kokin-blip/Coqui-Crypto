import { projectPaperPosition, allocationPercent, samePaperQuantity, markPaperPosition } from '@coqui/core';
import type { ChannelRequest, ChannelResponse } from '@coqui/contracts';
import { readTradingActivity, tradingActivityScopes, tradingActivityRevision, type Db, type DecisionDetailV1, type TradingActivityFacts } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';

type Watching = NonNullable<ChannelResponse<'trading.activity.summary'>['watching']>;
export function activityWatching(detail:DecisionDetailV1|null, productId:string, shared=false):Watching|null {
  if(detail===null)return null;
  const d=detail.decision;const events=detail.events.map(e=>e.event);const last=[...events].reverse().find(e=>['stand_down','no_trade','execution_planned','execution_submitted','execution_filled','execution_refused','recovery'].includes(e.kind));
  const risk=[...events].reverse().find(e=>e.kind==='risk_evaluated');
  const asset=productId.replace(/-USD$/,'');const matches=(id:string)=>id===asset||id.endsWith(`|${productId}`);
  const momentum=d.facts?.momentum.find(m=>matches(m.assetId));const target=d.targets.find(t=>matches(t.assetId));
  const signals:Watching['signals'][number][]=[];
  if(momentum!==undefined){signals.push({label:'Momentum',value:`${momentum.returnPct}%`},{label:'Asset volatility',value:`${momentum.volatilityPct}%`},{label:'Risk-adjusted momentum',value:String(momentum.riskAdjustedMomentum)});}
  if(d.facts?.realizedVolPct!==null&&d.facts?.realizedVolPct!==undefined)signals.push({label:'Portfolio volatility',value:`${d.facts.realizedVolPct}%`});
  if(d.facts?.belowTrend!==null&&d.facts?.belowTrend!==undefined)signals.push({label:'Below trend',value:d.facts.belowTrend?'Yes':'No'});
  signals.push({label:'History',value:d.historyStatus},{label:'Market evidence',value:d.market.freshness},{label:'Product rules',value:d.market.rulesFresh?'Fresh':'Unavailable or stale'});
  return {atMs:d.createdAtMs,strategy:`${d.strategy.id} · ${d.strategy.version}`,intent:last?.kind.replaceAll('_',' ')??'Evaluation recorded',
    reason:last!==undefined&&'reasonCode'in last.detail?String(last.detail.reasonCode):null,targetWeightPct:target===undefined?null:allocationPercent(target.weight),
    risk:risk?.kind==='risk_evaluated'?(risk.detail.approved?'Passed':`Blocked: ${risk.detail.reasonCodes.join(', ')}`):'Unassessed',signals,decisionId:d.decisionId,shared};
}
export interface ActivityMark {priceUsd:string;source:string;atMs:number|null}
export function createTradingActivityHandlers(input:{profileId:string;database:Db;now:()=>number;mark:(productId:string)=>ActivityMark|null}):ChannelHandlers {
  let cache:{key:string;revision:string;facts:TradingActivityFacts;positions:Map<string,ReturnType<typeof projectPaperPosition>>}|null=null;
  const read=(payload:ChannelRequest<'trading.activity.summary'>)=>{
    const scopes=tradingActivityScopes(input.profileId,input.database);const scope=scopes.scopes.find(s=>s.id===payload.scopeId);
    if(scope===undefined||payload.connectionId!==null&&!scopes.wallets.some(w=>w.id===payload.connectionId))return null;
    const key=JSON.stringify([payload.scopeId,payload.connectionId,payload.productId]);const revision=tradingActivityRevision(input.profileId,input.database);
    if(cache===null||cache.key!==key||cache.revision!==revision)cache={key,revision,positions:new Map(),facts:readTradingActivity(input.profileId,scope,payload.connectionId,payload.productId,input.database)};
    return {scope,facts:cache.facts,positions:cache.positions};
  };
  const failure=()=>({ok:false as const,issues:[{path:[],code:'activity_scope_unavailable'}]});
  return {
    'trading.activity.scopes':()=>({ok:true,value:{profileId:input.profileId,...tradingActivityScopes(input.profileId,input.database),asOfMs:input.now()}}),
    'trading.activity.summary':(payload:ChannelRequest<'trading.activity.summary'>)=>{
      const result=read(payload);if(result===null)return failure();const {scope,facts}=result;
      const products=[...new Set([...Object.keys(facts.opening),...Object.keys(facts.balances),...facts.fills.map(f=>f.productId)])];
      const positions=products.slice(0,500).map(productId=>{
        const quote=input.mark(productId);const recorded=facts.marks[productId];const mark=recorded!==undefined&&(quote?.atMs??0)<recorded.atMs?recorded:quote;const related=facts.fills.filter(f=>f.productId===productId);
        let basis=result.positions.get(productId);
        if(basis===undefined){basis=projectPaperPosition({fills:related,openingQuantity:facts.opening[productId]??'0',markUsd:null});result.positions.set(productId,basis);}
        const projected=markPaperPosition(basis,mark?.priceUsd??null);
        const recordedBalance=facts.balances[productId];
        const balanceMismatch=recordedBalance!==undefined&&!samePaperQuantity(recordedBalance,projected.quantity);
        const missingTime=facts.entries.some(e=>e.kind==='fill'&&e.productId===productId&&e.timestampSource==='recorded_event_fill_time_unavailable');
        const {exits,...position}=projected;
        return {...position,...(balanceMismatch?{quantity:recordedBalance!,status:Number(recordedBalance)>0?'holding' as const:'closed' as const}:{}),entryAtMs:missingTime?null:position.entryAtMs,scopeId:scope.id,productId,
          markUsd:mark?.priceUsd??null,markSource:mark?.source??null,markAtMs:mark?.atMs??null,
          valuation:!facts.historyComplete||balanceMismatch||!position.basisComplete?'partial' as const:mark===null?'unavailable' as const:mark.atMs===null||input.now()-mark.atMs>60000?'stale' as const:'fresh' as const,
          ...(!facts.historyComplete||balanceMismatch?{unrealizedPnlUsd:null,unrealizedPnlPct:null,realizedPnlUsd:null,basisComplete:false,realizedComplete:false}:{}),exits:exits.slice(-200)};
      });
      let watching=activityWatching(facts.decision,payload.productId,payload.connectionId!==null&&!facts.decision?.routes.some(r=>r.connectionId===payload.connectionId));
      if(facts.parallelWatching!==null){const d=facts.parallelWatching;const weights=d['weights'] as Record<string,number>|undefined;
        const weight=weights?.[`coinbase|spot|${payload.productId}`];watching={atMs:Number(d['recordedAtMs']),strategy:'Parallel TrendVol',intent:d['activityState']==='paused'||d['activityState']==='stopped'?`Stand down · ${String(d['activityState'])}`:'Recorded allocation target',reason:d['activityReason']===null?null:String(d['activityReason']),
          targetWeightPct:weight===undefined?null:allocationPercent(weight),risk:'Recorded risk details unavailable',signals:[{label:'Below trend',value:d['belowTrend']===undefined?'Unavailable':d['belowTrend']===true?'Yes':'No'},{label:'Portfolio volatility',value:d['mixVolPct']===undefined?'Unavailable':`${String(d['mixVolPct'])}%`}],decisionId:null,shared:payload.connectionId!==null};}
      const annotations=facts.entries.filter(e=>e.productId===payload.productId&&(e.kind==='fill'||e.kind==='proposal')).sort((a,b)=>a.atMs-b.atMs||(a.id<b.id?-1:a.id>b.id?1:0));
      return {ok:true,value:{profileId:input.profileId,scope,positions,watching,decision:facts.decision,annotations:annotations.slice(-200),historyComplete:facts.historyComplete,asOfMs:input.now()}};
    },
    'trading.activity.trail':(payload:ChannelRequest<'trading.activity.trail'>)=>{
      const result=read(payload);if(result===null)return failure();
      let before:{atMs:number;id:string}|null=null;
      if(payload.cursor!==null){try{before=JSON.parse(payload.cursor) as {atMs:number;id:string};if(!Number.isSafeInteger(before.atMs)||typeof before.id!=='string')return failure();}catch{return failure();}}
      const ordered=result.facts.entries.filter(e=>e.productId===payload.productId).sort((a,b)=>b.atMs-a.atMs||(b.id<a.id?-1:b.id>a.id?1:0));
      const eligible=before===null?ordered:ordered.filter(e=>e.atMs<before!.atMs||e.atMs===before!.atMs&&e.id<before!.id);
      let basis=result.positions.get(payload.productId);if(basis===undefined){basis=projectPaperPosition({fills:result.facts.fills.filter(f=>f.productId===payload.productId),openingQuantity:result.facts.opening[payload.productId]??'0',markUsd:null});result.positions.set(payload.productId,basis);}
      const items=eligible.slice(0,payload.limit).map(e=>({...e,realizedPnlUsd:result.facts.historyComplete?basis.exits.find(x=>x.fillId===e.id)?.realizedPnlUsd??null:null}));const last=items.at(-1);
      return {ok:true,value:{profileId:input.profileId,items,nextCursor:eligible.length>items.length&&last!==undefined?JSON.stringify({atMs:last.atMs,id:last.id}):null,historyComplete:result.facts.historyComplete,asOfMs:input.now()}};
    },
  };
}

export function resolveActivityMark(productId:string,quotes:readonly {instrument:{productId:string};priceUsd:string;observedAtMs:number}[],bar:(id:string)=>{close:number;endTimeMs:number}|undefined):ActivityMark|null {
  const quote=quotes.find(q=>q.instrument.productId===productId);
  if(quote!==undefined)return {priceUsd:quote.priceUsd,source:'Coinbase informational quote',atMs:quote.observedAtMs};
  const completed=bar(`coinbase|spot|${productId}`);
  return completed===undefined?null:{priceUsd:String(completed.close),source:'Completed Coinbase reference bar',atMs:completed.endTimeMs};
}
