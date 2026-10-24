import { BudgetDecimal as D,budgetAmount as amount,budgetText as text } from '../execution/native-rules.js';
import type { FeasibilityIntentV1 } from '../execution/capital-feasibility.js';
import type { ReplayKernelControl } from './capital-replay-kernel.js';
import type { ContestArmV1 } from './capital-contest-types.js';
/** Partial adjustment changes intended quantity. It never fabricates a partial fill/pending remainder. */
export function contestExecutionPolicy(arm:ContestArmV1):NonNullable<ReplayKernelControl['adjust']>{
 return (intents,context)=>intents.flatMap((intent):FeasibilityIntentV1[]=>{
  if(arm.execution==='legacy_shaped'||intent.reason==='risk_exit')return [intent];
  const p=context.marks[intent.assetId];if(p===undefined||amount(context.activeUsd).lte(0))return [intent];
  const current=amount(context.positions[intent.assetId]??'0').mul(p).div(context.activeUsd),target=amount(context.targets[intent.assetId]??'0');
  const band=amount(current.isZero()||target.isZero()?arm.changeBand:arm.routineBand),gap=target.sub(current);
  if(gap.abs().lte(band))return [];
  const edge=target.sub(band.mul(gap.gt(0)?1:-1));
  const q=D.max(0,edge).mul(context.activeUsd).div(p).sub(context.positions[intent.assetId]??'0');
  return q.isZero()?[]:[{...intent,deltaQuantity:text(q)}];
 });
}
