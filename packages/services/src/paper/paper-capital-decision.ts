import { budgetAmount as a, budgetText as t, capitalHash, decimal, instrumentKey, evaluateCapitalFeasibility,
  type AllocationPolicy, type AssetRef, type CapitalFeasibilityInputV1, type ExecutionIntent } from '@coqui/core';
export const PAPER_CAPITAL_DECISION_VERSION='trendvol-paper-reserved-active-nav-v1';
/** Explicit cash/actual positions; no token holdings or minimum-size forced orders. */
export function paperCapitalDecision(input:{profileId:string;scheduledForMs:number;targets:AllocationPolicy;assets:readonly AssetRef[];frame:CapitalFeasibilityInputV1}) {
  const {frame}=input,b=frame.budget;
  if(!b.executionEligible || b.activeEquityUsd===null)throw new Error('paper_capital_budget_unavailable');
  const byId=new Map<string,AssetRef>(input.assets.map(asset=>[instrumentKey(asset.instrument),asset]));
  const wanted=input.targets.targets.map(target=>{
    const id=instrumentKey(target.instrument),mark=frame.assets.find(x=>x.assetId===id)?.markUsd;
    if(!mark || !a(mark).gt(0) || !byId.has(id))throw new Error('paper_capital_target_price_missing');
    const current=a(b.positions[id]??'0'),desired=a(b.activeEquityUsd!).mul(String(target.weight)).div(mark);
    const drift=current.mul(mark).div(b.activeEquityUsd!).sub(String(target.weight)).abs().mul(100);
    return {assetId:id,deltaQuantity:drift.lt(String(input.targets.rebalanceBandPct))?'0':t(desired.sub(current)),reason:'rebalance' as const,strategyRef:PAPER_CAPITAL_DECISION_VERSION};
  }).filter(x=>!a(x.deltaQuantity).isZero());
  const report=evaluateCapitalFeasibility({...frame,intents:wanted,requireFullRequest:false});
  const executable=report.state==='unavailable'||report.riskResiduals.length?[]:report.orders;
  const intents:ExecutionIntent[]=executable.map(order=>({asset:byId.get(order.assetId)!,side:order.side,amountUsd:decimal(a(order.quantity).mul(frame.assets.find(x=>x.assetId===order.assetId)!.markUsd).toFixed()),origin:'rebalance',urgency:'passive',reason:'Active capital target after native and cost constraints',referencePriceUsd:decimal(frame.assets.find(x=>x.assetId===order.assetId)!.markUsd)}));
  return {id:capitalHash({version:PAPER_CAPITAL_DECISION_VERSION,profileId:input.profileId,scheduledForMs:input.scheduledForMs,budgetRevision:b.revision,targets:input.targets,reportId:report.id}),version:PAPER_CAPITAL_DECISION_VERSION,report,intents};
}
