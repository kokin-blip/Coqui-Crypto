import { budgetAmount as a, budgetText as t, capitalHash, instrumentKey, nativeExecutionRules, knownNativeRule as known, unknownNativeRule as unknown,
  inapplicableNativeRule as na, DEFAULT_TRADE_COST_CONFIG, trendVolTargets, DEFAULT_MOMENTUM_CONFIG, DEFAULT_VOL_TARGET_CONFIG, BudgetDecimal as D, firstAttainableDailyOpen, type Clock, type AllocationPolicy, type AssetRef, type PriceSource, type SpotPriceObservation, type ReserveSettings, type PaperReservePolicy } from '@coqui/core';
import { getAllocationPolicy, currentBudget, paperReserveBinding, getAuthoritativeHost, acquireExecutionLease, readPaperReserveFact, saveStrategyDecision, appendDecisionEvidenceEvent, type Db } from '@coqui/storage';
import { readStrategyHealth, paperCapitalDecision, createPaperReserveRuntime, createPaperReserveSaleApp, assemblePaperReserveSaleInput, readPaperReserveSaleSourceReview, capturePaperCapitalEvidence, PAPER_CAPITAL_DECISION_VERSION, paperCostModelHash, type PaperMarketData, type PaperDecisionPreparation } from '@coqui/services';
import { fullApplicationArtifactHash } from './research-provenance.js';
import {withinDeadline,type RequestDeadline} from '@coqui/adapters';
/** Exact new strategy/code/cost identity intentionally has no inherited qualification. */
export function createMainPaperReserveRuntime(input:{profileId:string;database:Db;clock:Clock;hostId:string;market:PaperMarketData;preparation:()=>PaperDecisionPreparation;operationAllowed:()=>boolean;priceSource:PriceSource}) {
  const {profileId,database:db,clock}=input;
  let currentQuotes:ReadonlyMap<string,SpotPriceObservation>=new Map();
  const codeRevision=fullApplicationArtifactHash();
  const basePolicy=()=>getAllocationPolicy(db);
  const strategy=(settings?:ReserveSettings)=>{const b=paperReserveBinding(profileId,db),policy=b?.policy_id?readPaperReserveFact<PaperReservePolicy>('policy',b.policy_id,db):null;return {strategyId:`${PAPER_CAPITAL_DECISION_VERSION}:${capitalHash({allocation:basePolicy(),reserve:settings??policy?.settings??null,momentum:DEFAULT_MOMENTUM_CONFIG,volTarget:DEFAULT_VOL_TARGET_CONFIG})}`,codeRevision,costProfileHash:paperCostModelHash(),horizonMs:86_400_000,normalization:'gross_pct_per_turnover' as const};};
  const targets=():AllocationPolicy=>{
    const p=basePolicy(),prep=input.preparation();if(!prep.ok || !p.targets.some(t=>t.weight>0))return {...p,targets:[]};
    const positive=p.targets.filter(t=>t.weight>0),total=positive.reduce((s,t)=>s+t.weight,0);
    const mix=prep.dataset.dayKeys.map((_,i)=>positive.reduce((s,t)=>{const series=prep.dataset.closesById[instrumentKey(t.instrument)];if(!series?.[0] || !series[i])throw new Error('paper_capital_strategy_history_missing');return s+t.weight/total*series[i]/series[0];},0));
    const trend=trendVolTargets(p.targets.map(t=>({assetId:instrumentKey(t.instrument),weight:t.weight})),prep.dataset.closesById,mix);
    if(trend.historyStatus!=='complete')throw new Error('paper_capital_strategy_history_missing');
    return {...p,targets:trend.targets.map(t=>({instrument:p.targets.find(x=>instrumentKey(x.instrument)===t.assetId)!.instrument,weight:t.weight}))};
  };
  const assets=():readonly AssetRef[]=>basePolicy().targets.map(t=>{const symbol=t.instrument.productId.split('-')[0]!;return {instrument:t.instrument,symbol,name:symbol,baseAsset:symbol,quoteAsset:'USD',coingeckoId:null};});
  const previewAssets=()=>assets().map(asset=>{
    const id=instrumentKey(asset.instrument),r=input.market.rules(id);
    const field=(value:string|null|undefined)=>value===undefined?unknown('paper_rule_missing'):value===null?na('paper_rule_no_bound'):known(value);
    const rule=nativeExecutionRules({provider:'coinbase',environment:'production_read_only',assetId:id,productId:asset.instrument.productId,baseCurrency:asset.baseAsset,quoteCurrency:'USD',form:'market_quantity',timeInForce:'gtc',tradable:r?r.status==='online' && !r.tradingDisabled && !r.cancelOnly && !r.limitOnly && !r.postOnly && !r.viewOnly:null,
      assurance:'observed',quantityIncrement:field(r?.baseIncrement),quantityMin:field(r?.baseMinSize),quantityMax:field(r?.baseMaxSize),quoteIncrement:field(r?.quoteIncrement),quoteMin:field(r?.quoteMinSize),quoteMax:field(r?.quoteMaxSize),priceIncrement:field(r?.priceIncrement),observedAtMs:r?.retrievedAt??0,expiresAtMs:(r?.retrievedAt??0)+30_000,source:'existing-paper-rule-evidence',evidenceRefs:r?[r.responseHash]:[]});
    const spot=currentQuotes.get(id),price=spot?.observedAtMs!==null && spot?.observedAtMs!==undefined?spot.priceUsd:'0',atMs=spot?.observedAtMs??0;
    // Dated reference price plus the separately labeled paper spread/slippage model, never an invented live bid/ask.
    return {assetId:id,markUsd:price,quote:{bid:price,ask:price,atMs},rules:rule};
  });
  const fees=()=>({id:paperCostModelHash(),rate:t(a(String(DEFAULT_TRADE_COST_CONFIG.feeBps)).div(10_000)),fixedUsd:'0',currency:'USD' as const,slippageBps:String(DEFAULT_TRADE_COST_CONFIG.spreadBps+DEFAULT_TRADE_COST_CONFIG.slippageBps),assurance:'scenario' as const,expiresAtMs:Number.MAX_SAFE_INTEGER});
  const riskPolicy=()=>({id:capitalHash({version:PAPER_CAPITAL_DECISION_VERSION,basePolicy:basePolicy(),momentum:DEFAULT_MOMENTUM_CONFIG,volatility:DEFAULT_VOL_TARGET_CONFIG}),maxOrders:8,maxOrderUsd:'100000000',maxTurnoverUsd:'100000000',usedTurnoverUsd:'0',maxEntryFraction:'0.2',maxPositionFraction:'0.35',accountMaxPositionFraction:'0.35',maxInvestedFraction:'0.8',accountMaxInvestedFraction:'0.8',discretionaryFloorUsd:String(DEFAULT_TRADE_COST_CONFIG.minUsefulTradeUsd),riskExitBypassesDiscretionaryFloor:false,killSwitchEngaged:false});
  const frame=(atMs=clock.nowMs())=>{const b=paperReserveBinding(profileId,db),budget=b?currentBudget(b.scope_id,atMs,db):null;if(!budget)throw new Error('paper_capital_book_unavailable');
    const list=previewAssets(),target=targets();
    const intents=target.targets.flatMap(t=>{const id=instrumentKey(t.instrument),mark=list.find(a=>a.assetId===id)?.markUsd;if(!mark || !a(mark).gt(0) || budget.activeEquityUsd===null)return [];
      const delta=a(budget.activeEquityUsd).mul(String(t.weight)).div(mark).sub(budget.positions[id]??'0');return delta.isZero()?[]:[{assetId:id,deltaQuantity:delta.toFixed(),reason:'rebalance' as const,strategyRef:PAPER_CAPITAL_DECISION_VERSION}];});
    const raw={budget,expectedRevision:budget.revision,nowMs:atMs,assets:list,fees:fees(),policy:riskPolicy(),intents};
    if(!budget.executionEligible)return raw;
    const decision=paperCapitalDecision({profileId,scheduledForMs:atMs,targets:target,assets:assets(),frame:raw});
    return {...raw,intents:decision.report.orders.map(o=>({assetId:o.assetId,deltaQuantity:o.side==='buy'?o.quantity:t(a(o.quantity).neg()),reason:'rebalance' as const,strategyRef:PAPER_CAPITAL_DECISION_VERSION}))};};
  const runtime=createPaperReserveRuntime({profileId,database:db,clock,market:input.market,preparation:input.preparation,targets,assets,previewModel:{assets:previewAssets,fees,policy:riskPolicy},
    model:{strategy,requirements:settings=>({strategyHash:capitalHash(strategy(settings)),objective:'fixed_request',frame:frame()}),marks:()=>Object.fromEntries([...currentQuotes].map(([id,q])=>[id,{priceUsd:q.priceUsd,atMs:q.observedAtMs??0,ref:capitalHash({assetId:id,observation:q}),source:q.source,quality:q.quality}]))},
    prepareAuthority:()=>{acquireExecutionLease(profileId,input.hostId,clock.nowMs(),60_000,db);},authorityContext:()=>{const host=getAuthoritativeHost(profileId,db),lease=db.prepare('SELECT fencing_token FROM execution_leases_v1 WHERE profile_id=? AND owner_id=?').get(profileId,input.hostId) as {fencing_token:number}|undefined;
      return {profileId,ownerId:input.hostId,hostGeneration:host?.fencingGeneration??-1,fencingToken:lease?.fencing_token??-1,strategy:strategy(),strategyPaused:()=>readStrategyHealth(profileId,strategy().strategyId,db)?.state==='paused',operationAllowed:input.operationAllowed};}});
  const saleFees=()=>{const terms=fees(),factor=a('1').sub(a(terms.slippageBps).div(10000)),minimum=a(riskPolicy().discretionaryFloorUsd);
    if(!minimum.gt(0)||!factor.gt(0)||(DEFAULT_TRADE_COST_CONFIG.impactCoefBps??0)!==0)throw new Error('sale_execution_cost_consequence_unsupported');
    // Three independently rounded eight-decimal components: fee, spread and slippage.
    // Bound reference-notional fees through P2's execution-notional convention.
    const rate=a(terms.rate).add(a('0.000000015').div(minimum)).div(factor).toDecimalPlaces(30,D.ROUND_CEIL).toFixed();
    return {...terms,rate,id:capitalHash({version:'paper-reserve-sale-rounded-cost-bound-v1',paperCost:paperCostModelHash(),minimumUsd:t(minimum),rate})};};
  const sale=createPaperReserveSaleApp({profileId,database:db,now:()=>clock.nowMs(),service:runtime.service,authority:runtime.authority,
    current:(preferences,atMs)=>assemblePaperReserveSaleInput(profileId,atMs,preferences,{...frame(atMs),fees:saleFees()},db),
    asset:id=>{const asset=assets().find(x=>instrumentKey(x.instrument)===id);if(!asset)throw new Error('sale_asset_identity_mismatch');return asset;},
    evidence:policy=>readPaperReserveSaleSourceReview(profileId,policy,codeRevision,db),execution:guard=>runtime.execution(guard,{assets:previewAssets,fees:saleFees,policy:riskPolicy}),
    pending:(consequence,runId)=>{const prep=input.preparation(),atMs=clock.nowMs();if(!prep.ok)throw new Error('paper_capital_strategy_history_missing');
      const decisionId=capitalHash({profileId,runId,purpose:'profit_reserve_sale'}),target=targets(),weights=target.targets.map(x=>({assetId:instrumentKey(x.instrument),weight:x.weight}));
      const decision=saveStrategyDecision({schemaVersion:1,decisionId,profileId,runId,scheduledForMs:atMs,strategy:{id:strategy().strategyId,version:'paper-reserve-sale-v1',configHash:capitalHash({strategy:strategy(),consequenceId:consequence.id})},
        market:{snapshotHash:prep.datasetHash,asOfMs:prep.latestCompletedStartMs,expectedAsOfMs:prep.expectedCompletedStartMs,freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:prep.ruleSnapshotHash,rulesFresh:true},
        portfolio:{snapshotHash:currentBudget(consequence.scopeId,atMs,db)!.id,version:'paper-reserve-cash-v1',source:'paper_ledger'},targets:weights,cashWeight:Math.max(0,1-weights.reduce((s,w)=>s+w.weight,0)),exposure:weights.reduce((s,w)=>s+w.weight,0),historyStatus:'complete',facts:null,createdAtMs:atMs},db);
      appendDecisionEvidenceEvent({schemaVersion:1,decisionId,profileId,sequence:0,kind:'strategy_evaluated',atMs,detail:{decisionHash:decision.contentHash}},db);
      return {decisionId,requiredExecutionBarStartMs:firstAttainableDailyOpen(prep.latestCompletedStartMs,atMs),costModelHash:paperCostModelHash()};},
    settle:()=>{runtime.execution().settlePending();},capture:()=>{capturePaperCapitalEvidence(profileId,clock.nowMs(),Object.fromEntries([...currentQuotes].map(([id,q])=>[id,{priceUsd:q.priceUsd,atMs:q.observedAtMs??0,ref:capitalHash({assetId:id,observation:q})}])),db);}});
  return {...runtime,sale,disarm(){sale.disarm();runtime.disarm();},async refreshMarketEvidence(deadline?:RequestDeadline){deadline?.check();const instruments=assets().map(a=>a.instrument);if(instruments.every(i=>{const q=currentQuotes.get(instrumentKey(i));return q?.observedAtMs!==null && q?.observedAtMs!==undefined && clock.nowMs()-q.observedAtMs<30_000 && q.observedAtMs<=clock.nowMs();}))return;const observed=await withinDeadline(input.priceSource.spot(instruments),deadline);deadline?.check();currentQuotes=observed;}};
}
