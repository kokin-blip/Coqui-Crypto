import { describe, expect, it } from 'vitest';
import { profileConnectionV2, sha256Hex } from '../packages/core/src/index.js';
import { openDatabase, saveProfileConnectionV2, saveParallelExperiment, appendParallelEvent, tradingActivityScopes, readTradingActivity, type Db } from '../packages/storage/src/index.js';
import { createTradingActivityHandlers } from '../apps/desktop/src/main/trading-activity-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';

function seedParallel(db:Db) {
  const connection=profileConnectionV2('main','coinbase',sha256Hex('key'),1);saveProfileConnectionV2(connection,db);
  const snapshot=sha256Hex('snapshot');
  db.prepare(`INSERT INTO connection_account_snapshots_v2 VALUES (?,?,?,?,?,?,?,?,?,?)`).run(snapshot,'main',connection.id,'coinbase',1,1,'healthy','{}',sha256Hex('content'),1);
  const experiment=sha256Hex('experiment');
  saveParallelExperiment({id:experiment,profileId:'main',sourceConnectionSnapshotId:snapshot,alpacaAccountId:'broker',openingCoquiCash:'1000',openingAlpacaCash:'1000',openingAlpacaEquity:'1000',anchor:{},startedAt:1,configVersion:'v1'},db);
  let sequence=0;
  const append=(kind:string,detail:Record<string,unknown>)=>appendParallelEvent({profileId:'main',experimentId:experiment,kind,key:String(sequence++),at:100+sequence,detail},db);
  append('local_fill',{symbol:'BTCUSD',assetId:'coinbase|spot|BTC-USD',qty:'2',fillPrice:'101',fee:'2'});
  append('local_fill',{symbol:'BTCUSD',assetId:'coinbase|spot|BTC-USD',qty:'-1',fillPrice:'120',fee:'1'});
  append('external_order',{orderId:'buy',symbol:'BTCUSD',side:'buy',status:'partially_filled',qty:'1'});
  append('external_fill',{activityId:'fill-a',orderId:'buy',symbol:'BTCUSD',quantity:'1',price:'100',at:new Date(10).toISOString()});
  append('external_fill',{activityId:'fill-a',orderId:'buy',symbol:'BTCUSD',quantity:'1',price:'100',at:new Date(10).toISOString()});
  append('account_mark',{markedAtMs:110,positions:[{symbol:'BTCUSD',coquiQty:'1',coquiValueUsd:'125',alpacaQty:'3',alpacaValueUsd:'375'}]});
  return {connection,experiment};
}
describe('persisted activity sources',()=>{
  it('keeps parallel sources and wallets separate, deduplicates broker activities, and flags unseen inventory',async()=>{
    const db=openDatabase(':memory:');try{
      const {connection,experiment}=seedParallel(db);
      const scopes=tradingActivityScopes('main',db);expect(scopes.scopes.find(s=>s.current)?.source).toBe('alpaca_paper');
      const local=scopes.scopes.find(s=>s.source==='parallel_coqui')!;
      const broker=scopes.scopes.find(s=>s.source==='alpaca_paper')!;
      const localFacts=readTradingActivity('main',local,null,'BTC-USD',db);expect(localFacts.fills.map(f=>f.side)).toEqual(['buy','sell']);
      expect(readTradingActivity('main',local,connection.id,'BTC-USD',db).fills).toEqual([]);
      const brokerFacts=readTradingActivity('main',broker,'alpaca:broker','BTC-USD',db);expect(brokerFacts.fills).toHaveLength(1);expect(brokerFacts.fills[0]?.feeUsd).toBeNull();
      expect(brokerFacts.balances['BTC-USD']).toBe('3');expect(brokerFacts.marks['BTC-USD']?.priceUsd).toBe('125');
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>120,mark:()=>null})});
      const summary=await dispatch('trading.activity.summary',{scopeId:`parallel_coqui:${experiment}`,connectionId:null,productId:'BTC-USD'});
      expect(summary).toMatchObject({status:'ok',value:{positions:[{quantity:'1',markUsd:'125',realizedPnlUsd:'17',unrealizedPnlUsd:'23',entryAtMs:null}]}});
      expect(await dispatch('trading.activity.summary',{scopeId:broker.id,connectionId:'alpaca:broker',productId:'BTC-USD'})).toMatchObject({status:'ok',value:{positions:[{quantity:'3',basisComplete:false,valuation:'partial',unrealizedPnlUsd:null}]}});
      expect(await dispatch('trading.activity.summary',{scopeId:`parallel_coqui:${sha256Hex('foreign')}`,connectionId:null,productId:'BTC-USD'})).toMatchObject({status:'failed'});
    }finally{db.close();}
  });
  it('does not subtract spread and slippage again from embedded execution prices',async()=>{
    const db=openDatabase(':memory:');try{
      for(const [id,side,price,at] of [['buy','buy','101',1],['sell','sell','120',2]] as const){
        db.prepare('INSERT INTO paper_orders_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'main',id,'BTC-USD','coinbase|spot|BTC-USD',side,'1',price,'filled','rules','snapshot',null,at,at);
        db.prepare('INSERT INTO paper_fills_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(`fill-${id}`,id,'main','1',price,price,'1','2','3','4',at,'market');
      }
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>3,mark:()=>({priceUsd:'125',source:'test',atMs:3})})});
      expect(await dispatch('trading.activity.summary',{scopeId:'ledger',connectionId:null,productId:'BTC-USD'})).toMatchObject({status:'ok',value:{positions:[{quantity:'0',realizedPnlUsd:'17'}]}});
      expect(await dispatch('trading.activity.trail',{scopeId:'ledger',connectionId:null,productId:'BTC-USD',cursor:null,limit:30})).toMatchObject({status:'ok',value:{items:[{kind:'fill',side:'sell',realizedPnlUsd:'17',spreadUsd:'2',slippageUsd:'3',impactUsd:'4'},{kind:'fill',side:'buy',realizedPnlUsd:null}]}});
    }finally{db.close();}
  });
});
