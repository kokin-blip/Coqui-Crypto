import { describe,it,expect } from 'vitest';
import { buildDecisionMarketDataset, capitalHash, instrumentKey, nativeExecutionRules, sourceCompletionDelayMs, type AssetRef, type MarketBar } from '@coqui/core';
import { createPaperReserveRuntime } from '@coqui/services';
import { currentBudget,paperReserveBinding,listCashClaims,listPaperBalances,listPaperExecutionProposals } from '@coqui/storage';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';import { settings } from './helpers/profit-reserve.js';import { feasibility,rules } from './helpers/feasibility.js';
const DAY=86_400_000,instrument={venue:'coinbase',productType:'spot',productId:'BTC-USD'} as const,key=instrumentKey(instrument),asset:AssetRef={instrument,symbol:'BTC',name:'Bitcoin',baseAsset:'BTC',quoteAsset:'USD',coingeckoId:null};
describe('P6 new-book scheduler uses real reviewed next-open machinery',()=>{
  it('creates a new decision identity, journals pending demand, settles the attainable bar once and never runs the legacy initializer',()=>{
    const f=reserveServiceFixture();try{
      f.advance(3*DAY+1000-f.now());const start=f.now();
      const bars:MarketBar[]=Array.from({length:3},(_,i)=>({assetId:key,source:'coinbase',interval:'1d',startTimeMs:i*DAY,endTimeMs:(i+1)*DAY,open:100,high:100,low:100,close:100,volume:1000,isComplete:true,retrievedAtMs:start}));
      const dataset=buildDecisionMarketDataset({[key]:bars},[key],{policy:'reject-on-gap',nowMs:start}),scope=paperReserveBinding('main',f.db)!.scope_id;
      const native=nativeExecutionRules({...rules,quantityIncrement:{state:'known',value:'0.00000001'},observedAtMs:start,expiresAtMs:start+30_000});
      const legacy={id:capitalHash('runtime-rule'),instrument,status:'online' as const,tradingDisabled:false,cancelOnly:false,limitOnly:false,postOnly:false,viewOnly:false,baseIncrement:'0.00000001',baseMinSize:'0.00000001',baseMaxSize:null,quoteIncrement:'0.01',quoteMinSize:'1',quoteMaxSize:null,priceIncrement:'0.01',source:'coinbase' as const,retrievedAt:start,responseHash:capitalHash('runtime-rule-response')};
      const template=feasibility('500'),previewModel={assets:()=>[{assetId:key,markUsd:'100',rules:native,quote:{bid:'100',ask:'100',atMs:start}}],fees:()=>({...template.fees,rate:'0.006',slippageBps:'25',expiresAtMs:start+30_000}),policy:()=>template.policy};
      const model={strategy:()=>f.strategy,marks:()=>({[key]:{priceUsd:'100',atMs:f.now(),ref:capitalHash({syntheticMarkAt:f.now()})}}),requirements:()=>{const b=currentBudget(scope,f.now(),f.db)!;return{strategyHash:capitalHash(f.strategy),objective:'fixed_request' as const,frame:{...template,budget:b,expectedRevision:b.revision,nowMs:f.now(),assets:previewModel.assets(),fees:previewModel.fees(),intents:[{assetId:key,deltaQuantity:'0.25',reason:'entry' as const,strategyRef:'synthetic-p6'}]}};}};
      const runtime=createPaperReserveRuntime({profileId:'main',database:f.db,clock:{nowMs:f.now},model,previewModel,authorityContext:f.authorityContext,market:{rules:()=>legacy,bars:()=>bars},assets:()=>[asset],targets:()=>({rebalanceBandPct:1,targets:[{instrument,weight:0.1}]}),preparation:()=>({ok:true,datasetHash:dataset.report.datasetHash,dataset,latestCompletedStartMs:2*DAY,expectedCompletedStartMs:2*DAY,ruleSnapshotHash:legacy.responseHash})});
      const request=()=>{const v=runtime.service.view();return {...f.request(),generation:v.binding.generation,policyId:v.binding.policy_id,stateId:v.binding.state_id,budgetRevision:v.budget!.revision,authorityHash:v.authorityHash};};
      runtime.service.savePolicy({...request(),settings:settings()});runtime.service.authorize(request());
      const summary=runtime.runDecision(3*DAY);expect(summary.standDown).toBe('pending_review');
      const proposal=listPaperExecutionProposals('main',10,f.db)[0]!,preview=runtime.execution().preview(proposal.id);
      const submitted=runtime.execution().review({commandId:f.uuid(960),proposalId:proposal.id,proposalHash:proposal.proposalHash,decision:'approve',previewHash:preview.previewHash,previewExpiresAtMs:preview.expiresAtMs,reviewer:'synthetic operator',note:'production mechanics only'});expect(submitted.status).toBe('submitted');
      expect(f.db.prepare('SELECT required_bar_start FROM paper_pending_executions_v1').get()!['required_bar_start']).toBe(4*DAY);
      expect(runtime.runDecision(3*DAY)).toEqual(summary);expect(listCashClaims(scope,f.db).filter(c=>c.purpose==='order'&&c.state==='committed')).toHaveLength(1);
      bars.push({...bars[0]!,startTimeMs:4*DAY,endTimeMs:5*DAY,retrievedAtMs:5*DAY+sourceCompletionDelayMs('coinbase')});f.advance(5*DAY+sourceCompletionDelayMs('coinbase')+1-f.now());
      runtime.runDecision(5*DAY);expect(f.db.prepare('SELECT COUNT(*) n FROM paper_fills_v3').get()!['n']).toBe(1);
      expect(listCashClaims(scope,f.db).filter(c=>c.purpose==='order').at(-1)?.state).toBe('settled');expect(Number(listPaperBalances('main',f.db).find(r=>r.assetId===key)!.quantity)).toBeGreaterThan(0);
      expect(f.db.prepare('SELECT COUNT(*) n FROM paper_book_origins_v1').get()!['n']).toBe(0);
    }finally{f.db.close();}
  });
});
