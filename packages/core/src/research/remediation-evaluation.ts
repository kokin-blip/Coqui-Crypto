import { Decimal } from 'decimal.js';
import { EXECUTION_ARMS, type ExecutionArm, type ExecutionTarget, type ExecutionAsset, type ExecutionPlan } from '../execution/remediation-planner.js';
import type { MatchedBook } from '../execution/remediation-book.js';

export interface RemediationBookObservation {
  readonly state: MatchedBook; readonly target: ExecutionTarget;
  readonly previousTarget: ExecutionTarget | null; readonly fulfilled: readonly string[];
  readonly arm: ExecutionArm; readonly multiplier: number; readonly plans: readonly ExecutionPlan[];
  readonly equityUsd: string; readonly modeledOnly: true;
}
export interface EvaluationFrame { readonly slotMs: number; readonly capturedAtMs: number; readonly assets: readonly ExecutionAsset[] }
export interface MatchedEvaluationRow { readonly slotMs: number; readonly frame: EvaluationFrame; readonly book: RemediationBookObservation }
const STEP = 14_400_000, DAY = 86_400_000;
const mid = (asset: ExecutionAsset) => new Decimal(asset.bid).plus(asset.ask).div(2);
export function evaluateMatchedArm(startMs: number, endMs: number, arm: ExecutionArm, multiplier: 1 | 2,
  rows: readonly MatchedEvaluationRow[], terminal: EvaluationFrame | null) {
  const expected = (endMs-startMs)/STEP;
  const ordered = [...rows].sort((a,b)=>a.slotMs-b.slotMs);
  const missing = Array.from({length:expected},(_,i)=>startMs+i*STEP).filter((at)=>!ordered.some((row)=>row.slotMs===at));
  if (missing.length || ordered.length !== expected || !terminal || terminal.slotMs !== endMs ||
      ordered.some((row,index)=>row.slotMs!==startMs+index*STEP || row.book.arm!==arm || row.book.multiplier!==multiplier ||
        row.frame.slotMs!==row.slotMs || row.frame.capturedAtMs<row.slotMs || row.frame.capturedAtMs>=row.slotMs+900_000) ||
      terminal.capturedAtMs<endMs || terminal.capturedAtMs>=endMs+900_000)
    return { status: 'incomplete_coverage' as const, coverage: {expected, observed:ordered.length, missing, terminal:!!terminal}, metrics:null };
  let peak = new Decimal(100000), drawdown = new Decimal(0), turnover = new Decimal(0), fees = new Decimal(0);
  let tracking = new Decimal(0), shortfall = new Decimal(0), blockedEntries = 0;
  const flows: Record<string,Decimal> = {}, equity: Decimal[] = [new Decimal(100000)];
  const cashFlows: Record<string,Decimal> = {};
  for (const row of ordered) {
    const value = new Decimal(row.book.equityUsd); equity.push(value); peak = Decimal.max(peak,value);
    drawdown = Decimal.max(drawdown,peak.minus(value).div(peak));
    for (const asset of row.frame.assets) {
      const weight = new Decimal(row.book.state.quantities[asset.id]??'0').mul(mid(asset)).div(value);
      tracking = tracking.plus(weight.minus(row.book.target.weights[asset.id]??'0').pow(2));
    }
    for (const plan of row.book.plans) {
      blockedEntries += plan.blocked.filter((item)=>item.reason==='discretionary_entry_cost').length;
      for (const intent of plan.orders) {
        const fill = row.book.state.applied[intent.id];
        if (!fill) throw new Error('missing_modeled_fill');
        const notional = new Decimal(fill.notional), quantity = new Decimal(fill.quantity), fee = new Decimal(fill.fee);
        turnover = turnover.plus(notional);
        fees = fees.plus(intent.side==='buy' ? fee.mul(notional.div(quantity)) : fee);
        shortfall = shortfall.plus(intent.side==='buy' ? notional.minus(quantity.mul(intent.midpoint)) : quantity.mul(intent.midpoint).minus(notional));
        cashFlows[intent.assetId] = (cashFlows[intent.assetId]??new Decimal(0)).plus(intent.side==='buy' ? notional.neg() : notional.minus(fee));
      }
    }
  }
  const state = ordered.at(-1)!.book.state;
  const ending = terminal.assets.reduce((sum,asset)=>sum.plus(new Decimal(state.quantities[asset.id]??'0').mul(mid(asset))),new Decimal(state.cash));
  equity.push(ending); peak = Decimal.max(peak,ending); drawdown = Decimal.max(drawdown,peak.minus(ending).div(peak));
  for (const asset of terminal.assets) flows[asset.id] = (cashFlows[asset.id]??new Decimal(0)).plus(new Decimal(state.quantities[asset.id]??'0').mul(mid(asset)));
  // Day-end matched equity returns, with the untouched terminal mark as final endpoint.
  const dailyReturns: number[] = [];
  let prior = new Decimal(100000);
  for (let day=startMs+DAY; day<=endMs; day+=DAY) {
    const before = ordered.find((row)=>row.slotMs===day-STEP)!.book.state;
    const mark = day===endMs ? terminal : ordered.find((row)=>row.slotMs===day)!.frame;
    const value = mark.assets.reduce((sum,asset)=>sum.plus(new Decimal(before.quantities[asset.id]??'0').mul(mid(asset))),new Decimal(before.cash));
    dailyReturns.push(value.div(prior).minus(1).toNumber()); prior=value;
  }
  return {status:'complete' as const, coverage:{expected,observed:ordered.length,missing,terminal:true}, metrics:{
    netReturn:ending.div(100000).minus(1).toString(), endingEquity:ending.toString(), maxDrawdown:drawdown.toString(),
    turnoverUsd:turnover.toString(), modeledFeesUsd:fees.toString(), signedModeledShortfallUsd:shortfall.toString(),
    trackingErrorRms:tracking.div(ordered.length * terminal.assets.length).sqrt().toString(), blockedDiscretionaryEntries:blockedEntries,
    missedOpportunityValue:null, perCoinNetPnl:Object.fromEntries(Object.entries(flows).map(([id,value])=>[id,value.toString()])),
    dailyReturns, fills:'immediate_model_only', actualLatencyMs:null, actualPartialFillCoverage:'unavailable' }};
}

/** Fixed seven-day circular block bootstrap; Bonferroni simultaneous 95% bounds for B/C/D. */
export function pairedReturnUncertainty(differences: readonly number[], seed = 20260930) {
  if (differences.length<56 || differences.some((value)=>!Number.isFinite(value)))
    return {status:'insufficient_evidence' as const, lower:null,upper:null,effectiveWeeklyUnits:Math.floor(differences.length/7)};
  let state = seed>>>0;
  const random = () => {state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const means:number[]=[];
  for (let replicate=0;replicate<10000;replicate++) {
    let sum=0,count=0;
    while(count<differences.length) {
      const start=Math.floor(random()*differences.length);
      for(let offset=0;offset<7 && count<differences.length;offset++,count++) sum+=differences[(start+offset)%differences.length]!;
    }
    means.push(sum/differences.length);
  }
  means.sort((a,b)=>a-b);
  return {status:'estimated' as const, lower:means[83]!,upper:means[9916]!,effectiveWeeklyUnits:Math.floor(differences.length/7),
    blockDays:7,replicates:10000,seed,method:'paired_circular_blocks_bonferroni_3'};
}
export const REMEDIATION_SELECTION_RULE = 'positive_each_fold_base_and_double_no_worse_drawdown_simultaneous_lower_positive_v1';
export const declaredExecutionTrials = () => EXECUTION_ARMS.map((arm)=>({trialId:`trendvol-execution-${arm}-v1`,arm,
  scenarios:['base','double'], selectionCandidate:['B','C','D'].includes(arm)}));
