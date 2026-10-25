import { describe,it,expect } from 'vitest';
import { decimal, instrumentKey, capitalHash, sourceCompletionDelayMs, strategyDecisionId, type AssetRef, type ProductRuleSnapshot, type MarketBar } from '@coqui/core';
import { createPaperCapitalBudgetPort, PaperExecutionService, runExecutionGates,isApproved, paperCostModelHash, paperCapitalDecision } from '@coqui/services';
import { PaperOmsService } from '../packages/services/src/paper/oms.js';
import { saveStrategyDecision,listCashClaims,listPaperBalances } from '@coqui/storage';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';
import { settings } from './helpers/profit-reserve.js';
import { feasibility } from './helpers/feasibility.js';
const instrument={venue:'coinbase',productType:'spot',productId:'BTC-USD'} as const,asset:AssetRef={instrument,symbol:'BTC',baseAsset:'BTC',quoteAsset:'USD',name:'Bitcoin',coingeckoId:null},key=instrumentKey(instrument);
const rule:ProductRuleSnapshot={id:capitalHash('p6-rules'),instrument,status:'online',tradingDisabled:false,cancelOnly:false,limitOnly:false,postOnly:false,viewOnly:false,baseIncrement:'0.00000001',baseMinSize:'0.00000001',baseMaxSize:null,quoteIncrement:'0.01',quoteMinSize:'1',quoteMaxSize:null,priceIncrement:'0.01',source:'coinbase',retrievedAt:1_000_000,responseHash:capitalHash('p6-rule-response')};
const market=(at:number)=>({rules:()=>rule,bars:():readonly MarketBar[]=>[{assetId:key,source:'coinbase',interval:'1d',startTimeMs:at,endTimeMs:at+1000,open:100,close:100,high:100,low:100,volume:1000,isComplete:true,retrievedAtMs:at}]});
const approve=(at:number,amount='100')=>{const result=runExecutionGates({profileId:'main',runId:'real-p6-order',nowMs:at,mode:'paper',killSwitchEngaged:false,holdings:[],activeCapitalUsd:'537.5',intents:[{asset,side:'buy',amountUsd:decimal(amount),referencePriceUsd:decimal('100'),origin:'rebalance',urgency:'standard'}],historicalGrossEdgeLowerBoundPct:12});if(!isApproved(result))throw new Error(`approval:${result.code}`);return result;};
describe('P6 all-consumer encumbrance and cash-aware entry',()=>{
  it('refuses unbound immediate, pending, settlement and manual execution constructors for a new cash book',()=>{const f=reserveServiceFixture();try{
    const oms=new PaperOmsService({database:f.db,clock:{nowMs:f.now},market:market(f.now())});
    expect(()=>oms.execute(approve(f.now()))).toThrow('budget_port_required');expect(()=>oms.settlePending('main')).toThrow('budget_port_required');
    expect(()=>new PaperExecutionService({database:f.db,profileId:'main',nowMs:f.now,market:market(f.now()),state:()=>({holdings:[],killSwitchEngaged:false,evidenceVerified:false,historicalGrossEdgeLowerBoundPct:null})})).toThrow('budget_port_required');
  }finally{f.db.close();}});
  it('a real gated OMS buy spends only free cash and cannot consume the funded reserve',()=>{const f=reserveServiceFixture();try{
    f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview();f.service.review({...f.request(),proposalId:p.id});
    const b=f.service.view().binding,port=createPaperCapitalBudgetPort({profileId:'main',scopeId:b.scope_id,database:f.db,now:f.now,version:'paper-reserve-cash-v1',marks:()=>({[key]:{priceUsd:'100',atMs:f.now(),ref:'synthetic-current-quote'}}),guardAuthority:()=>{const v=f.service.view();f.authority.check(v.policy!.id,v.binding.generation);return true;}});
    const errors:string[]=[],oms=new PaperOmsService({database:f.db,clock:{nowMs:f.now},market:market(f.now()),capitalBudget:port,onUnexpectedError:(_,e)=>errors.push(String(e))});
    const result=oms.execute(approve(f.now()));expect(errors).toEqual([]);expect(result.filledCount).toBe(1);
    expect(Number(listPaperBalances('main',f.db).find(x=>x.assetId==='USD')!.quantity)).toBeGreaterThan(12.5);
    expect(listCashClaims(b.scope_id,f.db).filter(c=>c.purpose==='profit_reserve')).toHaveLength(1);
    expect(port.budget().state).toBe('available');expect(Number(port.budget().activeEquityUsd)).toBeLessThan(537.5);
  }finally{f.db.close();}});
  it('two reviews and an actual OMS pricing/commit race cannot spend one budget revision twice',()=>{const f=reserveServiceFixture();try{
    f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview(),r={...f.request(),proposalId:p.id};
    let raced=false;const rules={...rule,get baseIncrement(){if(!raced){raced=true;f.service.review(r);}return rule.baseIncrement;}};
    const port=createPaperCapitalBudgetPort({profileId:'main',scopeId:r.scopeId,database:f.db,now:f.now,version:'paper-reserve-cash-v1',marks:()=>({[key]:{priceUsd:'100',atMs:f.now(),ref:'synthetic'}}),guardAuthority:()=>{const v=f.service.view();f.authority.check(v.policy!.id,v.binding.generation);return true;}});
    const oms=new PaperOmsService({database:f.db,clock:{nowMs:f.now},market:{...market(f.now()),rules:()=>rules},capitalBudget:port});
    expect(oms.execute(approve(f.now())).filledCount).toBe(0);expect(f.service.view().state?.reservedUsd).toBe('12.5');
    expect(listCashClaims(r.scopeId,f.db).filter(c=>c.purpose==='profit_reserve')).toHaveLength(1);
    expect(()=>f.service.review({...r,commandId:f.uuid(999)})).toThrow('revision_stale');
    expect(listPaperBalances('main',f.db).find(x=>x.assetId==='USD')?.quantity).toBe('550');
  }finally{f.db.close();}});
  it('reviews a 30-second capital preview and settles a real pending first buy with its own claim counted once',()=>{const f=reserveServiceFixture();try{
    f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());
    const scope=f.service.view().binding.scope_id;
    const port=createPaperCapitalBudgetPort({profileId:'main',scopeId:scope,database:f.db,now:f.now,version:'paper-reserve-cash-v1',marks:()=>({[key]:{priceUsd:'100',atMs:f.now(),ref:'synthetic-current'}}),guardAuthority:()=>{const v=f.service.view();f.authority.check(v.policy!.id,v.binding.generation);return true;}});
    const base=feasibility('500'),next=f.now()+1000,reference=market(f.now()-1000).bars()[0]!,future={...market(next).bars()[0]!,retrievedAtMs:next};
    const tape={rules:()=>rule,bars:()=>[reference,future]},model={assets:()=>[{...base.assets[0]!,markUsd:'100',quote:{bid:'100',ask:'100',atMs:f.now()}}],fees:()=>({...base.fees,rate:'0.006',slippageBps:'25',expiresAtMs:f.now()+30_000}),policy:()=>base.policy};
    const svc=new PaperExecutionService({database:f.db,profileId:'main',nowMs:f.now,market:tape,capitalBudget:port,capitalPreviewModel:model,executionOwnerId:'p6-host',state:()=>({holdings:[],killSwitchEngaged:false,evidenceVerified:true,historicalGrossEdgeLowerBoundPct:10})});
    const decisionId=strategyDecisionId('main',f.now());
    saveStrategyDecision({schemaVersion:1,decisionId,profileId:'main',runId:'pending-p6',scheduledForMs:f.now(),strategy:{id:'synthetic-p6',version:'paper-reserve-cash-v1',configHash:capitalHash('synthetic')},market:{snapshotHash:capitalHash('tape'),asOfMs:f.now()-1000,expectedAsOfMs:f.now()-1000,freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:rule.id,rulesFresh:true},portfolio:{snapshotHash:port.budget().id,version:'paper-reserve-cash-v1',source:'paper_ledger'},targets:[{assetId:key,weight:0.2}],cashWeight:0.8,exposure:0.2,historyStatus:'complete',facts:null,createdAtMs:f.now()},f.db);
    const prepared=svc.prepare({proposalId:capitalHash('pending-p6-proposal'),runId:'pending-p6',revision:1,intents:approve(f.now()).intents,pending:{decisionId,requiredExecutionBarStartMs:next,costModelHash:paperCostModelHash()}});expect(prepared.status).toBe('pending');
    const preview=svc.preview(prepared.proposalId);expect(preview.status).toBe('available');expect(preview.expiresAtMs).toBe(f.now()+30_000);
    const result=svc.review({commandId:f.uuid(951),proposalId:prepared.proposalId,proposalHash:prepared.proposalHash,decision:'approve',previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs,reviewer:'synthetic operator',note:'mechanics only'});
    expect(result.status).toBe('submitted');expect(listCashClaims(scope,f.db).some(c=>c.purpose==='order'&&c.state==='committed')).toBe(true);
    expect(f.service.preview().state).not.toBe('eligible');f.service.disarm();expect(f.service.resume(f.request()).armed).toBe(true);
    f.advance(2001+sourceCompletionDelayMs('coinbase'));const settled=svc.settlePending();expect(settled.filledCount).toBe(1);
    expect(listCashClaims(scope,f.db).filter(c=>c.purpose==='order').at(-1)?.state).toBe('settled');
    expect(port.budget().spendableUsd).toBe(port.budget().observedCashUsd);
  }finally{f.db.close();}});
  it('allows the first legal cash-only target without fabricating a holding, and makes missing prices explicit',()=>{
    const base=feasibility('500'),frame={...base,budget:{...base.budget,executionEligible:true,assurance:'observed' as const},policy:{...base.policy,maxEntryFraction:'0.1'}};
    const decision=paperCapitalDecision({profileId:'main',scheduledForMs:1_000_000,assets:[asset],targets:{rebalanceBandPct:1,targets:[{instrument,weight:0.1}]},frame});
    expect(decision.intents[0]?.side).toBe('buy');expect(Number(decision.intents[0]?.amountUsd)).toBe(50);
    expect(()=>paperCapitalDecision({profileId:'main',scheduledForMs:1_000_000,assets:[asset],targets:{rebalanceBandPct:1,targets:[{instrument,weight:0.1}]},frame:{...frame,assets:[]}})).toThrow('price_missing');
  });
});
