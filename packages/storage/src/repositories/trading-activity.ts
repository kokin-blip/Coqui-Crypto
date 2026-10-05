import { Decimal } from 'decimal.js';
import { type ActivityFill } from '@coqui/core';
import { getDecisionDetail, type DecisionDetailV1 } from './decision-timeline.js';
import { getExploratoryPaperCampaign } from './exploratory-paper.js';
import { getPaperBookOrigin } from './paper-runtime.js';
import { listProfileConnectionsV2 } from './connections-v2.js';
import { getPaperProposalEvidence } from './paper-execution.js';
import type { Db } from '../sqlite/index.js';

export interface ActivityScope {
  id: string; profileId: string; source: 'paper_ledger'|'exploratory'|'parallel_coqui'|'alpaca_paper';
  campaignId: string|null; label: string; combined: boolean; current: boolean;
}
export interface TradingActivityEntry {
  id: string; profileId: string; scopeId: string; source:ActivityScope["source"]; campaignId:string|null; instrumentKey:string|null; accountId:string|null; connectionId: string|null; productId: string;
  kind: 'proposal'|'review'|'order'|'fill'; status: string; atMs: number; side: 'buy'|'sell'|null;
  quantity: string|null; amountUsd:string|null; realizedPnlUsd:string|null; priceUsd: string|null; feeUsd: string|null; spreadUsd: string|null; slippageUsd: string|null; impactUsd: string|null;
  proposalId: string|null; decisionId: string|null; orderId: string|null; reason: string|null;
  timestampSource: 'recorded_fill'|'recorded_event'|'recorded_event_fill_time_unavailable';
}
const CAP = 50_000;
const rows = (db: Db, sql: string, ...args: Array<string|number|null>): Record<string, unknown>[] => db.prepare(sql).all(...args) as Record<string,unknown>[];
const product = (id: string): string => id.includes('|') ? id.split('|').at(-1)! : id.replace(/\/?USD$/, '-USD');
export function tradingActivityScopes(profileId: string, db: Db) {
  const scopes: ActivityScope[] = [{ id:'ledger',profileId,source:'paper_ledger',campaignId:null,label:'Paper ledger',combined:true,current:false }];
  const current = db.prepare('SELECT campaign_id FROM exploratory_paper_campaign_state_v1 WHERE profile_id=?').get(profileId) as {campaign_id:string}|undefined;
  for(const row of rows(db,'SELECT campaign_id,started_at FROM exploratory_paper_campaigns_v1 WHERE profile_id=? ORDER BY started_at DESC LIMIT 40',profileId)) {
    const id=String(row['campaign_id']);scopes.push({id:`exploratory:${id}`,profileId,source:'exploratory',campaignId:id,label:`Combined campaign · ${new Date(Number(row['started_at'])).toISOString().slice(0,10)}`,combined:true,current:id===current?.campaign_id});
  }
  const experiments = rows(db,'SELECT id,started_at,alpaca_account_id FROM parallel_paper_experiments_v1 WHERE profile_id=? ORDER BY started_at DESC LIMIT 20',profileId);
  for(const [index,row] of experiments.entries()) for(const source of ['parallel_coqui','alpaca_paper'] as const) {
    const id=String(row['id']);scopes.push({id:`${source}:${id}`,profileId,source,campaignId:id,label:`${source==='parallel_coqui'?'Parallel Coqui':'Alpaca paper'} · ${new Date(Number(row['started_at'])).toISOString().slice(0,10)}`,combined:source==='parallel_coqui',current:current===undefined&&index===0&&source==='alpaca_paper'});
  }
  if(!scopes.some(s=>s.current))scopes[0]!.current=true;
  const wallets=listProfileConnectionsV2(profileId,db).map(c=>({id:c.id,label:c.label}));
  for(const row of experiments){const id=`alpaca:${String(row['alpaca_account_id'])}`;if(!wallets.some(w=>w.id===id))wallets.push({id,label:`Alpaca paper · ${String(row['alpaca_account_id']).slice(-6)}`});}
  return {scopes,wallets};
}
export interface TradingActivityFacts { entries: TradingActivityEntry[]; fills: ActivityFill[]; opening: Record<string,string>; decision: DecisionDetailV1|null; historyComplete:boolean; parallelWatching:Record<string,unknown>|null; balances:Record<string,string>; marks:Record<string,{priceUsd:string;source:string;atMs:number}> }
export function readTradingActivity(profileId:string,scope:ActivityScope,connectionId:string|null,selectedProduct:string,db:Db):TradingActivityFacts {
  const entries:TradingActivityEntry[]=[];const fills:ActivityFill[]=[];const opening:Record<string,string>={};let historyComplete=true;let parallelWatching:Record<string,unknown>|null=null;const balances:Record<string,string>={};const marks:TradingActivityFacts["marks"]={};
  const base=(id:string,productId:string,kind:TradingActivityEntry['kind'],atMs:number):TradingActivityEntry=>({id,profileId,scopeId:scope.id,source:scope.source,campaignId:scope.campaignId,instrumentKey:null,accountId:null,connectionId:null,productId,kind,atMs,status:'unknown',side:null,quantity:null,amountUsd:null,realizedPnlUsd:null,priceUsd:null,feeUsd:null,spreadUsd:null,slippageUsd:null,impactUsd:null,proposalId:null,decisionId:null,orderId:null,reason:null,timestampSource:'recorded_event'});
  if(scope.source==='paper_ledger'||scope.source==='exploratory') {
    if(connectionId===null){
      if(scope.source==='exploratory'){for(const balance of getExploratoryPaperCampaign(scope.campaignId!,profileId,db)?.openingBalances??[])if(balance.exposureKey!=='USD')opening[`${balance.exposureKey}-USD`]=balance.quantity;}
      else {for(const balance of getPaperBookOrigin(profileId,db)?.snapshot.balances??[])if(balance.assetId!=='USD')opening[product(balance.assetId)]=balance.quantity;}
      const origin=getPaperBookOrigin(profileId,db);
      if(scope.source==='paper_ledger') {
        for(const row of rows(db,`SELECT asset_id,quantity_text FROM paper_ledger_entries_v3 WHERE profile_id=? AND account='opening' AND asset_id IS NOT NULL AND asset_id<>'USD' ORDER BY at,id LIMIT 10000`,profileId)) {
          const pid=product(String(row['asset_id'])); if(origin===null)opening[pid]=new Decimal(opening[pid]??'0').add(String(row['quantity_text'])).toFixed();
        }
        for(const row of rows(db,`SELECT asset_id,quantity_text FROM paper_balances_v3 WHERE profile_id=? AND asset_id<>'USD' LIMIT 500`,profileId))balances[product(String(row['asset_id']))]=String(row['quantity_text']);
      } else for(const row of rows(db,`SELECT exposure_key,quantity_text FROM exploratory_paper_balances_v1 WHERE profile_id=? AND campaign_id=? AND exposure_key<>'USD' LIMIT 500`,profileId,scope.campaignId!))balances[`${String(row['exposure_key'])}-USD`]=String(row['quantity_text']);
      const records=rows(db,`SELECT f.*,o.product_id,o.side,o.run_id,o.canonical_asset_id,
        (SELECT decision_id FROM strategy_decisions_v1 d WHERE d.run_id=o.run_id AND d.profile_id=o.profile_id) AS decision_id,
        (SELECT CASE WHEN COUNT(*)=1 THEN MIN(p.id) ELSE NULL END FROM paper_execution_proposals_v1 p WHERE p.profile_id=o.profile_id AND p.run_id=o.run_id) AS proposal_id
        FROM paper_fills_v3 f JOIN paper_orders_v3 o ON o.id=f.order_id AND o.profile_id=f.profile_id
        WHERE f.profile_id=? AND ${scope.source==='exploratory'?`EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.profile_id=f.profile_id AND l.campaign_id=? AND (l.fill_id=f.id OR l.order_id=f.order_id))`:`NOT EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.profile_id=f.profile_id AND (l.fill_id=f.id OR l.order_id=f.order_id))`}
        ORDER BY f.filled_at,f.id LIMIT ?`,...([profileId,...(scope.source==='exploratory'?[scope.campaignId!]:[]),CAP+1]));
      historyComplete=records.length<=CAP;
      for(const row of records.slice(0,CAP)){const e=base(String(row['id']),String(row['product_id']),'fill',Number(row['filled_at']));Object.assign(e,{status:'filled',instrumentKey:row['canonical_asset_id'],side:row['side'],quantity:row['quantity_text'],amountUsd:row['notional_text'],priceUsd:row['execution_price_text'],feeUsd:row['venue_fee_text'],spreadUsd:row['spread_cost_text'],slippageUsd:row['slippage_cost_text'],impactUsd:row['impact_cost_text'],orderId:row['order_id'],proposalId:row['proposal_id']??null,decisionId:row['decision_id']??null,timestampSource:'recorded_fill'});entries.push(e);fills.push({id:e.id,productId:e.productId,side:e.side!,quantity:e.quantity!,price:e.priceUsd!,feeUsd:e.feeUsd,atMs:e.atMs});}
      const orderEvents=rows(db,`SELECT ev.*,o.product_id,o.side,o.canonical_asset_id,o.requested_quantity_text,o.requested_notional_text FROM paper_order_events_v3 ev JOIN paper_orders_v3 o ON o.id=ev.order_id AND o.profile_id=ev.profile_id WHERE ev.profile_id=? AND o.product_id=? AND ${scope.source==='exploratory'?`EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.profile_id=o.profile_id AND l.campaign_id=? AND l.order_id=o.id)`:`NOT EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.profile_id=o.profile_id AND l.order_id=o.id)`} ORDER BY ev.at DESC,ev.id DESC LIMIT ?`,profileId,selectedProduct,...(scope.source==='exploratory'?[scope.campaignId!]:[]),CAP+1);
      if(orderEvents.length>CAP)historyComplete=false;
      for(const ev of orderEvents.slice(0,CAP)){const detail=JSON.parse(String(ev['detail_json'])) as {reason?:string;reasonCode?:string};const e=base(String(ev['id']),String(ev['product_id']),'order',Number(ev['at']));Object.assign(e,{status:ev['state'],instrumentKey:ev['canonical_asset_id'],side:ev['side'],quantity:ev['requested_quantity_text'],amountUsd:ev['requested_notional_text'],orderId:ev['order_id'],reason:detail.reason??detail.reasonCode??null});entries.push(e);}
      const proposals=rows(db,`SELECT p.* FROM paper_execution_proposals_v1 p WHERE p.profile_id=? AND ${scope.source==='exploratory'?`EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.profile_id=p.profile_id AND l.campaign_id=? AND l.proposal_id=p.id)`:`NOT EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.profile_id=p.profile_id AND l.proposal_id=p.id)`} ORDER BY p.created_at DESC LIMIT 1001`,profileId,...(scope.source==='exploratory'?[scope.campaignId!]:[]));
      if(proposals.length>1000)historyComplete=false;
      for(const p of proposals.slice(0,1000)){const evidence=getPaperProposalEvidence(String(p['id']),db);for(const intent of JSON.parse(String(p['intents_json'])) as Array<{asset?:{instrument:{productId:string}};instrument?:{productId:string};assetId?:string;side?:'buy'|'sell';quantity?:string;amountUsd?:string;referencePriceUsd?:string}>){const pid=intent.asset?.instrument.productId??intent.instrument?.productId??(intent.assetId===undefined?null:product(intent.assetId));if(pid===null)continue;const e=base(`proposal:${String(p['id'])}:${pid}`,pid,'proposal',Number(p['created_at']));Object.assign(e,{status:String(p['status']),side:intent.side??null,amountUsd:intent.amountUsd??null,priceUsd:intent.referencePriceUsd??null,proposalId:p['id'],decisionId:evidence.decisionId,reason:evidence.reasonCode});entries.push({...e,status:'proposed'});if(Number(p['updated_at'])!==Number(p['created_at'])||!['pending_review'].includes(String(p['status'])))entries.push({...e,id:`state:${e.id}`,atMs:Number(p['updated_at'])});for(const review of rows(db,'SELECT * FROM paper_execution_reviews_v1 WHERE proposal_id=? AND profile_id=?',String(p['id']),profileId)){entries.push({...e,id:`review:${String(review['id'])}:${pid}`,kind:'review',atMs:Number(review['decided_at']),status:String(review['decision']),reason:String(review['note'])||null});}}}
    }
  }else{
    const experiment=rows(db,'SELECT * FROM parallel_paper_experiments_v1 WHERE id=? AND profile_id=?',scope.campaignId!,profileId)[0];
    const wallet=experiment===undefined?null:`alpaca:${String(experiment['alpaca_account_id'])}`;
    const events=rows(db,'SELECT * FROM parallel_paper_events_v1 WHERE experiment_id=? AND profile_id=? ORDER BY rowid LIMIT ?',scope.campaignId!,profileId,CAP+1);historyComplete=events.length<=CAP;
    const parsed=events.slice(0,CAP).map(row=>({id:String(row['id']),kind:String(row['kind']),at:Number(row['at']),detail:JSON.parse(String(row['detail_json'])) as Record<string,unknown>}));
    const latestDecision=[...parsed].reverse().find(e=>e['kind']==='decision');
    const control=[...parsed].reverse().find(e=>['started','paused','resumed','stopped'].includes(e.kind));
    parallelWatching=latestDecision===undefined?null:{...latestDecision.detail,recordedAtMs:Number(latestDecision['at']),activityState:control?.kind??'unknown',activityReason:control?.detail['reason']??null};
    const orders=new Map(parsed.filter(e=>e['kind']==='external_order').map(e=>[String(e.detail['orderId']),e.detail]));
    const intents=new Map(parsed.filter(e=>e['kind']==='external_intent').map(e=>[String(e.detail['clientOrderId']),e.detail]));
    if(connectionId===null||scope.source==='alpaca_paper'&&connectionId===wallet){
      const latestMark=[...parsed].reverse().find(e=>e.kind==='account_mark');
      if(latestMark!==undefined)for(const p of (latestMark.detail['positions']??[]) as Array<Record<string,unknown>>){
        const pid=product(String(p['symbol']));const qty=String(p[scope.source==='alpaca_paper'?'alpacaQty':'coquiQty']??'0');
        balances[pid]=qty;const value=p[scope.source==='alpaca_paper'?'alpacaValueUsd':'coquiValueUsd'];
        if(value!=null&&new Decimal(qty).gt(0))marks[pid]={priceUsd:new Decimal(String(value)).div(qty).toFixed(),source:scope.source==='alpaca_paper'?'Recorded Alpaca account valuation':'Recorded Coqui paper valuation',atMs:Number(latestMark.detail['markedAtMs']??latestMark.at)};
      }
      const seenActivities=new Set<string>();
      for(const ev of parsed){const d=ev.detail;const kind=String(ev['kind']);
        if(scope.source==='parallel_coqui'&&kind!=='local_fill')continue;
        if(scope.source==='alpaca_paper'&&!['external_fill','external_intent','external_order','submit_attempt'].includes(kind))continue;
        if(kind==='external_fill'&&d['activityId']!=null){const key=String(d['activityId']);if(seenActivities.has(key))continue;seenActivities.add(key);}
        const related=orders.get(String(d['orderId']))??intents.get(String(d['clientOrderId']));const symbol=String(d['symbol']??related?.['symbol']??'');if(!symbol)continue;
        const e=base(String(ev['id']),product(symbol),kind.endsWith('fill')?'fill':kind==='external_intent'?'proposal':'order',Number(ev['at']));
        e.connectionId=scope.source==='alpaca_paper'?wallet:null;e.accountId=scope.source==='alpaca_paper'?String(experiment!['alpaca_account_id']):null;e.instrumentKey=scope.source==='alpaca_paper'?`alpaca_paper|spot|${symbol}`:d['assetId']==null?null:String(d['assetId']);e.orderId=d['orderId']===undefined?null:String(d['orderId']);
        if(kind==='local_fill'){const qty=new Decimal(String(d['qty']));e.side=qty.gt(0)?'buy':'sell';e.quantity=qty.abs().toFixed();e.priceUsd=String(d['fillPrice']);e.feeUsd=String(d['fee']);e.timestampSource='recorded_event_fill_time_unavailable';e.status='filled';}
        else{const side=d['side']??related?.['side'];e.side=side==='buy'||side==='sell'?side:null;e.quantity=d['quantity']==null?d['qty']==null?null:String(d['qty']):String(d['quantity']);e.priceUsd=d['price']==null?null:String(d['price']);e.status=kind==='external_fill'?'filled':kind==='external_intent'?'proposed':String(d['status']??'submitted');if(kind==='external_fill'){const at=Date.parse(String(d['at']));if(Number.isFinite(at)){e.atMs=at;e.timestampSource='recorded_fill';}else e.timestampSource='recorded_event_fill_time_unavailable';}}
        entries.push(e);if(e.kind==='fill'&&e.side!==null&&e.quantity!==null&&e.priceUsd!==null)fills.push({id:e.id,productId:e.productId,side:e.side,quantity:e.quantity,price:e.priceUsd,feeUsd:e.feeUsd,atMs:e.atMs});
      }
    }
  }
  let decision:DecisionDetailV1|null=null;
  if(scope.source==='paper_ledger'||scope.source==='exploratory'){
    const candidates=rows(db,`SELECT d.decision_id FROM strategy_decisions_v1 d WHERE d.profile_id=?
      AND EXISTS(SELECT 1 FROM decision_asset_links_v1 a WHERE a.decision_id=d.decision_id AND a.profile_id=d.profile_id AND a.asset_scope IN (?, 'GLOBAL'))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM execution_routes_v1 r WHERE r.decision_id=d.decision_id AND r.profile_id=d.profile_id AND r.connection_id=?))
      AND ${scope.source==='exploratory'?`EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.decision_id=d.decision_id AND l.campaign_id=?)`:`NOT EXISTS(SELECT 1 FROM exploratory_paper_execution_links_v1 l WHERE l.decision_id=d.decision_id)`}
      ORDER BY d.created_at DESC LIMIT 1`,profileId,selectedProduct.replace(/-USD$/,''),connectionId,connectionId,...(scope.source==='exploratory'?[scope.campaignId!]:[]));
    if(candidates[0]===undefined&&connectionId!==null){const global=rows(db,`SELECT d.decision_id FROM strategy_decisions_v1 d WHERE d.profile_id=? AND EXISTS(SELECT 1 FROM decision_asset_links_v1 a WHERE a.decision_id=d.decision_id AND a.profile_id=d.profile_id AND a.asset_scope=?) ORDER BY d.created_at DESC LIMIT 1`,profileId,selectedProduct.replace(/-USD$/,''));if(global[0]!==undefined)decision=getDecisionDetail(profileId,String(global[0]['decision_id']),db);}
    if(candidates[0]!==undefined)decision=getDecisionDetail(profileId,String(candidates[0]['decision_id']),db);
  }
  return {entries,fills,opening,decision,historyComplete,parallelWatching,balances,marks};
}

/** SQLite counters cover same-timestamp updates and both local and detached writers. */
export function tradingActivityRevision(_profileId:string,db:Db):string {
  const local=db.prepare('SELECT total_changes() AS revision').get() as {revision:number};
  const external=db.prepare('PRAGMA data_version').get() as {data_version:number};
  return `${local.revision}:${external.data_version}`;
}
