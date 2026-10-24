import { budgetAmount as amount, budgetText as text, BudgetDecimal as D, capitalHash, identifiedBudgetFact, projectReserveInvestment,
  evaluateProfitReserve, reserveBaseline, reserveCapitalWitness, reservePolicy, reserveValue as value, type ReserveFinancialInput, type ReserveInvestmentFill } from '@coqui/core';
import type { ChannelRequest } from '@coqui/contracts';
import { smallCapitalScenario } from './capital-feasibility.js';
import { reserveConsequences } from './profit-reserve-consequences.js';

export function reserveScenario(request:Extract<ChannelRequest<'capital.reserve.preview'>,{mode:'scenario'}>,nowMs:number){
  const scopeId=capitalHash({kind:'independent-preview-book',...request}),opening=amount(request.openingUsd),p=amount(request.profitUsd),L=amount(request.realizedProfitUsd),equity=opening.add(p),cash=amount(request.cashUsd);
  const held=equity.sub(cash),basis=opening.add(L).sub(cash),closedBasis=opening;
  if(equity.lt(0)||cash.gt(equity)||basis.lt(0)||closedBasis.add(L).lte(0)||held.isZero()&&!basis.isZero()||held.gt(0)&&basis.lte(0))throw new Error('reserve_scenario_inconsistent');
  const frame0=smallCapitalScenario(scopeId,text(equity),'25','0.01','0.01',nowMs),asset0=frame0.assets[0]!,assetId=asset0.assetId;
  const mark=held.gt(0)?held:new D(1),asset={...asset0,markUsd:text(mark),quote:{...asset0.quote,bid:text(mark.mul('0.999')),ask:text(mark.mul('1.001'))}};
  const budget=identifiedBudgetFact({...frame0.budget,revision:capitalHash({scopeId,equity:text(equity),cash:request.cashUsd}),observedCashUsd:request.cashUsd,
    spendableUsd:request.cashUsd,equityUsd:text(equity),activeEquityUsd:text(equity),positions:held.gt(0)?{[assetId]:'1'}:{},quantities:held.gt(0)?{[assetId]:'1'}:{}});
  const frame={...frame0,budget,expectedRevision:budget.revision,assets:[asset],intents:held.isZero()?[]:[{assetId,deltaQuantity:'0.01',reason:'entry' as const,strategyRef:'fixed_scenario_request'}]};
  const fills:ReserveInvestmentFill[]=[{id:'closed-buy',assetId:'separate-closed-episode',side:'buy',quantity:'1',priceUsd:text(closedBasis),feeUsd:'0',atMs:nowMs-3,sequence:0},
    {id:'closed-sell',assetId:'separate-closed-episode',side:'sell',quantity:'1',priceUsd:text(closedBasis.add(L)),feeUsd:'0',atMs:nowMs-2,sequence:0},
    ...(held.gt(0)?[{id:'held-buy',assetId,side:'buy' as const,quantity:'1',priceUsd:text(basis),feeUsd:'0',atMs:nowMs-1,sequence:0}]:[])];
  const eligibility=projectReserveInvestment({scopeId,assurance:'scenario',fromMs:nowMs-4,toMs:nowMs,opening:[],fills,finalQuantities:budget.positions,marks:{[assetId]:text(mark)},incomeUsd:value('0'),expensesUsd:value('0'),coverageComplete:true,feesComplete:true,reasonCodes:[],evidenceRefs:['explicit_hypothetical_cash_book']});
  const f:ReserveFinancialInput={scopeId,epochId:null,fromMs:nowMs-4,toMs:nowMs,assurance:'scenario',observedAtMs:nowMs,expiresAtMs:nowMs+30_000,openingEquityUsd:value(request.openingUsd),sourceCutHash:null,
    trackingLimitations:['Hypothetical cash origin; $0 booked historical fees. Proposed sale costs use the separately stated P2 scenario.'],
    observedCashUsd:value(request.cashUsd),riskAssetValueUsd:value(text(held)),economicPnlUsd:value(text(p)),realizedPnlUsd:eligibility.realizedPnlUsd,unrealizedPnlUsd:eligibility.unrealizedPnlUsd,equityUsd:value(text(equity)),activeEquityUsd:value(text(equity)),spendableUsd:value(request.cashUsd),
    contributionsUsd:value('0'),netOutflowsUsd:value('0'),confirmedReceiptsUsd:value('0'),incomeUsd:value('0'),feesUsd:value('0'),completedWins:eligibility.completedWins,
    actualReservedUsd:value('0'),actualTaxHoldUsd:value('0'),actualPendingUsd:value('0'),priorProfitBackedUsd:value('0'),reasonCodes:[],evidenceRefs:[eligibility.id,'scenario_not_observed_account_evidence'],budgetRevision:budget.revision,generation:null};
  const policy=reservePolicy({scopeId,originProfileId:'hypothetical',previousId:null,createdAtMs:nowMs-4,settings:request.settings});
  const baseline=reserveBaseline(policy,null,{...f,economicPnlUsd:value('0'),activeEquityUsd:value(request.openingUsd)},'scenario-policy-before-gains',nowMs-4);
  const floor=reserveCapitalWitness(frame,held.isZero()?'cash_only':'fixed_request');
  const report=evaluateProfitReserve(policy,baseline,f,floor,nowMs);
  // Sale costs/legality are a different hypothetical question; do not loosen any observed policy.
  const saleFrame={...frame,policy:{...frame.policy,id:capitalHash('sale-consequence-scenario-v1'),discretionaryFloorUsd:'0',maxPositionFraction:'1',accountMaxPositionFraction:'1',maxInvestedFraction:'1',accountMaxInvestedFraction:'1',riskExitBypassesDiscretionaryFloor:true}};
  return reserveConsequences(report,eligibility,held.gt(0)?{frame:saleFrame,assetId,quantity:'1',basisUsd:text(basis)}:null,request.externalExpenseUsd,policy.settings.cadence,policy.createdAtMs);
}
