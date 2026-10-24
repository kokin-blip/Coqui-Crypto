import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, evaluateCapitalFeasibility,
  identifiedBudgetFact, reserveValue as value, reserveUnavailable as unavailable, type CapitalFeasibilityInputV1,
  type ReservePreview, type ReserveEligibilityReport } from '@coqui/core';
import type { ChannelResponse } from '@coqui/contracts';

type Inspection=ChannelResponse<'capital.reserve.preview'>;
export interface ReserveSaleInput {readonly frame:CapitalFeasibilityInputV1;readonly assetId:string;readonly quantity:string;readonly basisUsd:string}
export function reserveConsequences(report:ReservePreview,eligibility:ReserveEligibilityReport|null,saleInput:ReserveSaleInput|null,externalExpenseUsd='0',cadence:'manual'|'daily'|'weekly'|'monthly'='manual',anchorMs=report.evaluatedAtMs):Inspection{
  const shortfall=report.cashShortfallUsd,none=shortfall.state==='available'&&amount(shortfall.value).isZero(),unknown=unavailable('hypothetical_sale_evidence_unavailable');
  let sale:Inspection['sale']={status:none?'not_needed':'unavailable',requiredCashUsd:shortfall,saleNotionalUsd:none?value('0'):unknown,modeledCostUsd:none?value('0'):unknown,
    realizedGainUsd:none?value('0'):unknown,residualPositionUsd:none?value('0'):unknown,accountCashAfterSaleUsd:none?report.financial.spendableUsd:unknown,turnoverUsd:none?value('0'):unknown,
    reasonCodes:none?[]:['hypothetical_sale_evidence_unavailable'],evidenceRefs:[],fundsEligibility:false};
  if(!none&&shortfall.state==='available'&&saleInput){
    const {frame,assetId}=saleInput,asset=frame.assets.find(a=>a.assetId===assetId)!;
    const netPrice=amount(asset.quote.bid).mul(new D(1).sub(amount(frame.fees.slippageBps).div(10_000))).mul(new D(1).sub(frame.fees.rate));
    const increment=asset.rules.quantityIncrement.state==='known'?amount(asset.rules.quantityIncrement.value):null;
    if(increment&&netPrice.gt(0)){
      const quantity=amount(shortfall.value).add(frame.fees.fixedUsd).div(netPrice).div(increment).ceil().mul(increment);
      const result=evaluateCapitalFeasibility({...frame,intents:[{assetId,deltaQuantity:text(quantity.neg()),reason:'risk_exit',strategyRef:'hypothetical_sale_only'}],requireFullRequest:true});
      const order=result.orders[0];
      if(result.state==='feasible'&&order&&quantity.lte(saleInput.quantity)){
        const net=amount(order.cashCreditUsd).sub(order.cashDebitUsd),basis=amount(saleInput.basisUsd).mul(quantity).div(saleInput.quantity);
        sale={status:'hypothetical',requiredCashUsd:shortfall,saleNotionalUsd:value(order.notionalUsd),modeledCostUsd:value(text(quantity.mul(asset.markUsd).sub(net))),
          realizedGainUsd:value(text(net.sub(basis))),residualPositionUsd:value(text(amount(saleInput.quantity).sub(quantity).mul(asset.markUsd))),
          accountCashAfterSaleUsd:report.financial.spendableUsd.state==='available'?value(text(amount(report.financial.spendableUsd.value).add(net))):report.financial.spendableUsd,
          turnoverUsd:value(order.notionalUsd),reasonCodes:[],evidenceRefs:[result.id],fundsEligibility:false};
      }else sale={...sale,reasonCodes:[...result.reasonCodes,...result.blocked.flatMap(r=>r.reasons),...result.riskResiduals,'hypothetical_sale_not_fully_feasible']};
    }
  }
  const f=report.financial,r=report.reserveUsd,comparison:Inspection['comparison']=[-2000,2000].map(marketMoveBps=>{
    if(f.riskAssetValueUsd.state!=='available'||f.equityUsd.state!=='available'||r.state!=='available'||f.spendableUsd.state!=='available')return {marketMoveBps,investedOutcomeUsd:unavailable('comparison_inputs_unavailable'),reserveOutcomeUsd:unavailable('comparison_inputs_unavailable'),userNetInvestedUsd:unavailable('comparison_inputs_unavailable'),userNetReserveUsd:unavailable('comparison_inputs_unavailable')};
    // Explicit counterfactual: the proposed cash is invested at the start of each path or kept as zero-yield USD.
    const delta=amount(r.value).mul(marketMoveBps).div(10_000),common=amount(f.equityUsd.value).add(amount(f.riskAssetValueUsd.value).mul(marketMoveBps).div(10_000));
    return {marketMoveBps,investedOutcomeUsd:value(text(common.add(delta))),reserveOutcomeUsd:value(text(common)),
      userNetInvestedUsd:value(text(common.add(delta).sub(externalExpenseUsd))),userNetReserveUsd:value(text(common.sub(externalExpenseUsd)))};
  });
  let nextReviewAtMs:number|null=null;
  if(cadence!=='manual'){
    const interval=cadence==='daily'?86_400_000:cadence==='weekly'?7*86_400_000:30*86_400_000;
    nextReviewAtMs=anchorMs+(Math.floor(Math.max(0,report.evaluatedAtMs-anchorMs)/interval)+1)*interval;
  }
  return identifiedBudgetFact({report,sale,comparison,comparisonAssumptions:[
    'Hypothetical marginal-cash comparison only; not a portfolio forecast, backtest or probability.',
    'Same starting equity/contributions. Only proposed cash differs: invested immediately versus retained as USD; the same held exposures receive the stated market move in both paths.',
    'Market moves are -20% / +20%, zero reserve yield, $0 additional path trading costs; prior booked costs are already in equity.',
    `Outside-account expense ${externalExpenseUsd} USD deducted once from each user-net outcome. No external receipt is simulated.`],
    eligibility,nextReviewAtMs});
}
