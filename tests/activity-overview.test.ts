import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exploratoryCampaignHash, exploratoryValuationHash, sha256Hex, activityWindowStart, boundActivityPoints, prepareActivityOverview, projectActivityMetrics, projectActivityTotalHistory,
  windowActivityTotal, type ActivityOverviewEntry, type ActivityFill } from '../packages/core/src/index.js';
import { saveExploratoryPaperCampaign, saveExploratoryPaperValuation, openDatabase, readActivityValuations, tradingActivityScopes } from '../packages/storage/src/index.js';
import { createTradingActivityHandlers } from '../apps/desktop/src/main/trading-activity-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import type { ChannelResponse } from '../packages/contracts/src/index.js';

const entry=(id:string,side:'buy'|'sell',quantity:string,price:string,atMs:number,orderId=id,feeUsd:string|null='1'):ActivityOverviewEntry=>({
  id,side,quantity,priceUsd:price,atMs,orderId,feeUsd,productId:'BTC-USD',kind:'fill',accountId:null,connectionId:null,
  instrumentKey:'coinbase|spot|BTC-USD',status:'partially_filled',reason:null,timestampSource:'recorded_fill',
});
const prepare=(entries:ActivityOverviewEntry[],extra:Partial<Parameters<typeof prepareActivityOverview>[0]>={})=>prepareActivityOverview({
  entries,fills:entries.filter(e=>e.kind==='fill').map((e):ActivityFill=>({id:e.id,productId:e.productId,side:e.side!,quantity:e.quantity!,price:e.priceUsd!,feeUsd:e.feeUsd,atMs:e.atMs})),
  opening:{},balances:{},historyComplete:true,...extra,
});
const metrics=(prepared:ReturnType<typeof prepare>,fromMs=100)=>projectActivityMetrics(prepared,{productId:null,fromMs,now:400,marks:{'BTC-USD':{priceUsd:'130',atMs:400}}});

describe('scoped algorithm performance projection',()=>{
  it('replays purchases before the window, groups partial executions and reconciles chart and summary',()=>{
    const buy=entry('buy','buy','3','100',10,'buy','3');
    const a=entry('a','sell','1','120',200,'exit');const b=entry('b','sell','1','90',200,'exit');
    const prepared=prepare([buy,a,b,b]);const value=metrics(prepared);
    expect(value).toMatchObject({realizedPnlUsd:'6',unrealizedPnlUsd:'29',wins:1,losses:0,executedOrders:1});
    expect(value.orders[0]).toMatchObject({quantity:'2',averagePriceUsd:'105',feeUsd:'2',fillCount:2,status:'partially_filled',realizedPnlUsd:'6'});
    expect(value.closedChart.points).toEqual([{atMs:100,valueUsd:'0'},{atMs:200,valueUsd:'6'},{atMs:400,valueUsd:'6'}]);
  });
  it('separates in-window execution from lifetime totals and counts net sell-order outcomes',()=>{
    const prepared=prepare([entry('buy','buy','3','100',1),entry('s0','sell','1','110',50,'sell'),entry('s1','sell','1','90',200,'sell')]);
    const value=metrics(prepared);
    expect(value).toMatchObject({wins:0,losses:1,executedOrders:1});
    expect(value.orders[0]).toMatchObject({fillCount:1,lifetimeFillCount:2,quantity:'1'});
  });
  it('does not turn missing fees, imported basis, incomplete history or mismatches into profit',()=>{
    const entries=[entry('b','buy','2','100',1),entry('s','sell','1','120',200,'s',null)];
    expect(metrics(prepare(entries))).toMatchObject({realizedPnlUsd:null,unknownExits:1,closedChart:{available:false}});
    expect(metrics(prepare(entries,{opening:{'BTC-USD':'2'}}))).toMatchObject({realizedPnlUsd:null,unrealizedPnlUsd:null});
    expect(metrics(prepare(entries,{historyComplete:false}))).toMatchObject({realizedPnlUsd:null,unrealizedPnlUsd:null});
    expect(metrics(prepare([entry('b','buy','2','100',1)],{balances:{'BTC-USD':'3'}}))).toMatchObject({unrealizedPnlUsd:null});
  });
  it('keeps assets, accounts and order identities separate and ignores proposals',()=>{
    const a=entry('a','buy','1','100',200,'same');
    const b={...entry('b','buy','1','100',200,'same'),accountId:'other'};
    const c={...entry('c','buy','1','100',200,'same'),productId:'ETH-USD',instrumentKey:'coinbase|spot|ETH-USD'};
    const value=metrics(prepare([a,b,c,{...entry('p','buy','1','100',200),kind:'proposal'}]));
    expect(value.executedOrders).toBe(3);expect(new Set(value.orders.map(o=>o.key)).size).toBe(3);
    expect(projectActivityMetrics(prepare([a,c]),{productId:'ETH-USD',fromMs:100,now:400,marks:{}}).orders).toHaveLength(1);
  });
  it('reports confirmed empty closed periods as flat zero, stale marks and unknown fill-time labels separately',()=>{
    expect(metrics(prepare([]))).toMatchObject({realizedPnlUsd:'0',executedOrders:0,closedChart:{available:true}});
    const prepared=prepare([{...entry('b','buy','1','100',1),timestampSource:'recorded_event_fill_time_unavailable'}]);
    const value=projectActivityMetrics(prepared,{productId:null,fromMs:0,now:100000,marks:{'BTC-USD':{priceUsd:'110',atMs:1}}});
    expect(value.valuation).toBe('stale');expect(value.orders[0]?.timestampEstimated).toBe(true);
  });
  it('builds historical total P/L from recorded per-asset quantities and values and preserves missing evidence',()=>{
    const prepared=prepare([entry('b','buy','2','100',1),entry('s','sell','1','120',200)]);
    const points=projectActivityTotalHistory(prepared,[
      {atMs:100,positions:{'BTC-USD':{quantity:'2',valueUsd:'220'}},simulationEquityUsd:null},
      {atMs:150,positions:null,simulationEquityUsd:null},
      {atMs:300,positions:{'BTC-USD':{quantity:'1',valueUsd:'130'}},simulationEquityUsd:null},
    ],null);
    expect(points).toEqual([{atMs:100,valueUsd:'19'},{atMs:150,valueUsd:null},{atMs:300,valueUsd:'48'}]);
    expect(windowActivityTotal(points,50,400)).toMatchObject({available:true,startAtMs:100,points:[{atMs:100,valueUsd:'0'},{atMs:150,valueUsd:null},{atMs:300,valueUsd:'29'}]});
    expect(windowActivityTotal(points,200,400).available).toBe(false);
    const unrelated=projectActivityTotalHistory(prepared,[{atMs:100,positions:{'BTC-USD':{quantity:'3',valueUsd:'330'}},simulationEquityUsd:null}],null);
    expect(unrelated[0]?.valueUsd).toBeNull();
  });
  it('accepts equity-only evidence solely for combined simulation scope, never for a selected asset',()=>{
    const valuations=[{atMs:100,positions:null,simulationEquityUsd:'1000'},{atMs:300,positions:null,simulationEquityUsd:'1010'}];
    expect(windowActivityTotal(projectActivityTotalHistory(prepare([]),valuations,null),0,400).points.at(-1)?.valueUsd).toBe('10');
    expect(windowActivityTotal(projectActivityTotalHistory(prepare([]),valuations,'BTC-USD'),0,400).available).toBe(false);
  });
  it('handles local day boundaries including daylight saving changes and bounds chart samples',()=>{
    const now=Date.parse('2026-11-01T20:00:00Z');
    expect(activityWindowStart(now,'today','America/New_York',0)).toBe(Date.parse('2026-11-01T04:00:00Z'));
    expect(activityWindowStart(now,'today','America/Phoenix',0)).toBe(Date.parse('2026-11-01T07:00:00Z'));
    const points=Array.from({length:5000},(_,i)=>({atMs:i,valueUsd:String(i===2020?-10000:i===3030?20000:i)}));
    const bounded=boundActivityPoints(points);expect(bounded.length).toBeLessThanOrEqual(256);
    expect(bounded[0]).toEqual(points[0]);expect(bounded.at(-1)).toEqual(points.at(-1));
    expect(bounded).toContainEqual(points[2020]);expect(bounded).toContainEqual(points[3030]);
  });
  it('replays high-volume history once per snapshot timeline rather than once per prefix',()=>{
    const entries=Array.from({length:4000},(_,i)=>entry(String(i),i%2?'sell':'buy','1',i%2?'110':'100',i,String(i),'0'));
    const prepared=prepare(entries);const started=performance.now();
    const points=projectActivityTotalHistory(prepared,Array.from({length:1000},(_,i)=>({atMs:i*4+3,positions:{},simulationEquityUsd:null})),null);
    expect(points).toHaveLength(1000);expect(points.at(-1)?.valueUsd).toBe('20000');expect(performance.now()-started).toBeLessThan(1500);
  });
});

const filter={scopeId:'ledger',connectionId:null,productId:null,period:'all',timeZone:'America/Phoenix'} as const;
function seed(db:ReturnType<typeof openDatabase>,id:string,side:'buy'|'sell',at:number,product='BTC-USD',qty='1',price=side==='buy'?'100':'120',orderId=id){
  if(!db.prepare('SELECT id FROM paper_orders_v3 WHERE id=?').get(orderId))db.prepare('INSERT INTO paper_orders_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,'main',orderId,product,`coinbase|spot|${product}`,side,qty,price,'filled','rules','snapshot',null,at,at);
  db.prepare('INSERT INTO paper_fills_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,orderId,'main',qty,price,price,'1','0','0','0',at,'market');
}
describe('activity overview IPC boundary',()=>{
  it('reads exploratory campaign valuations without attributing them to a wallet or individual asset',async()=>{
    const db=openDatabase(':memory:');try{
      const campaign={schemaVersion:1 as const,campaignId:sha256Hex('campaign'),profileId:'main',commandId:'start',admissionMode:'exploratory' as const,
        strategyId:'trendvol-exploratory-paper-v1' as const,sourcePortfolioSnapshotId:sha256Hex('snapshot'),sourcePortfolioHash:sha256Hex('portfolio'),
        strategyConfigHash:sha256Hex('config'),strategyCodeHash:sha256Hex('code'),costModelHash:sha256Hex('cost'),baseWeights:[],baseWeightsHash:sha256Hex('weights'),
        openingBalances:[],openingCashUsd:'1000',openingCashProvenance:'connected_snapshot' as const,openingEquityUsd:'1000',startedAtMs:1,
        eligibleForValidation:false as const,eligibleForPromotion:false as const,eligibleForLiveExecution:false as const};
      // The immutable campaign references a unified snapshot; the source evidence is a fixture only.
      db.prepare(`INSERT INTO unified_portfolio_snapshots_v2 VALUES (?,?,?,?,?,?,?)`).run(campaign.sourcePortfolioSnapshotId,'main',1,1,'{}',sha256Hex('unified-content'),1);
      saveExploratoryPaperCampaign({...campaign,contentHash:exploratoryCampaignHash(campaign)},db);
      for(const [asOfMs,equityUsd] of [[100,'1000'],[200,'1010']] as const){
        const material={schemaVersion:1 as const,campaignId:campaign.campaignId,profileId:'main',asOfMs,equityUsd,buyAndHoldBenchmarkUsd:null,estimatedCostsUsd:'0',unpricedCount:0};
        const contentHash=exploratoryValuationHash(material);
        saveExploratoryPaperValuation({...material,contentHash,id:sha256Hex(`exploratory-valuation:${contentHash}`)},db);
      }
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>300,mark:()=>null})});
      const request={...filter,scopeId:`exploratory:${campaign.campaignId}`};
      expect(await dispatch('trading.activity.overview',request)).toMatchObject({status:'ok',value:{accountLabel:'Combined simulation',totalChart:{available:true,points:[{atMs:100,valueUsd:'0'},{atMs:200,valueUsd:'10'}]}}});
      expect(await dispatch('trading.activity.overview',{...request,productId:'BTC-USD'})).toMatchObject({status:'ok',value:{totalChart:{available:false}}});
    }finally{db.close();}
  });

  it('validates overview/detail responses, frozen equal-time pagination, invalid filters and same-time database revisions',async()=>{
    const db=openDatabase(':memory:');try{
      for(let i=0;i<25;i++)seed(db,`buy-${i}`,'buy',100);
      seed(db,'sell','sell',200);
      let now=300;
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>now,mark:()=>({priceUsd:'130',source:'test',atMs:now})})});
      const read=await dispatch('trading.activity.overview',filter);expect(read.status).toBe('ok');if(read.status!=='ok')throw new Error(JSON.stringify(read));
      const overview=read.value as ChannelResponse<'trading.activity.overview'>;
      expect(overview).toMatchObject({accountLabel:'Combined simulation',realizedPnlUsd:'18',executedOrders:26,orders:{items:expect.any(Array)}});
      expect(overview.orders.items).toHaveLength(20);expect(overview.orders.nextCursor).not.toBeNull();
      const next=await dispatch('trading.activity.orders',{...filter,limit:20,cursor:overview.orders.nextCursor});expect(next.status).toBe('ok');
      if(next.status!=='ok')throw new Error(JSON.stringify(next));
      const page=next.value as ChannelResponse<'trading.activity.orders'>;
      expect(page.items).toHaveLength(6);expect(new Set([...overview.orders.items,...page.items].map(order=>order.key)).size).toBe(26);
      const order=overview.orders.items[0]!;
      expect(await dispatch('trading.activity.order-detail',{...filter,orderKey:order.key,cursor:null})).toMatchObject({status:'ok',value:{fills:[{id:'sell',realizedPnlUsd:'18'}]}});
      expect(await dispatch('trading.activity.order-detail',{...filter,scopeId:'other',orderKey:order.key,cursor:null})).toMatchObject({status:'failed'});
      expect(await dispatch('trading.activity.orders',{...filter,productId:'ETH-USD',limit:20,cursor:overview.orders.nextCursor})).toMatchObject({status:'failed'});
      expect(await dispatch('trading.activity.overview',{...filter,timeZone:'invalid'})).toMatchObject({status:'failed'});
      expect(await dispatch('trading.activity.overview',{...filter,connectionId:'another-wallet'})).toMatchObject({status:'failed'});
      now=400;seed(db,'later','buy',350,'ETH-USD');
      expect(await dispatch('trading.activity.orders',{...filter,limit:20,cursor:overview.orders.nextCursor})).toMatchObject({status:'ok',value:{items:page.items}});
      expect(await dispatch('trading.activity.overview',filter)).toMatchObject({status:'ok',value:{executedOrders:27}});
      const other=createDispatcher({handlers:createTradingActivityHandlers({profileId:'other',database:db,now:()=>now,mark:()=>null})});
      expect(await other('trading.activity.overview',filter)).toMatchObject({status:'ok',value:{executedOrders:0}});
      expect(readActivityValuations('main',tradingActivityScopes('main',db).scopes[0]!,null,db)).toEqual([]);
    }finally{db.close();}
  });
  it('invalidates its cached projection when a detached SQLite writer records a same-timestamp fill',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'coqui-activity-revision-'));
    const db=openDatabase(join(directory,'activity.db'));const writer=openDatabase(join(directory,'activity.db'));
    try{
      seed(db,'buy','buy',100);
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>300,mark:()=>null})});
      expect(await dispatch('trading.activity.overview',filter)).toMatchObject({status:'ok',value:{executedOrders:1}});
      seed(writer,'sell','sell',100);
      expect(await dispatch('trading.activity.overview',filter)).toMatchObject({status:'ok',value:{executedOrders:2,realizedPnlUsd:'18'}});
    }finally{writer.close();db.close();rmSync(directory,{recursive:true,force:true});}
  });
  it('keeps the newest executions visible after the cost-basis history cap',async()=>{
    const db=openDatabase(':memory:');try{
      seed(db,'first','buy',1,'BTC-USD','1','100','bulk-order');
      const insert=db.prepare('INSERT INTO paper_fills_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      db.exec('BEGIN');
      for(let i=2;i<=50001;i++)insert.run(`bulk-${i}`,'bulk-order','main','1','100','100','0','0','0','0',i,'market');
      db.exec('COMMIT');
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>60000,mark:()=>null})});
      const read=await dispatch('trading.activity.overview',filter);
      expect(read).toMatchObject({status:'ok',value:{historyComplete:false,realizedPnlUsd:null,unrealizedPnlUsd:null,
        orders:{items:[{atMs:50001,fillCount:50001}]}}});
    }finally{db.close();}
  },15000);
  it('pages order fills and keeps buy rows free of invented realized P/L',async()=>{
    const db=openDatabase(':memory:');try{
      for(let i=0;i<101;i++)seed(db,`fill-${i}`,'buy',i+1,'BTC-USD','1','100','order');
      const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database:db,now:()=>1000,mark:()=>null})});
      const read=await dispatch('trading.activity.overview',filter);if(read.status!=='ok')throw new Error(JSON.stringify(read));
      const order=(read.value as ChannelResponse<'trading.activity.overview'>).orders.items[0]!;
      expect(order).toMatchObject({fillCount:101,realizedPnlUsd:null,quantity:'101'});
      const detail=await dispatch('trading.activity.order-detail',{...filter,orderKey:order.key,cursor:null});
      expect(detail.status).toBe('ok');if(detail.status!=='ok')throw new Error(JSON.stringify(detail));
      const cursor=(detail.value as ChannelResponse<'trading.activity.order-detail'>).nextCursor;expect(cursor).not.toBeNull();
      expect(await dispatch('trading.activity.order-detail',{...filter,orderKey:order.key,cursor})).toMatchObject({status:'ok',value:{fills:[{id:'fill-0'}],nextCursor:null}});
    }finally{db.close();}
  });
});
