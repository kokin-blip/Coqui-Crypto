import { capitalHash, firstAttainableDailyOpen, strategyDecisionId, budgetAmount as a, decimal, instrumentKey, type AllocationPolicy, type AssetRef, type Clock, type Holding } from '@coqui/core';
import { getPaperCapitalBook, paperReserveBinding, readPaperReserveFact, appendPaperReserveEvent, listPaperReserveFacts, saveWalletDecisionRun, getWalletDecisionRun, saveStrategyDecision, appendDecisionEvidenceEvent, listSubmittedPaperExecutions, type Db } from '@coqui/storage';
import { capturePaperCapitalEvidence } from '../portfolio/paper-capital-evidence.js';
import { createPaperProfitReserveService, type PaperReserveModel } from '../portfolio/paper-profit-reserve.js';
import { createPaperCapitalBudgetPort } from './capital-budget-port.js';
import { createPaperReserveAuthority, type PaperReserveAuthorityContext } from './paper-reserve-authority.js';
import { paperCapitalDecision, PAPER_CAPITAL_DECISION_VERSION } from './paper-capital-decision.js';
import { PaperExecutionService } from './execution-service.js';
import type { PaperCapitalPreviewModel } from './capital-preview.js';
import type { PaperMarketData } from './oms.js';
import { paperCostModelHash } from './venue.js';
import type { PaperDecisionPreparation, PaperRunSummary } from './runtime-model.js';
export function paperReserveCadenceSlot(cadence:'manual'|'daily'|'weekly'|'monthly',nowMs:number):string|null {
  if(cadence==='manual')return null;const date=new Date(nowMs);
  if(cadence==='monthly')return `month:${date.toISOString().slice(0,7)}`;
  const day=Math.floor(nowMs/86_400_000);return cadence==='daily'?`day:${day}`:`week:${Math.floor((day+3)/7)}`;
}
/** Single local book, a shared budget port, and process-local authority. No adapter/transfer/registration dependency. */
export function createPaperReserveRuntime(input:{profileId:string;database:Db;clock:Clock;model:PaperReserveModel;previewModel:PaperCapitalPreviewModel;
  prepareAuthority?:()=>void;authorityContext:()=>PaperReserveAuthorityContext;preparation:()=>PaperDecisionPreparation;market:PaperMarketData;targets:()=>AllocationPolicy;assets:()=>readonly AssetRef[]}) {
  const {profileId,database:db,clock}=input,authority=createPaperReserveAuthority(input.authorityContext,()=>clock.nowMs(),db,input.prepareAuthority);
  const service=createPaperProfitReserveService(profileId,db,()=>clock.nowMs(),authority,input.model);
  let port:ReturnType<typeof createPaperCapitalBudgetPort>|null=null,busy=false;
  const budgetPort=()=>{
    const binding=paperReserveBinding(profileId,db);if(!binding || binding.archived)throw new Error('paper_capital_book_unavailable');
    port??=createPaperCapitalBudgetPort({profileId,scopeId:binding.scope_id,database:db,now:()=>clock.nowMs(),version:'paper-reserve-cash-v1',marks:input.model.marks,
      guardAuthority:()=>{const b=paperReserveBinding(profileId,db);if(!b || !b.policy_id || b.disabled)return false;try{authority.check(b.policy_id,b.generation);return true;}catch{return false;}}});return port;
  };
  const basis=(id:string,quantity:string):string=>{
    const fills=db.prepare('SELECT f.quantity_text q,f.execution_price_text p,f.venue_fee_text fee,f.filled_at at,o.side FROM paper_fills_v3 f JOIN paper_orders_v3 o ON o.id=f.order_id WHERE f.profile_id=? AND o.canonical_asset_id=? ORDER BY f.filled_at,f.id').all(profileId,id) as {q:string;p:string;fee:string;at:number;side:string}[];
    if(new Set(fills.map(f=>f.at)).size!==fills.length)throw new Error('paper_capital_basis_order_unavailable');
    const lots:{q:ReturnType<typeof a>;cost:ReturnType<typeof a>}[]=[];
    for(const f of fills){if(f.side==='buy'){lots.push({q:a(f.q),cost:a(f.q).mul(f.p).add(f.fee)});continue;}let left=a(f.q);
      while(left.gt(0)&&lots.length){const lot=lots[0]!,take=left.lt(lot.q)?left:lot.q,part=lot.cost.mul(take).div(lot.q);lot.cost=lot.cost.sub(part);lot.q=lot.q.sub(take);left=left.sub(take);if(lot.q.isZero())lots.shift();}if(left.gt(0))throw new Error('paper_capital_basis_missing');}
    const held=lots.reduce((s,l)=>s.add(l.q),a('0'));if(!held.eq(quantity)||!held.gt(0))throw new Error('paper_capital_basis_missing');return lots.reduce((s,l)=>s.add(l.cost),a('0')).div(held).toFixed();
  };
  const holdings=():readonly Holding[]=>{const frame=input.model.requirements().frame;return Object.entries(frame.budget.positions).filter(([,q])=>a(q).gt(0)).map(([id,q])=>{
    const asset=input.assets().find(x=>instrumentKey(x.instrument)===id),mark=frame.assets.find(x=>x.assetId===id)?.markUsd;
    if(!asset || !mark)throw new Error('paper_capital_target_price_missing');return {asset,quantity:decimal(q),priceUsd:decimal(mark),valueUsd:decimal(a(q).mul(mark).toFixed()),avgCostUsd:decimal(basis(id,q)),unrealizedPnlUsd:null,unrealizedPnlPct:null};
  });};
  const execution=(proposalPurposeGuard?: (proposalId:string)=>boolean,capitalPreviewModel=input.previewModel)=>new PaperExecutionService({database:db,profileId,nowMs:()=>clock.nowMs(),market:input.market,capitalBudget:budgetPort(),capitalPreviewModel,executionOwnerId:input.authorityContext().ownerId,
    ...(proposalPurposeGuard?{proposalPurposeGuard}:{}),
    state:()=>{const b=paperReserveBinding(profileId,db);if(!b?.policy_id)throw new Error('paper_reserve_policy_missing');const proof=authority.check(b.policy_id,b.generation);
      return {holdings:holdings(),allocationPolicy:input.targets(),killSwitchEngaged:false,evidenceVerified:true,historicalGrossEdgeLowerBoundPct:proof.grossEdgeLowerBoundPct};}});
  const pendingFor=(runId:string,scheduledForMs:number,decision:ReturnType<typeof paperCapitalDecision>)=>{
    const prep=input.preparation(),atMs=clock.nowMs();if(!prep.ok)throw new Error('paper_capital_strategy_history_missing');
    const decisionId=strategyDecisionId(profileId,scheduledForMs),target=input.targets(),targets=target.targets.map(t=>({assetId:instrumentKey(t.instrument),weight:t.weight})).sort((a,b)=>a.assetId.localeCompare(b.assetId));
    const record=saveStrategyDecision({schemaVersion:1,decisionId,profileId,runId,scheduledForMs,strategy:{id:input.model.strategy().strategyId,version:PAPER_CAPITAL_DECISION_VERSION,configHash:capitalHash({strategy:input.model.strategy(),targets:target})},
      market:{snapshotHash:prep.datasetHash,asOfMs:prep.latestCompletedStartMs,expectedAsOfMs:prep.expectedCompletedStartMs,freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:prep.ruleSnapshotHash,rulesFresh:true},
      portfolio:{snapshotHash:decision.report.inputManifest.budgetId,version:'paper-reserve-cash-v1',source:'paper_ledger'},targets,cashWeight:Math.max(0,1-targets.reduce((s,t)=>s+t.weight,0)),exposure:targets.reduce((s,t)=>s+t.weight,0),historyStatus:'complete',facts:null,createdAtMs:atMs},db);
    appendDecisionEvidenceEvent({schemaVersion:1,decisionId,profileId,sequence:0,kind:'strategy_evaluated',atMs,detail:{decisionHash:record.contentHash}},db);
    return {decisionId,requiredExecutionBarStartMs:firstAttainableDailyOpen(prep.latestCompletedStartMs,atMs),costModelHash:paperCostModelHash()};
  };
  return {service,authority,budgetPort,execution,
    disarm(){authority.disarm();},
    prepare(commandId:string){
      if(!input.preparation().ok)throw new Error('paper_capital_strategy_history_missing');
      if(listSubmittedPaperExecutions(profileId,db).length)throw new Error('paper_capital_pending_settlement');
      capturePaperCapitalEvidence(profileId,clock.nowMs(),input.model.marks(),db);
      const frame=input.model.requirements().frame,decision=paperCapitalDecision({profileId,scheduledForMs:clock.nowMs(),targets:input.targets(),assets:input.assets(),frame});
      const runId=capitalHash({version:PAPER_CAPITAL_DECISION_VERSION,profileId,commandId});
      if(decision.report.state==='unavailable' || decision.report.riskResiduals.length)throw new Error('paper_capital_feasibility_unavailable');
      return execution().prepare({proposalId:capitalHash({runId,revision:1}),runId,revision:1,intents:decision.intents,pending:pendingFor(runId,clock.nowMs(),decision)});
    },
    observe(){
      if(busy || !getPaperCapitalBook(profileId,db))return;busy=true;
      try{const b=paperReserveBinding(profileId,db);if(!b || b.archived || !b.policy_id)return;
        const policy=readPaperReserveFact<import('@coqui/core').PaperReservePolicy>('policy',b.policy_id,db)!;
        const slot=paperReserveCadenceSlot(policy.settings.cadence,clock.nowMs());if(!slot)return;
        const operationKey=`cadence:${policy.id}:${slot}`;
        if(listPaperReserveFacts<{operationKey:string}>('event',b.scope_id,db).some(e=>e.operationKey===operationKey))return;
        capturePaperCapitalEvidence(profileId,clock.nowMs(),input.model.marks(),db);const proposal=service.preview();
        appendPaperReserveEvent(b.scope_id,{operationKey,kind:'proposal_observation_only',atMs:clock.nowMs(),refs:[proposal.id,proposal.inputHash,...proposal.reasonCodes]},db);
      }catch(error){authority.disarm();throw error;}finally{busy=false;}
    },
    runDecision(scheduledForMs:number):PaperRunSummary {
      const runId=capitalHash({version:PAPER_CAPITAL_DECISION_VERSION,profileId,scheduledForMs}),decidedAtMs=clock.nowMs();
      const prior=getWalletDecisionRun(runId,db);if(prior)return JSON.parse(prior.snapshotJson) as PaperRunSummary;
      const finish=(value:PaperRunSummary)=>{const snapshotJson=JSON.stringify(value);saveWalletDecisionRun({id:runId,profileId,scheduledFor:scheduledForMs,strategyVersion:PAPER_CAPITAL_DECISION_VERSION,snapshotHash:capitalHash(value),snapshotJson,status:'completed',createdAt:decidedAtMs,updatedAt:decidedAtMs,error:null},db);return value;};
      const result={profileId,runId,strategyVersion:PAPER_CAPITAL_DECISION_VERSION,scheduledForMs,decidedAtMs,standDown:'gates_refused' as const,filledCount:0,submittedCount:0,refusedCount:0,preDecisionBalances:[]};
      // A new book never enters the legacy origin path. Lack of a current purpose-bound permit stands down.
      const existing=db.prepare('SELECT id,status,created_at FROM paper_execution_proposals_v1 WHERE profile_id=? AND run_id=? ORDER BY created_at LIMIT 1').get(profileId,runId) as {id:string;status:string;created_at:number}|undefined;
      if(existing){const count=db.prepare("SELECT COUNT(*) n FROM paper_orders_v3 WHERE profile_id=? AND run_id=? AND state='filled'").get(profileId,runId) as {n:number};return finish({...result,decidedAtMs:existing.created_at,standDown:existing.status==='pending_review'?'pending_review':existing.status==='succeeded'?null:['executing','unknown'].includes(existing.status)?'execution_unknown':'gates_refused',filledCount:count.n});}
      const b=paperReserveBinding(profileId,db);if(!b?.policy_id || b.disabled || !authority.armed)return finish(result);
      authority.check(b.policy_id,b.generation);const prep=input.preparation();if(!prep.ok)return finish({...result,standDown:prep.code});capturePaperCapitalEvidence(profileId,clock.nowMs(),input.model.marks(),db);const settlement=execution().settlePending();if(settlement.pendingCount>0)return finish({...result,standDown:'pending_settlement'});
      const decision=paperCapitalDecision({profileId,scheduledForMs,targets:input.targets(),assets:input.assets(),frame:input.model.requirements().frame});
      if(decision.report.state==='unavailable')return finish({...result,standDown:'stale_market_data'});
      if(!decision.intents.length)return finish({...result,standDown:decision.report.blocked.length||decision.report.reasonCodes.length||decision.report.riskResiduals.length?'gates_refused':'no_intents'});
      const prepared=execution().prepare({proposalId:capitalHash({runId,version:PAPER_CAPITAL_DECISION_VERSION,revision:1}),runId,revision:1,intents:decision.intents,pending:pendingFor(runId,scheduledForMs,decision)});
      return finish({...result,standDown:prepared.status==='pending'?'pending_review':prepared.status==='submitted'?'pending_settlement':'gates_refused',submittedCount:listSubmittedPaperExecutions(profileId,db).filter(p=>p.decisionId===strategyDecisionId(profileId,scheduledForMs)).length,filledCount:prepared.filledCount,refusedCount:prepared.refusedCount});
    },
  };
}
