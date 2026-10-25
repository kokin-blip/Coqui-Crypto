import { budgetAmount as a, budgetText as t, capitalHash, instrumentKey, modeledFill, DEFAULT_TRADE_COST_CONFIG, type ExecutionIntent, type BudgetReportV1 } from '@coqui/core';
import type { PaperMarketData } from './oms.js';
import { paperCostModelHash } from './venue.js';
/** Same reviewed consequence contract, using real cash/positions and the P2 active denominator. */
export function paperCapitalProposalPreview(input:{proposalHash:string;revision:number;intents:readonly ExecutionIntent[];budget:BudgetReportV1;market:PaperMarketData;nowMs:number;issuedAtMs:number;killSwitchEngaged:boolean}) {
  const costHash=paperCostModelHash(),b=input.budget;
  const unavailable=(reason:string)=>({status:'unavailable' as const,reason,proposalHash:input.proposalHash,revision:input.revision,previewHash:null,costHash,expiresAtMs:input.nowMs,actions:[],drift:[],totalCostUsd:null});
  if(!b.executionEligible || !b.activeEquityUsd || !b.spendableUsd || input.nowMs>=b.expiresAtMs)return unavailable('capital_budget_unavailable');
  if(input.killSwitchEngaged)return unavailable('kill_switch_engaged');
  if(input.issuedAtMs>input.nowMs || input.nowMs-input.issuedAtMs>60_000)return unavailable('preview_expired');
  let cash=a(b.spendableUsd),total=a('0');const positions=new Map(Object.entries(b.positions).map(([id,q])=>[id,a(q)])),actions=[];
  for(const intent of input.intents){const id=instrumentKey(intent.asset.instrument),bar=input.market.bars(id).filter(x=>x.isComplete && x.endTimeMs<=input.nowMs && x.retrievedAtMs<=input.nowMs).at(-1);
    if(!bar || bar.close<=0 || input.nowMs-bar.endTimeMs>86_400_000)return unavailable('reference_quote_unavailable');
    const price=String(bar.close),quantity=a(intent.amountUsd).div(price),fill=modeledFill(intent.side,t(quantity),price,DEFAULT_TRADE_COST_CONFIG),held=positions.get(id)??a('0');
    if(intent.side==='sell' && quantity.gt(held))return unavailable('insufficient_marked_exposure');
    if(intent.side==='buy' && a(fill.cashChange).neg().gt(cash))return unavailable('capital_cash_insufficient');
    // Sale proceeds do not expand this review's buy budget.
    if(intent.side==='buy')cash=cash.add(fill.cashChange);
    const next=held.add(intent.side==='buy'?quantity:quantity.neg());positions.set(id,next);total=total.add(fill.totalCost);
    actions.push({productId:intent.asset.instrument.productId,side:intent.side,feeUsd:fill.venueFee,spreadUsd:fill.spreadCost,slippageUsd:fill.slippageCost,impactUsd:fill.impactCost,totalCostUsd:fill.totalCost,beforeExposureUsd:t(held.mul(price)),afterExposureUsd:t(next.mul(price)),referenceAtMs:bar.endTimeMs,referencePriceUsd:price});
  }
  const body={version:'paper-reserve-cash-v1',proposalHash:input.proposalHash,revision:input.revision,budgetRevision:b.revision,costHash,actions};
  return {status:'available' as const,reason:null,proposalHash:input.proposalHash,revision:input.revision,previewHash:capitalHash(body),costHash,expiresAtMs:Math.min(input.issuedAtMs+60_000,b.expiresAtMs),actions,drift:[],totalCostUsd:t(total)};
}
