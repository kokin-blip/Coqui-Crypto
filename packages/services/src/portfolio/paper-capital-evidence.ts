import { budgetAmount as a, budgetText as t, budgetEvidence, capitalHash, identifiedBudgetFact, inapplicableNativeRule,
  calculateCapitalPerformance, budgetClaimHeads, projectReserveInvestment, reserveValue as v, type CapitalValuation, type CapitalLeg, type ReserveFinancialInput, type ReserveInvestmentFill,
  type AccountBudgetEvidenceV1 } from '@coqui/core';
import { assertEmptyPaperCapitalProfile, bootstrapPaperBalances, getPaperCapitalBook, insertPaperCapitalBook, paperCapitalScopeIdentity,
  paperReserveBinding, listPaperBalances, listSubmittedPaperExecutions, listCashClaims, budgetCheckpoint, getBudgetSource, saveBudgetSource, advanceLocalBudgetSource,
  currentBudget, listCapitalEpochs, listCapitalSourceBatches, listCapitalEvents, listCapitalValuations, listPaperReserveFacts, type PaperCapitalBook, type PaperReserveAssessment, type Db,
  inTransaction, readPaperReserveFact, type PaperReserveBinding } from '@coqui/storage';
import { ingestCapitalEvidence } from './capital-accounting.js';
import { capitalSourceScope, capitalSourceBatch, capitalSourceEvent } from './capital-sources.js';
import { recordBudgetDeficit } from './capital-budget-sources.js';
interface Ledger { id:string; run_id:string; order_id:string|null; fill_id:string|null; account:string; asset_id:string|null; quantity_text:string; amount_usd_text:string; at:number }
interface Fill { id:string; order_id:string; filled_at:number; venue_fee_text:string; quantity_text:string; execution_price_text:string; notional_text:string; side:'buy'|'sell'; canonical_asset_id:string }
export function createPaperCapitalBook(input: { profileId:string; bookId:string; commandId:string; openingUsd:string; atMs:number }, db:Db): PaperCapitalBook {
  return inTransaction(db,()=>{
    const fundingRequestHash=capitalHash({profileId:input.profileId,bookId:input.bookId,commandId:input.commandId,openingUsd:input.openingUsd});
    const prior=getPaperCapitalBook(input.profileId,db);
    if(prior?.fundingOperationId===input.commandId) {
      if(prior.fundingRequestHash!==fundingRequestHash || prior.bookId!==input.bookId || prior.openingUsd!==t(a(input.openingUsd))) throw new Error('paper_book_command_conflict');return prior;
    }
    assertEmptyPaperCapitalProfile(input.profileId,db);
    const book=identifiedBudgetFact({version:'paper-reserve-cash-v1' as const,bookId:input.bookId,originProfileId:input.profileId,environment:'simulation' as const,currency:'USD' as const,
      source:'explicit_simulated_funding' as const,openingUsd:t(a(input.openingUsd)),atMs:input.atMs,fundingOperationId:input.commandId,fundingRequestHash});
    const scope=capitalSourceScope(input.profileId,'local_paper','simulation',paperCapitalScopeIdentity(book),book.atMs);
    const batch=capitalSourceBatch({scopeId:scope.id,source:'paper-reserve-cash-origin-v1',requestedAtMs:book.atMs,observedAtMs:book.atMs,recordedAtMs:book.atMs,
      coverage:{fromMs:book.atMs,toMs:book.atMs,complete:true,paginationComplete:true,membershipComplete:true,reasonCodes:[]},memberIdentityHashes:[scope.accountIdentityHash],evidenceRefs:[book.id],payload:{book}});
    const opening:CapitalValuation={id:capitalHash({scopeId:scope.id,bookId:book.id,opening:true}),scopeId:scope.id,sourceBatchId:batch.id,replacesId:null,atMs:book.atMs,sequence:0,observedAtMs:book.atMs,
      equityUsd:book.openingUsd,cashUsd:book.openingUsd,legs:[{asset:'USD',quantity:book.openingUsd,valueUsd:book.openingUsd,role:'cash',valuationRef:book.id}],verified:true,missingComponents:[],evidenceRefs:[book.id]};
    bootstrapPaperBalances(input.profileId,[{assetId:'USD',quantity:book.openingUsd}],`paper-capital-origin:${book.id}`,book.atMs,db);
    ingestCapitalEvidence({profileId:input.profileId,connectionId:null,scope,batch,events:[],valuations:[opening],opening:{valuationId:opening.id,historicalLimitations:[],reason:'verified_origin'}},db);
    insertPaperCapitalBook(book,scope.id,db);
    capturePaperCapitalEvidence(input.profileId,book.atMs,{},db);
    return book;
  });
}
export function activePaperCapitalBinding(profileId:string,db:Db):{book:PaperCapitalBook;binding:PaperReserveBinding} {
  const book=getPaperCapitalBook(profileId,db),binding=paperReserveBinding(profileId,db);
  if(!book || !binding || binding.archived || book.id!==binding.book_id || book.originProfileId!==profileId)throw new Error('paper_capital_book_unavailable');
  return {book,binding};
}
/** Local ledger-only capture. Caller supplies completed actual marks, never synthetic historical prices. */
function paperCapitalEvidence(profileId:string,recordedAtMs:number,marks:Readonly<Record<string,{priceUsd:string;atMs:number;ref:string}>>,db:Db,persist:boolean): {source:AccountBudgetEvidenceV1;financial:ReserveFinancialInput} {
  return inTransaction(db,()=>{
    const {book,binding}=activePaperCapitalBinding(profileId,db),scope=capitalSourceScope(profileId,'local_paper','simulation',paperCapitalScopeIdentity(book),book.atMs);
    const ledger=db.prepare('SELECT id,run_id,order_id,fill_id,account,asset_id,quantity_text,amount_usd_text,at FROM paper_ledger_entries_v3 WHERE profile_id=? ORDER BY at,id LIMIT 100001').all(profileId) as unknown as Ledger[];
    const fills=db.prepare(`SELECT f.*,o.side,o.canonical_asset_id FROM paper_fills_v3 f JOIN paper_orders_v3 o ON o.id=f.order_id WHERE f.profile_id=? ORDER BY f.filled_at,f.id LIMIT 100001`).all(profileId) as unknown as Fill[];
    if(ledger.length>100_000 || fills.length>100_000)throw new Error('paper_capital_capacity');
    if(recordedAtMs<book.atMs)throw new Error('paper_capital_clock_before_origin');
    const fillById=new Map(fills.map(f=>[f.id,f])),grouped=new Map<string,Ledger[]>();
    for(const row of ledger)if(row.fill_id){const group=grouped.get(row.fill_id)??[];group.push(row);grouped.set(row.fill_id,group);}
    const balances=listPaperBalances(profileId,db), positive=balances.filter(r=>r.assetId!=='USD' && a(r.quantity).gt(0));
    const times=positive.map(r=>marks[r.assetId]?.atMs);
    const nowMs=times.length>0 && times.every(t=>t!==undefined && t===times[0] && t>=book.atMs && t<=recordedAtMs)?times[0]!:recordedAtMs;
    const totals=new Map<string,ReturnType<typeof a>>(), reasons:string[]=[];
    const opening=ledger.filter(r=>r.account==='opening');
    if(opening.length!==1 || opening[0]!.asset_id!=='USD' || opening[0]!.run_id!==`paper-capital-origin:${book.id}` || opening[0]!.at!==book.atMs || !a(opening[0]!.quantity_text).eq(book.openingUsd))reasons.push('paper_origin_unreconciled');
    for(const row of ledger) {
      const id=row.account==='cash'?'USD':['opening','asset'].includes(row.account)?row.asset_id:null;
      if(id)totals.set(id,(totals.get(id)??a('0')).add(row.account==='cash'?row.amount_usd_text:row.quantity_text));
      if(row.at>nowMs || row.at<book.atMs || row.account!=='opening' && (row.fill_id===null || row.order_id===null || !['cash','asset','venue_fee'].includes(row.account) || !(fillById.get(row.fill_id)?.order_id===row.order_id && fillById.get(row.fill_id)?.filled_at===row.at)))reasons.push('paper_ledger_unreconciled');
    }
    for(const f of fills) {
      const legs=grouped.get(f.id)??[],cash=legs.filter(r=>r.account==='cash'),asset=legs.filter(r=>r.account==='asset'),fee=legs.filter(r=>r.account==='venue_fee');
      const key=f.canonical_asset_id;
      const notional=a(f.quantity_text).mul(f.execution_price_text),signed=f.side==='buy'?a('1'):a('-1');
      if(!notional.eq(f.notional_text) || cash.length!==1 || asset.length!==1 || fee.length!==1 || asset[0]!.asset_id!==key || !a(asset[0]!.quantity_text).eq(a(f.quantity_text).mul(signed)) ||
        !a(cash[0]!.amount_usd_text).eq(notional.mul(signed).neg().sub(f.venue_fee_text)) || !a(fee[0]!.amount_usd_text).eq(f.venue_fee_text) || !legs.reduce((s,r)=>s.add(r.amount_usd_text),a('0')).isZero())reasons.push('paper_fill_legs_unreconciled');
    }
    for(const id of new Set([...totals.keys(),...balances.map(r=>r.assetId)]))if(!(totals.get(id)??a('0')).eq(balances.find(r=>r.assetId===id)?.quantity??'0'))reasons.push('paper_balances_unreconciled');
    const positions=Object.fromEntries(balances.filter(r=>r.assetId!=='USD').map(r=>[r.assetId,r.quantity])),cash=balances.find(r=>r.assetId==='USD')?.quantity??'0';
    const usable:Record<string,string>={},legs:CapitalLeg[]=[{asset:'USD',quantity:cash,valueUsd:cash,role:'cash',valuationRef:book.id}];let equity=a(cash);
    for(const [id,q] of Object.entries(positions))if(a(q).gt(0)) {
      const m=marks[id],valid=m && m.atMs===nowMs && a(m.priceUsd).gt(0);if(!valid)reasons.push('paper_current_marks_unavailable');
      const value=valid?t(a(q).mul(m.priceUsd)):null;if(valid){usable[id]=m.priceUsd;equity=equity.add(value!);}
      legs.push({asset:id,quantity:q,valueUsd:value,role:'asset',valuationRef:valid?m.ref:null});
    }
    const pendingHeads=budgetClaimHeads(listCashClaims(scope.id,db)).heads;
    if(listSubmittedPaperExecutions(profileId,db).some(row=>!pendingHeads.some(c=>c.originKey===`paper-order:${row.orderId}` && ['committed','unknown'].includes(c.state))))reasons.push('paper_uncovered_pending_order');
    const codes=[...new Set(reasons)].sort(),complete=!codes.length;
    const batch=capitalSourceBatch({scopeId:scope.id,source:'paper-reserve-cash-ledger-v1',requestedAtMs:recordedAtMs,observedAtMs:nowMs,recordedAtMs,
      coverage:{fromMs:book.atMs,toMs:nowMs,complete,paginationComplete:true,membershipComplete:true,reasonCodes:codes},memberIdentityHashes:[scope.accountIdentityHash],
      evidenceRefs:[book.id,capitalHash(ledger),capitalHash(fills)],payload:{ledgerHash:capitalHash(ledger),fillHash:capitalHash(fills),marksHash:capitalHash(marks),marks}});
    const previous=listCapitalValuations(scope.id,db).filter(r=>r.atMs===nowMs).at(-1);
    const openingId=capitalHash({scopeId:scope.id,bookId:book.id,opening:true});
    const valuation:CapitalValuation={id:capitalHash({scopeId:scope.id,batchId:batch.id,legs}),scopeId:scope.id,sourceBatchId:batch.id,replacesId:previous?.id===openingId?null:previous?.id??null,
      atMs:nowMs,sequence:previous?.id===openingId?1:previous?.sequence??0,observedAtMs:nowMs,equityUsd:complete?t(equity):null,cashUsd:cash,legs,verified:complete,missingComponents:codes,evidenceRefs:batch.evidenceRefs};
    const existing=previous && capitalHash(previous.legs.map(leg=>({asset:leg.asset,role:leg.role,quantity:leg.quantity,valueUsd:leg.valueUsd})))===capitalHash(legs.map(leg=>({asset:leg.asset,role:leg.role,quantity:leg.quantity,valueUsd:leg.valueUsd}))) && previous.verified===complete;
    const events=fills.map(f=>capitalSourceEvent(batch,{logicalKey:`paper-capital-fill:${f.id}`,kind:'trade',status:'confirmed',legs:[],externalFlowUsd:'0',flowVerified:!codes.some(c=>c!=='paper_current_marks_unavailable'),
      effectiveTime:{precision:'instant',fromMs:f.filled_at,toMs:f.filled_at},feeUsd:f.venue_fee_text,incomeUsd:'0',reasonCodes:codes.filter(c=>c!=='paper_current_marks_unavailable'),evidenceRefs:[f.id]}));
    const report=persist ? ingestCapitalEvidence({profileId,connectionId:null,scope,batch,events,valuations:existing?[]:[valuation],opening:null},db) : calculateCapitalPerformance({scope,epoch:listCapitalEpochs(scope.id,db)[0]??null,batches:listCapitalSourceBatches(scope.id,db),events:listCapitalEvents(scope.id,db),valuations:listCapitalValuations(scope.id,db)});
    const source=budgetEvidence({scopeId:scope.id,bookId:scope.accountIdentityHash,provider:'local_paper',environment:'simulation',observedAtMs:nowMs,expiresAtMs:nowMs+30_000,
      cashUsd:cash,equityUsd:complete?t(equity):null,venueEligibleUsd:inapplicableNativeRule('internal_paper_cash_book'),positions,marks:usable,quotes:{},ruleIds:[],fees:null,
      complete,holdMatchingComplete:true,authority:'isolated_book',assurance:'observed',reasonCodes:codes,evidenceRefs:[book.id,capitalHash(ledger),...(existing?[previous.id]:[valuation.id])]});
    const checkpoint=budgetCheckpoint(scope.id,db),prior=checkpoint?getBudgetSource(checkpoint.source_id,db):null;
    if(persist) { if(prior && prior.id!==source.id)advanceLocalBudgetSource(source,prior.id,db);else if(!prior)saveBudgetSource(source,db); }
    const budget=currentBudget(scope.id,nowMs,db)!;if(persist)recordBudgetDeficit(budget,db,profileId);
    const ledgerCodes=codes.filter(c=>!['paper_current_marks_unavailable','paper_uncovered_pending_order'].includes(c)),ledgerComplete=ledgerCodes.length===0;
    const invFills:ReserveInvestmentFill[]=fills.map(f=>({id:f.id,assetId:f.canonical_asset_id,side:f.side,quantity:f.quantity_text,priceUsd:f.execution_price_text,feeUsd:f.venue_fee_text,atMs:f.filled_at,sequence:null}));
    const investment=projectReserveInvestment({scopeId:scope.id,assurance:'observed',fromMs:book.atMs,toMs:nowMs,opening:[],fills:invFills.filter(f=>f.atMs<=nowMs),finalQuantities:positions,marks:usable,incomeUsd:v('0'),expensesUsd:v('0'),coverageComplete:ledgerComplete,feesComplete:ledgerComplete,reasonCodes:ledgerCodes,evidenceRefs:batch.evidenceRefs});
    const state=binding.state_id?readPaperReserveFact<import('@coqui/core').PaperReserveState>('state',binding.state_id,db):null;
    const assessments=listPaperReserveFacts<PaperReserveAssessment>('assessment',scope.id,db),claimIds=new Set(assessments.flatMap(r=>r.claimIds));
    const claims=listCashClaims(scope.id,db),funded=claims.filter(r=>['profit_reserve','tax_hold'].includes(r.purpose));
    const owned=funded.every(r=>claimIds.has(r.id)||r.replacesId!==null && claimIds.has(r.replacesId) && r.state==='released');
    const unavailable=importUnavailable;
    const priorBacked=owned?v(t(a(state?.allocatedUsd??'0').add(state?.profitBackedTaxUsd??'0'))):unavailable('paper_reserve_claim_lineage_unverified');
    const claimTotal=(purpose:string)=>t(budgetClaimHeads(claims).heads.filter(r=>r.purpose===purpose && !['released','settled'].includes(r.state)).reduce((s,r)=>s.add(r.assetId==='USD'?r.amount:a(r.amount).mul(usable[r.assetId]??'0')),a('0')));
    const pendingMarkMissing=budgetClaimHeads(claims).heads.some(r=>r.purpose==='order' && !['released','settled'].includes(r.state) && r.assetId!=='USD' && usable[r.assetId]===undefined);
    const metric=(x:string|null)=>x===null?unavailable(...budget.reasonCodes,'paper_budget_unavailable'):v(x);
    return {source,financial:{scopeId:scope.id,epochId:report.epochId,fromMs:book.atMs,toMs:nowMs,assurance:'observed',observedAtMs:nowMs,expiresAtMs:source.expiresAtMs,
      openingEquityUsd:v(book.openingUsd),economicPnlUsd:report.metrics.economicPnlUsd,realizedPnlUsd:investment.realizedPnlUsd,unrealizedPnlUsd:investment.unrealizedPnlUsd,
      sourceCutHash:capitalHash({sourceId:source.id,reportId:report.inputHash,claims:claims.map(r=>r.id)}),trackingLimitations:[],observedCashUsd:v(cash),riskAssetValueUsd:complete?v(t(equity.sub(cash))):unavailable('paper_current_marks_unavailable'),
      equityUsd:metric(budget.equityUsd),activeEquityUsd:metric(budget.activeEquityUsd),spendableUsd:metric(budget.spendableUsd),
      contributionsUsd:report.metrics.contributionsUsd,netOutflowsUsd:report.metrics.netOutflowsUsd,confirmedReceiptsUsd:report.metrics.confirmedUserReceiptsUsd,
      incomeUsd:ledgerComplete?v('0'):unavailable(...ledgerCodes,'paper_income_attribution_unavailable'),feesUsd:ledgerComplete?v(t(fills.filter(f=>f.filled_at<=nowMs).reduce((s,f)=>s.add(f.venue_fee_text),a('0')))):unavailable(...ledgerCodes,'paper_fee_attribution_unavailable'),completedWins:investment.completedWins,
      actualReservedUsd:v(claimTotal('profit_reserve')),actualTaxHoldUsd:v(claimTotal('tax_hold')),actualPendingUsd:pendingMarkMissing?unavailable('paper_pending_claim_mark_missing'):v(claimTotal('order')),priorProfitBackedUsd:priorBacked,
      reasonCodes:[...codes,...(!persist && (!prior || prior.id!==source.id)?['paper_reserve_source_stale']:[]),...(!owned?['paper_reserve_claim_lineage_unverified']:[]),...budget.reasonCodes],evidenceRefs:[...batch.evidenceRefs,report.inputHash,source.id],budgetRevision:budget.revision,generation:budgetCheckpoint(scope.id,db)!.generation}};
  });
}
import { reserveUnavailable as importUnavailable } from '@coqui/core';

export function capturePaperCapitalEvidence(profileId:string,nowMs:number,marks:Readonly<Record<string,{priceUsd:string;atMs:number;ref:string}>>,db:Db) {
  return paperCapitalEvidence(profileId,nowMs,marks,db,true);
}
/** Pure local read: preserve the last acquired cut rather than inventing a current quote. */
export function readPaperCapitalEvidence(profileId:string,nowMs:number,db:Db) {
  const {binding}=activePaperCapitalBinding(profileId,db),checkpoint=budgetCheckpoint(binding.scope_id,db),source=checkpoint?getBudgetSource(checkpoint.source_id,db):null;
  if(!source)throw new Error('paper_capital_source_missing');
  const marks=Object.fromEntries(Object.entries(source.marks).map(([id,priceUsd])=>[id,{priceUsd,atMs:source.observedAtMs,ref:source.id}]));
  const result=paperCapitalEvidence(profileId,source.observedAtMs,marks,db,false);
  const budget=currentBudget(binding.scope_id,nowMs,db)!;
  return {...result,source,financial:{...result.financial,observedCashUsd:source.cashUsd===null?importUnavailable('paper_cash_unavailable'):v(source.cashUsd,[source.id]),spendableUsd:budget.spendableUsd===null||result.financial.reasonCodes.length?importUnavailable(...result.financial.reasonCodes,...budget.reasonCodes):v(budget.spendableUsd,[budget.sourceId,budget.revision]),reasonCodes:[...new Set([...result.financial.reasonCodes,...budget.reasonCodes])],budgetRevision:budget.revision}};
}
