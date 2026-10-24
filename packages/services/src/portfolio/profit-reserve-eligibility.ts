import { budgetAmount as amount, budgetText as text, BudgetDecimal as D, capitalHash, budgetClaimHeads, capitalEventHeads,
  instrumentKey, projectReserveInvestment, reserveUnavailable as unavailable, reserveValue as value, unavailableReserveCapital,
  type ReserveFinancialInput, type ReserveInvestmentFill, type ReserveEligibilityReport } from '@coqui/core';
import { assertReserveAccess, budgetCheckpoint, getBudgetSource, getCapitalScope, getPaperBookOrigin, getSetting,
  listCapitalEpochs, listCapitalEvents, listCapitalSourceBatches, listCapitalValuations, listCashClaims, listPaperBalances, inTransaction, type Db } from '@coqui/storage';
import { capitalPerformanceView, capitalScopesView } from './capital-performance.js';
import { accessibleCapitalBudget } from './capital-budget.js';

function bounded<T>(rows:readonly T[]):readonly T[]{if(rows.length>100_000)throw new Error('reserve_evidence_capacity');return rows;}
function localCut(profileId:string,db:Db){
  return { ledger:bounded(db.prepare('SELECT * FROM paper_ledger_entries_v3 WHERE profile_id=? ORDER BY id LIMIT 100001').all(profileId)),
    fills:bounded(db.prepare('SELECT * FROM paper_fills_v3 WHERE profile_id=? ORDER BY id LIMIT 100001').all(profileId)),
    pending:bounded(db.prepare('SELECT * FROM paper_pending_executions_v1 WHERE profile_id=? ORDER BY id LIMIT 100001').all(profileId)) };
}
/** Content identity of persisted financial facts only; policy/preview writes do not change it. */
export function reserveSourceCutHash(scopeId:string,db:Db):string{
  const scope=getCapitalScope(scopeId,db);if(!scope)throw new Error('reserve_scope_unavailable');
  const checkpoint=budgetCheckpoint(scopeId,db);
  return capitalHash({scopeId,events:listCapitalEvents(scopeId,db).map(e=>e.id).sort(),batches:listCapitalSourceBatches(scopeId,db).map(b=>b.id).sort(),
    valuations:listCapitalValuations(scopeId,db).map(v=>v.id).sort(),epochs:listCapitalEpochs(scopeId,db).map(e=>e.id).sort(),checkpoint,
    claims:listCashClaims(scopeId,db).map(c=>c.id).sort(),captureFailure:getSetting(`capital.budget_failure.${scopeId}`,db),ingestionFailure:getSetting(`capital.ingestion_failure.${scope.provider}`,db),
    local:scope.provider==='local_paper'?localCut(scope.originProfileId,db):null});
}
export function assembleReserveFinancial(profileId:string,scopeId:string,nowMs:number,db:Db){
  return inTransaction(db,()=>{
    assertReserveAccess(profileId,scopeId,db);const scope=getCapitalScope(scopeId,db)!;
    const descriptor=capitalScopesView(profileId,db).scopes.find(r=>r.scope.id===scopeId)!;
    const epochs=listCapitalEpochs(scopeId,db),performance=capitalPerformanceView(profileId,{scopeId,epochId:null,fromMs:null,toMs:null},db);
    const view=accessibleCapitalBudget(profileId,scopeId,nowMs,db),budget=view.budget,source=budget?getBudgetSource(budget.sourceId,db):null;
    const metric=performance.metrics,refs=[performance.inputHash,...performance.inputManifest.batchIds,...performance.inputManifest.eventIds,...performance.inputManifest.valuationIds,...(source?[source.id]:[])];
    if(refs.length>10_000)throw new Error('reserve_evidence_capacity');
    const reasons:string[]=[];
    if(descriptor.mode!=='active')reasons.push(`reserve_scope_${descriptor.mode}`);
    if(!descriptor.coverage?.complete)reasons.push('capital_coverage_incomplete');
    if(epochs.length!==1||epochs[0]?.predecessorId!==null)reasons.push('economic_lineage_continuity_unavailable');
    if(!budget||!source)reasons.push('budget_source_not_recorded');
    if(source&&metric.equityUsd.state==='available'&&(!source.equityUsd||!amount(source.equityUsd).eq(metric.equityUsd.value)||source.observedAtMs!==performance.toMs))reasons.push('financial_common_cut_unverified');
    const allEvents=capitalEventHeads(listCapitalEvents(scopeId,db));
    if(allEvents.conflicts.length)reasons.push('conflicting_revision');
    const terminal=listCapitalValuations(scopeId,db).find(v=>v.atMs===performance.toMs&&v.verified);
    if(source&&(!terminal||terminal.cashUsd===null||source.cashUsd===null||!amount(terminal.cashUsd).eq(source.cashUsd)))reasons.push('financial_cash_cut_unreconciled');
    const currentClaims=budgetClaimHeads(listCashClaims(scopeId,db)).heads;
    const activeClaims=currentClaims.filter(c=>c.state==='committed'||c.state==='unknown');
    if(activeClaims.some(c=>c.state==='unknown'&&(c.purpose==='profit_reserve'||c.purpose==='tax_hold'))||allEvents.events.some(e=>e.kind==='outflow'&&(e.status==='pending'||e.status==='conflict')))reasons.push('funded_operation_unresolved');
    const sum=(purpose:'profit_reserve'|'tax_hold')=>activeClaims.filter(c=>c.purpose===purpose&&c.assetId==='USD').reduce((s,c)=>s.add(c.amount),new D(0));
    const nonTradeCosts=allEvents.events.filter(e=>['fee','outflow','contribution'].includes(e.kind)),costsKnown=nonTradeCosts.every(e=>e.status==='confirmed'&&e.feeUsd!==null);
    const origin=scope.provider==='local_paper'?getPaperBookOrigin(scope.originProfileId,db):null;
    let eligibility:ReserveEligibilityReport|null=null;
    if(origin&&scope.originProfileId===profileId&&performance.fromMs!==null&&performance.toMs!==null){
      const rows=bounded(db.prepare(`SELECT f.id,o.product_id,o.side,f.quantity_text,f.execution_price_text,f.venue_fee_text,f.filled_at FROM paper_fills_v3 f
        JOIN paper_orders_v3 o ON o.id=f.order_id WHERE f.profile_id=? ORDER BY f.filled_at LIMIT 100001`).all(profileId)) as readonly {id:string;product_id:string;side:'buy'|'sell';quantity_text:string;execution_price_text:string;venue_fee_text:string;filled_at:number}[];
      const current=listPaperBalances(profileId,db);
      if(rows.some(r=>r.filled_at>performance.toMs!))reasons.push('financial_cut_not_current');
      if(source&&current.some(r=>!amount(r.quantity).eq(r.assetId==='USD'?source.cashUsd??'0':source.positions[r.assetId]??'0')))reasons.push('current_positions_differ_from_cut');
      const fills:ReserveInvestmentFill[]=rows.filter(r=>r.filled_at>=performance.fromMs!&&r.filled_at<=performance.toMs!).map(r=>({id:r.id,assetId:instrumentKey({venue:'coinbase',productType:'spot',productId:r.product_id}),
        side:r.side,quantity:r.quantity_text,priceUsd:r.execution_price_text,feeUsd:r.venue_fee_text,atMs:r.filled_at,sequence:null}));
      eligibility=projectReserveInvestment({scopeId,assurance:'observed',fromMs:performance.fromMs,toMs:performance.toMs,opening:origin.snapshot.balances.map(r=>({assetId:r.assetId,quantity:r.quantity,costUsd:null})),fills,
        finalQuantities:Object.fromEntries(current.filter(r=>r.assetId!=='USD').map(r=>[r.assetId,r.quantity])),marks:source?.marks??{},incomeUsd:metric.incomeUsd,
        expensesUsd:costsKnown?value(text(nonTradeCosts.reduce((s,e)=>s.add(e.feeUsd!),new D(0))),refs):unavailable('fee_attribution_incomplete'),
        coverageComplete:metric.economicPnlUsd.state==='available',feesComplete:metric.feesUsd.state==='available',reasonCodes:[],evidenceRefs:refs});
      if(eligibility.realizedPnlUsd.state==='available'&&eligibility.unrealizedPnlUsd.state==='available'&&metric.economicPnlUsd.state==='available'&&
        !amount(eligibility.realizedPnlUsd.value).add(eligibility.unrealizedPnlUsd.value).eq(metric.economicPnlUsd.value))reasons.push('investment_profit_decomposition_unreconciled');
    }
    const opening=epochs[0]?listCapitalValuations(scopeId,db).find(v=>v.id===epochs[0]!.openingValuationId):null;
    const backedClaims=currentClaims.some(c=>c.purpose==='profit_reserve'||c.purpose==='tax_hold');
    const f:ReserveFinancialInput={scopeId,epochId:performance.epochId,fromMs:performance.fromMs,toMs:performance.toMs,assurance:'observed',
      observedAtMs:source?.observedAtMs??null,expiresAtMs:Math.min(source?.expiresAtMs??nowMs,terminal?terminal.atMs+30_000:nowMs),
      sourceCutHash:reserveSourceCutHash(scopeId,db),openingEquityUsd:opening?.verified&&opening.equityUsd!==null?value(opening.equityUsd,[opening.id]):unavailable('opening_missing'),trackingLimitations:performance.historicalLimitations,
      economicPnlUsd:metric.economicPnlUsd,realizedPnlUsd:eligibility?.realizedPnlUsd??unavailable('scoped_basis_or_fee_history_unavailable'),unrealizedPnlUsd:eligibility?.unrealizedPnlUsd??unavailable('scoped_basis_or_fee_history_unavailable'),
      observedCashUsd:source?.cashUsd!==null&&source?.cashUsd!==undefined?value(source.cashUsd,[source.id]):unavailable('cash_unavailable'),
      riskAssetValueUsd:source&&Object.entries(source.positions).every(([id,q])=>amount(q).isZero()||source.marks[id]!==undefined)?value(text(Object.entries(source.positions).reduce((s,[id,q])=>s.add(amount(q).mul(source.marks[id]??'0')),new D(0))),refs):unavailable('portfolio_marks_incomplete'),
      equityUsd:metric.equityUsd,activeEquityUsd:budget?.activeEquityUsd!==null&&budget?.activeEquityUsd!==undefined?value(budget.activeEquityUsd,refs):unavailable('active_equity_unavailable'),
      spendableUsd:budget?.state==='available'?value(budget.spendableUsd!,[budget.id]):unavailable(...(budget?.reasonCodes??['budget_source_not_recorded'])),
      contributionsUsd:metric.contributionsUsd,netOutflowsUsd:metric.netOutflowsUsd,confirmedReceiptsUsd:metric.confirmedUserReceiptsUsd,incomeUsd:metric.incomeUsd,feesUsd:metric.feesUsd,
      completedWins:eligibility?.completedWins??unavailable('episode_accounting_incomplete'),actualReservedUsd:value(text(sum('profit_reserve')),refs),actualTaxHoldUsd:value(text(sum('tax_hold')),refs),
      actualPendingUsd:!descriptor.coverage?.complete?unavailable('capital_coverage_incomplete'):allEvents.events.some(e=>e.legs.some(l=>l.role==='receivable'))?unavailable('payment_purpose_or_receipt_unverified'):value('0',refs),
      priorProfitBackedUsd:backedClaims?unavailable('actual_profit_backing_unverified'):value('0',refs),reasonCodes:[...new Set(reasons)].sort(),evidenceRefs:refs,budgetRevision:budget?.revision??null,generation:budgetCheckpoint(scopeId,db)?.generation??null};
    return {financial:f,eligibility,floor:unavailableReserveCapital(scopeId,f.budgetRevision,f.expiresAtMs,'strategy_requirement_binding_missing')};
  });
}
