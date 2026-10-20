import type { ActivityValuation } from '@coqui/core';
import type { ActivityScope } from './trading-activity.js';
import type { Db } from '../sqlite/index.js';

type Row=Record<string,unknown>;
const product=(value:string)=>value.includes('|')?value.split('|').at(-1)!:value.replace(/\/?USD$/,'-USD');
/** Read existing immutable evidence only. No capture, repricing, or account equity substitution. */
export function readActivityValuations(profileId:string,scope:ActivityScope,connectionId:string|null,db:Db):ActivityValuation[] {
  if(scope.source==='exploratory'){
    if(connectionId!==null)return [];
    const records=db.prepare(`SELECT as_of,equity_usd_text,unpriced_count FROM exploratory_paper_valuations_v1
      WHERE profile_id=? AND campaign_id=? ORDER BY as_of DESC LIMIT 5000`).all(profileId,scope.campaignId!) as Row[];
    return records.reverse().map(row=>({atMs:Number(row['as_of']),positions:null,
      simulationEquityUsd:Number(row['unpriced_count'])===0&&row['equity_usd_text']!=null?String(row['equity_usd_text']):null}));
  }
  if(scope.source==='paper_ledger'){
    if(connectionId!==null)return [];
    const records=db.prepare(`SELECT captured_at,positions_json,unpriced_count FROM paper_daily_valuation_evidence_v1
      WHERE profile_id=? ORDER BY captured_at DESC LIMIT 5000`).all(profileId) as Row[];
    return records.reverse().map(row=>{
      const positions:NonNullable<ActivityValuation['positions']>={};
      for(const p of JSON.parse(String(row['positions_json'])) as Row[]){
        const instrument=p['instrument'] as Row|undefined;
        const id=instrument?.['productId']??p['productId'];
        if(id===undefined)continue;
        positions[String(id)]={quantity:String(p['quantity']),valueUsd:p['valueUsd']==null?null:String(p['valueUsd'])};
      }
      return {atMs:Number(row['captured_at']),positions:Number(row['unpriced_count'])>0?null:positions,simulationEquityUsd:null};
    });
  }
  const records=db.prepare(`SELECT at,detail_json FROM parallel_paper_events_v1 WHERE profile_id=? AND experiment_id=?
    AND kind='account_mark' ORDER BY rowid DESC LIMIT 5000`).all(profileId,scope.campaignId!) as Row[];
  return records.reverse().map(row=>{
    const detail=JSON.parse(String(row['detail_json'])) as Row;
    const positions:NonNullable<ActivityValuation['positions']>={};
    for(const p of (detail['positions']??[]) as Row[]){
      const quantity=p[scope.source==='alpaca_paper'?'alpacaQty':'coquiQty'];
      const value=p[scope.source==='alpaca_paper'?'alpacaValueUsd':'coquiValueUsd'];
      positions[product(String(p['symbol']))]={quantity:String(quantity??'0'),valueUsd:value==null?null:String(value)};
    }
    return {atMs:Number(detail['markedAtMs']??row['at']),positions,simulationEquityUsd:null};
  });
}
