import { capitalHash, sha256Hex } from '@coqui/core';
import { openDatabase, assignAuthoritativeHost, acquireExecutionLease, bindActivatedProfitabilityEvidence, saveForwardEdgeObservation, currentBudget, type Db } from '@coqui/storage';
import { createPaperCapitalBook, capturePaperCapitalEvidence, createPaperReserveAuthority, createPaperProfitReserveService, type PaperReserveCommandInput } from '@coqui/services';
import { feasibility } from './feasibility.js';
const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
/** Disposable synthetic records exercise the production reader, never installed qualification or registration. */
export function seedPaperReserveEvidence(db:Db,profileId:string,atMs:number) {
  const strategy={strategyId:'synthetic-p6',codeRevision:'fixture',costProfileHash:capitalHash('synthetic-cost'),horizonMs:86_400_000,normalization:'gross_pct_per_turnover' as const};
  const planHash=capitalHash('synthetic-plan'),sourceHash=capitalHash('synthetic-source');
  const resultJson=JSON.stringify({outcome:'passed',grossEdgeLowerConfidenceBoundPct:10,sourceHashes:[sourceHash],planHash}),resultHash=sha256Hex(resultJson);
  db.prepare('INSERT INTO forward_edge_study_plans_v1 VALUES(?,?,?,?,?)').run(planHash,atMs,'fixture',strategy.costProfileHash,JSON.stringify(strategy));
  db.prepare('INSERT INTO forward_edge_study_results_v1 VALUES(?,?,?,?,?,?,?)').run(resultHash,planHash,atMs,1,1,'10',resultJson);
  db.prepare('INSERT INTO profitability_estimate_evidence_v1 VALUES(?,?,?,?,?,?,?)').run('synthetic-activation',profileId,resultHash,'10',JSON.stringify([sourceHash]),atMs,uuid(900));
  saveForwardEdgeObservation({id:'synthetic-observation',planHash,profileId,dayUtc:Math.floor(atMs/86_400_000)*86_400_000,runId:'synthetic',observedAt:atMs,actualEquityUsd:'500',holdEquityUsd:'500',noTradeEquityUsd:'500',turnoverUsd:'0',recordedCostUsd:'0',marketPricesJson:'{}',valuationComplete:true,stateHash:capitalHash('synthetic-state'),provenanceJson:'{"synthetic":true}',evidenceHash:sourceHash},db);
  bindActivatedProfitabilityEvidence({...strategy,profileId,validFromMs:atMs,validUntilMs:atMs+1000000000},atMs,db);
  return strategy;
}
export function reserveServiceFixture(qualified=true) {
  const db=openDatabase(':memory:');let time=1_000_000,sequence=0;
  const book=createPaperCapitalBook({profileId:'main',bookId:uuid(1),commandId:uuid(2),openingUsd:'500',atMs:time},db);
  const host=assignAuthoritativeHost('main','p6-host','desktop',time,db),lease=acquireExecutionLease('main','p6-host',time,1000000000,db)!;
  const strategy=qualified?seedPaperReserveEvidence(db,'main',time):{strategyId:'synthetic-p6',codeRevision:'fixture',costProfileHash:capitalHash('synthetic-cost'),horizonMs:86_400_000,normalization:'gross_pct_per_turnover' as const};
  const authorityContext=()=>({profileId:'main',ownerId:'p6-host',hostGeneration:host.fencingGeneration,fencingToken:lease.fencingToken,strategy,strategyPaused:()=>false,operationAllowed:()=>true});
  const authority=createPaperReserveAuthority(authorityContext,()=>time,db);
  const getBudget=()=>currentBudget(db.prepare('SELECT scope_id FROM paper_reserve_runtime_bindings_v1').get()!['scope_id'] as string,time,db)!;
  const model={strategy:()=>strategy,marks:()=>({}),requirements:()=>({strategyHash:capitalHash(strategy),objective:'cash_only' as const,frame:{...feasibility('500'),assets:[],intents:[],nowMs:time,budget:getBudget(),expectedRevision:getBudget().revision}})};
  const service=createPaperProfitReserveService('main',db,()=>time,authority,model);
  const request=():PaperReserveCommandInput=>{const v=service.view();return{commandId:uuid(++sequence+100),bookId:book.id,scopeId:v.binding.scope_id,generation:v.binding.generation,policyId:v.binding.policy_id,stateId:v.binding.state_id,budgetRevision:v.budget!.revision,authorityHash:v.authorityHash};};
  const roundTrip=(profit=50)=>{
    // Independently specified complete buy and sell legs, including zero execution fees.
    for(const [n,side,price,at] of [[1,'buy',10,time+1],[2,'sell',10+profit/10,time+2]] as const) {
      const order=`order-${n}`,fill=`fill-${n}`,sign=side==='buy'?1:-1,notional=10*price;
      db.prepare(`INSERT INTO paper_orders_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order,'main',`trade-${n}`,'BTC-USD','coinbase|spot|BTC-USD',side,'10',String(notional),'filled','synthetic-rules','synthetic-decision',null,at,at);
      db.prepare(`INSERT INTO paper_fills_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(fill,order,'main','10',String(price),String(notional),'0','0','0','0',at,'synthetic-mark');
      for(const [account,asset,quantity,amount] of [['cash',null,'0',String(-sign*notional)],['asset','coinbase|spot|BTC-USD',String(sign*10),String(sign*notional)],['venue_fee',null,'0','0']] as const)
        db.prepare('INSERT INTO paper_ledger_entries_v3 VALUES(?,?,?,?,?,?,?,?,?,?)').run(`${fill}:${account}`,'main',`trade-${n}`,order,fill,account,asset,amount,quantity,at);
    }
    db.prepare('UPDATE paper_balances_v3 SET quantity_text=?,updated_at=? WHERE profile_id=? AND asset_id=?').run(String(500+profit),time+2,'main','USD');
    db.prepare('INSERT INTO paper_balances_v3 VALUES(?,?,?,?)').run('main','coinbase|spot|BTC-USD','0',time+2);
    time+=3;capturePaperCapitalEvidence('main',time,{},db);
  };
  return {db,service,authority,authorityContext,model,request,roundTrip,now:()=>time,advance:(ms:number)=>{time+=ms;},uuid,getBudget,strategy};
}
