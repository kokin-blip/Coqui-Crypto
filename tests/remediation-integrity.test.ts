import { describe, expect, it, vi } from 'vitest';
import { createStudyInstance, validateStudyProvenance } from '../packages/core/src/index.js';
import { appendRemediationEvidence, listRemediationEvidence, openDatabase, registerStudyInstance,
  listStudyInstances, assignAuthoritativeHost, recordHostReconciliation, takeoverAuthoritativeHost } from '../packages/storage/src/index.js';
import { createRequestDeadline, createResearchDeadline, deadlineHttp, type HttpRequestInit } from '../packages/adapters/src/index.js';
import { parallelExecutionClaim } from '../packages/services/src/paper/parallel-execution-safety.js';
import { parallelFeeAccounting } from '../packages/services/src/paper/parallel-fee-accounting.js';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';

const START=Date.parse('2026-10-15T00:00:00Z'), HASH='a'.repeat(64);
const definition={version:1 as const,profileId:'main',experimentId:'experiment',candidateId:'candidate',signalVersion:'signal-v1',
  policyVersion:'policy-v1',executionVersion:'execution-v1',costVersion:'cost-v1',dataVersion:'data-v1',behaviorHash:HASH,
  opening:'common_cash_100000' as const,startMs:START,foldEndsMs:[START+20*86_400_000],holdoutEndMs:START+50*86_400_000};
describe('durable remediation integrity',()=>{
  it('isolates study instances while keeping immutable records',()=>{
    const db=openDatabase(':memory:'), a=createStudyInstance(definition,START-1000,HASH),
      b=createStudyInstance({...definition,policyVersion:'policy-v2'},START-1000,HASH);
    registerStudyInstance(a,db); registerStudyInstance(b,db);
    for(const study of [a,b]) appendRemediationEvidence({profileId:'main',namespace:study.id,kind:'book',key:'slot',atMs:START,body:{cash:'100000'}},db);
    expect(listStudyInstances('main','candidate',db)).toHaveLength(2);
    expect(listRemediationEvidence('main',a.id,'book',db)).toHaveLength(1);
    expect(listRemediationEvidence('other',a.id,'book',db)).toHaveLength(0);
    expect(()=>db.exec('DELETE FROM remediation_evidence_v1')).toThrow('immutable');
    expect(()=>validateStudyProvenance(a,{...definition,behaviorHash:'b'.repeat(64)})).toThrow('registered_study_source_changed');
    db.close();
  });
  it('rejects retrospective registration and dates out of order',()=>{
    expect(()=>createStudyInstance(definition,START,HASH)).toThrow('invalid_study_instance');
    expect(()=>createStudyInstance({...definition,foldEndsMs:[START-1]},START-1000,HASH)).toThrow('invalid_study_instance');
  });
  it('bounds preparation by both monotonic work and the execution window',()=>{
    let wall=START,mono=0;const deadline=createRequestDeadline(()=>wall,30_000,START+1000,()=>mono);
    expect(deadline.remainingMs()).toBe(1000);wall+=1001;expect(()=>deadline.check()).toThrow('deadline_exceeded');deadline.dispose();
    wall=START;const second=createRequestDeadline(()=>wall,30_000,START+60_000,()=>mono);mono=30_001;
    expect(()=>second.check()).toThrow('deadline_exceeded');second.dispose();
  });
  it('preempts research acquisition when execution preparation begins',()=>{
    const research=createResearchDeadline(()=>START);expect(research.signal.aborted).toBe(false);
    const execution=createRequestDeadline(()=>START);expect(research.signal.aborted).toBe(true);execution.dispose();
  });
  it('propagates request budget and priority without another retry layer',async()=>{
    const getJson=vi.fn(async(_url: string, _init?: HttpRequestInit)=>{ void _url; void _init; return {ok:true as const,status:200,data:{}}; });
    const deadline=createRequestDeadline(()=>START,1000);
    await deadlineHttp({getJson,postJson:vi.fn(),getText:vi.fn(),destroy:vi.fn()} as never,deadline).getJson('https://example.test');
    expect(getJson).toHaveBeenCalledTimes(1);expect(getJson.mock.calls[0]?.[1]).toMatchObject({requestPriority:'execution',signal:deadline.signal});
    deadline.dispose();
  });
  it('fences an old host immediately after a takeover',()=>{
    const db=openDatabase(':memory:');assignAuthoritativeHost('main','desktop-a','desktop',START,db);
    const claim=parallelExecutionClaim('main','desktop-a',db,()=>START);claim.check();
    const id=recordHostReconciliation({profileId:'main',hostId:'headless-b',observedGeneration:1,at:START,detail:{}},db);
    takeoverAuthoritativeHost({profileId:'main',hostId:'headless-b',hostKind:'headless',reconciliationId:id,at:START},db);
    expect(()=>claim.check()).toThrow('stale_host_authority');claim.release();db.close();
  });
  it('reconciles crypto buy fees and cash sell fees without charging modeled costs',()=>{
    let n=0;const event=(kind:string,detail:Record<string,unknown>):ParallelPaperEvent=>({id:String(n++),profileId:'main',experimentId:'e',kind,at:START,detail});
    const events=[event('external_order',{orderId:'buy',side:'buy'}),event('external_fill',{orderId:'buy',symbol:'BTCUSD',quantity:'2',price:'100'}),
      event('external_order',{orderId:'sell',side:'sell'}),event('external_fill',{orderId:'sell',symbol:'BTCUSD',quantity:'1',price:'110'}),
      event('external_fee',{activityId:'crypto',symbol:'BTCUSD',quantity:'0.005',price:'100',at:'2026-10-15T00:01:00Z'}),
      event('external_fee',{activityId:'cash',netAmount:'-0.275'}),
      event('account_mark',{alpacaCashUsd:'909.725',positions:[{symbol:'BTCUSD',alpacaQty:'0.995'}]})];
    const result=parallelFeeAccounting(events,{openingAlpacaCash:'1000'} as ParallelPaperExperiment);
    expect(result).toMatchObject({knownCashFeesUsd:'0.275',reportedPriceEquivalentUsd:'0.775',cryptoFeeQuantities:{BTC:'0.005'},
      cashResidualUsd:'0',quantityResiduals:{BTC:'0'},modeledCostsDeductedFromBrokerEquity:false});
  });
});

describe('observed execution measurements',()=>{
  it('measures signed VWAP shortfall and actual timestamps without calling equity changes slippage',async()=>{
    const {parallelExecutionMeasurements}=await import('../packages/services/src/paper/parallel-execution-measurement.js');
    let n=0;const event=(kind:string,at:number,detail:Record<string,unknown>):ParallelPaperEvent=>({id:String(n++),profileId:'main',experimentId:'e',kind,at,detail});
    const events=[event('pre_order_quote',START,{clientOrderId:'client',midpoint:'100'}),event('submit_attempt',START+100,{clientOrderId:'client'}),
      event('external_order',START+200,{orderId:'buy',clientOrderId:'client',symbol:'BTCUSD',side:'buy',status:'partially_filled'}),
      event('external_fill',START+300,{activityId:'a',orderId:'buy',quantity:'1',price:'101',at:new Date(START+300).toISOString()}),
      event('external_fill',START+400,{activityId:'b',orderId:'buy',quantity:'1',price:'103',at:new Date(START+400).toISOString()}),
      event('external_order',START+400,{orderId:'buy',clientOrderId:'client',symbol:'BTCUSD',side:'buy',status:'filled'}),
      event('intraday_check',START+14_400_000,{quotes:{BTCUSD:{bid:'104',ask:'106',atMs:START+14_400_000}}})];
    expect(parallelExecutionMeasurements(events)[0]).toMatchObject({fillVwap:'102',signedShortfallUsd:'4',firstFillLatencyMs:200,
      completionLatencyMs:300,partialFillObserved:true,subsequentMatchedMidpoint:'105',signedPostFillMoveUsd:'6',modeled:false});
    expect(parallelExecutionMeasurements(events.filter((e)=>e.kind!=='pre_order_quote'))[0]?.signedShortfallUsd).toBeNull();
  });
});

describe('last submission boundary',()=>{
  it('blocks a changed account identity before producing a submission quote',async()=>{
    const {recordParallelPreOrder}=await import('../packages/services/src/paper/parallel-paper-intraday.js');
    const quote=vi.fn();
    const client={asset:async()=>({symbol:'BTCUSD',status:'active',tradable:true,min_trade_increment:'0.01',min_order_size:'0.01'}),
      account:async()=>({id:'changed',status:'PAPER_ONLY',cash:'100000',equity:'100000',trading_blocked:false,account_blocked:false}),positions:async()=>[],latestCryptoQuotes:quote};
    await expect(recordParallelPreOrder(client as never,()=>START,vi.fn(),{clientOrderId:'id',symbol:'BTCUSD',side:'buy',qty:'1'}, {}, 'day','expected'))
      .rejects.toThrow('alpaca_asset_rules_unavailable');expect(quote).not.toHaveBeenCalled();
  });
  it('ignores a late noncancellable credential response after deadline cancellation',async()=>{
    const {withinDeadline}=await import('../packages/adapters/src/index.js');
    const deadline=createRequestDeadline(()=>START);let complete:(value:string)=>void=()=>{};
    const response=new Promise<string>((resolve)=>{complete=resolve;});const pending=withinDeadline(response,deadline);
    const assertion=expect(pending).rejects.toThrow('deadline_exceeded');deadline.dispose();await assertion;complete('late');
    expect(deadline.signal.aborted).toBe(true);
  });
});
