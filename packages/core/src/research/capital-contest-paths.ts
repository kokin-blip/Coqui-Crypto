import { capitalHash } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D,budgetAmount as amount,budgetText as text } from '../execution/native-rules.js';
import { mulberry32,stationaryBootstrapIndices } from '../validation/monte-carlo.js';
import { type ReplayMarketFrame } from './capital-replay-types.js';
import type { CapitalContestManifestV1,ContestInputManifestV1 } from './capital-contest-types.js';
/** Fixed-universe conditional paths only. Gaps/status changes belong to original-calendar stress tests. */
export function contestResamplingReasons(m:CapitalContestManifestV1,data:ContestInputManifestV1):string[]{
 const rows=[...data.warmup,...data.market],reasons:string[]=[];
 if(rows.length<m.inference.minHistoryDays||rows.length/m.inference.meanBlockDays<m.inference.minEffectiveBlocks)reasons.push('insufficient_history_or_effective_blocks');
 if(rows.some((r,i)=>i>0&&r.atMs!==rows[i-1]!.endMs))reasons.push('resampling_calendar_gap');
 if(m.replay.assets.some(id=>rows.some(r=>!r.assets[id]?.tradable||r.assets[id]?.openUsd==null||r.assets[id]?.closeUsd==null)))reasons.push('resampling_incomplete_prices_or_status');
 if(m.replay.assets.some(id=>data.membership.filter(x=>x.assetId===id&&x.eligible&&x.fromMs<=m.replay.warmupFromMs&&x.toMs>=m.replay.toMs).length!==1))reasons.push('resampling_membership_changes');
 return reasons;
}
export function resampleContestData(m:CapitalContestManifestV1,data:ContestInputManifestV1,index:number){
 const reasons=contestResamplingReasons(m,data);if(reasons.length)throw new Error(reasons.join(','));
 if(!Number.isSafeInteger(index)||index<0||index>=m.inference.resamples)throw new Error('contest_path_index');
 const rows=[...data.warmup,...data.market],indices=stationaryBootstrapIndices(rows.length-1,rows.length-1,m.inference.meanBlockDays,mulberry32((m.inference.seed+index)>>>0));
 const last:Record<string,string>=Object.fromEntries(m.replay.assets.map(id=>[id,rows[0]!.assets[id]!.closeUsd!]));
 const generated:ReplayMarketFrame[]=[rows[0]!];
 for(const [i,sampled] of indices.entries()){
  const source=rows[sampled+1]!,prior=rows[sampled]!;const destination=rows[i+1]!;
  const assets=Object.fromEntries(m.replay.assets.map(id=>{
   const a=source.assets[id]!,overnight=amount(a.openUsd!).div(prior.assets[id]!.closeUsd!),intraday=amount(a.closeUsd!).div(a.openUsd!);
   // Explicit 20-significant-digit scenario prices, never presented as provider observations.
   const open=amount(last[id]!).mul(overnight).toSignificantDigits(20,D.ROUND_DOWN),close=open.mul(intraday).toSignificantDigits(20,D.ROUND_DOWN);last[id]=text(close);
   const quote=(p:string|null)=>p===null?null:text(open.mul(p).div(a.openUsd!).toSignificantDigits(20,D.ROUND_DOWN));
   return [id,{...a,openUsd:text(open),closeUsd:text(close),bidUsd:quote(a.bidUsd),askUsd:quote(a.askUsd),quoteAtMs:a.quoteAtMs===null?null:destination.atMs,sourceRef:`conditional_joint_path:${index}:${sampled}`}];
  }));generated.push({...destination,assets});
 }
 const result:ContestInputManifestV1={warmup:generated.filter(r=>r.atMs<m.replay.fromMs),market:generated.filter(r=>r.atMs>=m.replay.fromMs),membership:data.membership.map(x=>({...x,assurance:'scenario'}))};
 return {data:result,indices,id:capitalHash({manifest:capitalHash(m),index,indices,dataHash:capitalHash(result)})};
}
