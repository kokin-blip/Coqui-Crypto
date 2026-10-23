import {describe,expect,it,vi} from 'vitest';
import {createAlpacaPaperClient,createMemorySecretStore} from '../packages/adapters/src/index.js';
import {parseAlpacaPortfolioHistory} from '../packages/adapters/src/http/alpaca-portfolio-history.js';
import {projectBrokerEquity,profileConnectionV2,sha256Hex} from '../packages/core/src/index.js';
import {openDatabase,saveProfileConnectionV2,saveParallelExperiment,type Db} from '../packages/storage/src/index.js';
import {createAlpacaPerformanceHandlers} from '../apps/desktop/src/main/alpaca-performance-handlers.js';
import {createDispatcher} from '../apps/desktop/src/main/dispatch.js';
const raw={base_value:100000,timestamp:[100,200,300],equity:[100000,105000,103383.28],profit_loss:[0,5000,3383.28],cashflow:{JNLC:[100000,12190.60,0],CFEE:[0,-20,0]}};
const account={id:'broker-123456',currency:'USD',cash:'2000',equity:'104929.64',status:'ACTIVE',trading_blocked:false,account_blocked:false};
function seed(db:Db){
  const connection=profileConnectionV2('main','coinbase',sha256Hex('performance-key'),1);saveProfileConnectionV2(connection,db);
  const snapshot=sha256Hex('performance-snapshot'),id=sha256Hex('performance-experiment');
  db.prepare('INSERT INTO connection_account_snapshots_v2 VALUES (?,?,?,?,?,?,?,?,?,?)').run(snapshot,'main',connection.id,'coinbase',1,1,'healthy','{}',sha256Hex('performance-content'),1);
  saveParallelExperiment({id,profileId:'main',sourceConnectionSnapshotId:snapshot,alpacaAccountId:account.id,openingCoquiCash:'100000',openingAlpacaCash:'100000',openingAlpacaEquity:'100000',anchor:{},startedAt:1,configVersion:'fixture'},db);
  return {scopeId:`alpaca_paper:${id}`,connectionId:`alpaca:${account.id}`};
}
function executionState(db:Db){return db.prepare(`SELECT
  (SELECT COUNT(*) FROM paper_orders_v3) AS orders,
  (SELECT COUNT(*) FROM paper_fills_v3) AS fills,
  (SELECT COUNT(*) FROM paper_ledger_entries_v3) AS ledger,
  (SELECT COUNT(*) FROM parallel_paper_experiments_v1) AS experiments`).get();}
describe('broker account performance',()=>{
  it('uses bounded read-only portfolio history on the paper host with continuous crypto P/L',async()=>{
    const fetcher=vi.fn(async(...args:Parameters<typeof fetch>)=>{void args;return Response.json(raw);});const client=createAlpacaPaperClient({keyId:'fixture',secretKey:'secret-canary'},fetcher);
    const result=await client.portfolioHistory('2026-09-24','2026-10-20');
    const url=new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin+url.pathname).toBe('https://paper-api.alpaca.markets/v2/account/portfolio/history');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({pnl_reset:'no_reset',cashflow_types:'ALL',intraday_reporting:'continuous',timeframe:'1D'});
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({method:'GET'});
    expect(result.points.at(-1)).toMatchObject({equityUsd:'103383.28',reportedPnlUsd:'3383.28'});
    expect(result.cashflows?.['JNLC']).toEqual(['100000','12190.6','0']);
    await expect(client.portfolioHistory('bad-date','2026-10-20')).rejects.toMatchObject({code:'invalid_response'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched arrays, non-finite money, duplicate timestamps and malformed cashflow evidence',()=>{
    for(const invalid of [{...raw,equity:[1]},{...raw,base_value:'NaN'},{...raw,timestamp:[100,100,300]},
      {...raw,cashflow:{JNLC:[0]}},{...raw,cashflow:{JNLC:['Infinity',0,0]}}])expect(()=>parseAlpacaPortfolioHistory(invalid)).toThrow();
    expect(parseAlpacaPortfolioHistory({...raw,equity:[100000,null,103383.28]}).points[1]?.equityUsd).toBeNull();
  });
  it('never labels a cash-adjusted equity increase as net trading profit or subtracts fees again',()=>{
    const result=projectBrokerEquity({equityUsd:'104929.64',openingEquityUsd:'100000',history:parseAlpacaPortfolioHistory(raw)});
    expect(result).toMatchObject({equityUsd:'104929.64',equityChangeUsd:'4929.64',cashAdjustmentsUsd:'12190.60',netPnlUsd:null,netPnlReason:'cash_adjustments_require_reconciliation'});
    expect(projectBrokerEquity({equityUsd:'1',openingEquityUsd:'1',history:{points:[],cashflows:null}}).cashAdjustmentsUsd).toBeNull();
  });
  it('binds reads to the selected profile/account, deduplicates concurrent reads and never returns credentials',async()=>{
    const db=openDatabase(':memory:'),filter=seed(db),secrets=createMemorySecretStore();let now=400000;
    await secrets.write('alpaca-paper-credentials',JSON.stringify({keyId:'fixture',secretKey:'secret-canary'}),'main');
    const client={allActivities:vi.fn(async()=>[]),orders:vi.fn(async()=>[]),account:vi.fn(async()=>account),portfolioHistory:vi.fn(async()=>parseAlpacaPortfolioHistory(raw))};
    const dispatch=createDispatcher({handlers:createAlpacaPerformanceHandlers({profileId:'main',database:db,now:()=>now,secrets,clientFactory:()=>client})});
    const before=executionState(db);
    const [one,two]=await Promise.all([dispatch('alpaca.paper.performance',filter),dispatch('alpaca.paper.performance',filter)]);
    expect(one).toMatchObject({status:'ok',value:{accountSuffix:'123456',equityChangeUsd:'4929.64',netPnlUsd:null}});expect(two).toEqual(one);
    expect(client.account).toHaveBeenCalledTimes(2);expect(client.portfolioHistory).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(one)).not.toContain('secret-canary');
    expect(await dispatch('alpaca.paper.performance',{...filter,connectionId:'foreign'})).toMatchObject({status:'failed'});
    expect(await dispatch('alpaca.paper.performance',{...filter,scopeId:'ledger'})).toMatchObject({status:'failed'});
    now+=30001;await dispatch('alpaca.paper.performance',filter);expect(client.account).toHaveBeenCalledTimes(4);
    expect(executionState(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM capital_source_batches_v1').get()?.['n']).toBeGreaterThan(0);
    await secrets.remove('alpaca-paper-credentials','main');expect(await dispatch('alpaca.paper.performance',filter)).toMatchObject({status:'failed'});db.close();
  });
  it('refuses a different broker account before reading its history',async()=>{
    const db=openDatabase(':memory:'),filter=seed(db),secrets=createMemorySecretStore();
    await secrets.write('alpaca-paper-credentials',JSON.stringify({keyId:'fixture',secretKey:'secret-canary'}),'main');
    const client={allActivities:async()=>[],orders:async()=>[],account:async()=>({...account,id:'different'}),portfolioHistory:vi.fn(async()=>parseAlpacaPortfolioHistory(raw))};
    const dispatch=createDispatcher({handlers:createAlpacaPerformanceHandlers({profileId:'main',database:db,now:()=>400000,secrets,clientFactory:()=>client})});
    expect(await dispatch('alpaca.paper.performance',filter)).toMatchObject({status:'failed',issues:[{code:'broker_performance_account_mismatch'}]});
    expect(client.portfolioHistory).not.toHaveBeenCalled();db.close();
  });
  it('reconciles all pages of activity and orders before reporting net account P/L',async()=>{
    const db=openDatabase(':memory:'),filter=seed(db),secrets=createMemorySecretStore();
    let now=400000;
    await secrets.write('alpaca-paper-credentials',JSON.stringify({keyId:'fixture',secretKey:'secret-canary'}),'main');
    const funding={id:'funding',activity_type:'JNLC',currency:'USD',status:'executed',net_amount:'100000',created_at:new Date(0).toISOString()};
    const fees=Array.from({length:99},(_,i)=>({id:`fee-${i}`,activity_type:'FEE',currency:'USD',status:'executed',net_amount:'0',created_at:new Date(150000).toISOString()}));
    const fill={id:'fill',order_id:'order',activity_type:'FILL',symbol:'BTC/USD',qty:'1',price:'1000',side:'buy',transaction_time:new Date(150000).toISOString()};
    const current={...account,cash:'111190.60',equity:'112290.60'};
    const client={account:vi.fn(async()=>current),portfolioHistory:async()=>parseAlpacaPortfolioHistory(raw),
      allActivities:vi.fn(async(token?:string)=>token?[fill]:[funding,...fees]),
      orders:async()=>[{id:'order',client_order_id:'fixture',symbol:'BTC/USD',side:'buy' as const,status:'filled',qty:'1',filled_qty:'1',filled_avg_price:'1000',submitted_at:null,filled_at:null}]};
    const before=executionState(db);
    const dispatch=createDispatcher({handlers:createAlpacaPerformanceHandlers({profileId:'main',database:db,now:()=>now,secrets,clientFactory:()=>client})});
    expect(await dispatch('alpaca.paper.performance',filter)).toMatchObject({status:'ok',value:{netPnlUsd:'100.00',netPnlReason:'cash_reconciled',cashReconciliation:{reconciled:true,journalDetailsComplete:false,fillCount:1}}});
    expect(client.allActivities.mock.calls).toEqual([[undefined],['fee-98']]);
    expect(client.account).toHaveBeenCalledTimes(2);
    now+=30001;client.account.mockResolvedValueOnce({...current,cash:'111190.61'}).mockResolvedValueOnce(current);
    expect(await dispatch('alpaca.paper.performance',filter)).toMatchObject({status:'ok',value:{netPnlUsd:null}});
    expect(executionState(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM capital_source_batches_v1').get()?.['n']).toBeGreaterThan(0);db.close();
  });
  it('withholds net P/L when a secondary ledger read fails, while retaining broker equity',async()=>{
    const db=openDatabase(':memory:'),filter=seed(db),secrets=createMemorySecretStore();
    await secrets.write('alpaca-paper-credentials',JSON.stringify({keyId:'fixture',secretKey:'secret-canary'}),'main');
    const client={account:async()=>account,portfolioHistory:async()=>parseAlpacaPortfolioHistory(raw),allActivities:async()=>{throw new Error('secondary unavailable');},orders:async()=>[]};
    const dispatch=createDispatcher({handlers:createAlpacaPerformanceHandlers({profileId:'main',database:db,now:()=>400000,secrets,clientFactory:()=>client})});
    expect(await dispatch('alpaca.paper.performance',filter)).toMatchObject({status:'ok',value:{equityUsd:account.equity,netPnlUsd:null}});db.close();
  });
  it('requests unfiltered complete account activities using GET with a safely encoded cursor',async()=>{
    const fetcher=vi.fn(async()=>Response.json([]));const client=createAlpacaPaperClient({keyId:'fixture',secretKey:'fixture'},fetcher);
    await client.allActivities('cursor&activity_types=FILL');
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    const params=new URL(url).searchParams;expect(params.has('activity_types')).toBe(false);
    expect(params.get('page_token')).toBe('cursor&activity_types=FILL');expect(options.method).toBe('GET');
  });
});
