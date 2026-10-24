import { capitalHash } from '../portfolio/capital-ledger.js';
import { budgetAmount as amount, BudgetDecimal as D } from '../execution/native-rules.js';
import { validateCapitalReplay,replayAmount } from './capital-replay-tape.js';
import { CAPITAL_REPLAY_GRID,CAPITAL_REPLAY_DAY as DAY } from './capital-replay-types.js';
import { CAPITAL_CONTEST_VERSION,type CapitalContestManifestV1,type ContestInputManifestV1 } from './capital-contest-types.js';
const unique=(a:readonly string[])=>a.length>0&&a.every(x=>x.length>0&&x.length<=256)&&new Set(a).size===a.length;
const hash=(s:string)=>/^[a-f0-9]{64}$/u.test(s);
/** Complete inventory and workload are checked before financial inputs are opened. */
export function validateCapitalContest(m:CapitalContestManifestV1):string {
 validateCapitalReplay(m.replay);if(m.replay.decisionTapeHash!==capitalHash([]))throw new Error('contest_dynamic_template_requires_empty_decisions');
 if(!unique(m.scenarios.map(v=>v.id))||m.scenarios.length>64)throw new Error('contest_scenario_inventory');
 for(const variant of m.scenarios)validateCapitalReplay(contestScenarioSpec(m,variant.id));
 const n=(v:number,min:number,max:number)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 if(m.version!==CAPITAL_CONTEST_VERSION||m.mode!=='offline_development'||m.liveExecutionPermitted!==false||m.confirmatoryEligible!==false||!hash(m.dataHash)||m.supersedesManifestHash!==null&&!hash(m.supersedesManifestHash)||
  !unique(m.candidates.map(x=>x.id))||!unique(m.arms.map(x=>x.id))||!unique(m.trials.map(x=>x.id))||!unique(m.contrasts.map(x=>x.id))||m.arms.length>128||m.trials.length>10_000)throw new Error('contest_manifest_invalid');
 const {resources:r,inference:i,selection:s}=m;
 const structural=m.arms.filter(a=>a.group==='S'),families=structural.map(a=>m.candidates.find(c=>c.id===a.candidateId)?.family);
 if(structural.filter(a=>a.selectable).length!==2||new Set(structural.filter(a=>a.selectable).map(a=>m.candidates.find(c=>c.id===a.candidateId)?.family)).size!==2||!['trend','rotation','allocator','hold','passive','cash'].every(f=>families.includes(f as typeof families[number]))||m.candidates.filter(c=>c.family==='exposure'&&structural.some(a=>a.candidateId===c.id)).length!==2||new Set(m.scenarios.map(v=>capitalHash(v.policy))).size!==1)throw new Error('contest_required_controls_or_shared_risk_missing');
 if(!Number.isFinite(s.minimumFoldExcessPct)||!Number.isFinite(s.minimumWorstRollingReturnPct)||s.minimumWorstRollingReturnPct < -100)throw new Error('contest_stability_objective');
 if(!n(r.maxBaseCells,1,10_000)||!n(r.maxPaths,0,100_000)||!n(r.maxOutputBytes,1000,Number.MAX_SAFE_INTEGER)||m.trials.length>r.maxBaseCells||
  !n(i.resamples,0,r.maxPaths)||!n(i.seed,0,0xffffffff)||!n(i.meanBlockDays,1,5000)||!n(i.minHistoryDays,30,5000)||!n(i.minEffectiveBlocks,2,5000)||!n(i.minTailReplications,20,100_000)||!(i.alpha>0&&i.alpha<=0.05)||
  !n(s.minObservations,365,5000)||!n(s.minActions,30,100000)||!(s.maxPbo>0&&s.maxPbo<=0.05)||!(s.minDsr>=0.95&&s.minDsr<=1)||!(s.maxDrawdownPct>=0&&s.maxDrawdownPct<=100)||!n(s.partitions,4,18)||s.partitions%2||!s.rollingDays.length||s.rollingDays.some(d=>!n(d,1,5000)))throw new Error('contest_bounds_or_stricter_gate');
 const requested=m.trials.length*(i.resamples+1);if(!Number.isSafeInteger(requested)||requested*256>r.maxOutputBytes)throw new Error('contest_resource_preflight');
 if(m.operatingRequests.map(x=>x.capitalUsd).sort().join()!==[...CAPITAL_REPLAY_GRID].sort().join()||m.operatingRequests.some(x=>x.intents.length>10||new Set(x.intents.map(i=>i.assetId)).size!==x.intents.length||x.intents.some(i=>!m.replay.assets.includes(i.assetId))))throw new Error('contest_operating_request_identity');
 for(const request of m.operatingRequests)for(const intent of request.intents)replayAmount(intent.deltaQuantity,true);
 let weights=new D(0);for(const [capital,w] of Object.entries(m.primaryWeights)){replayAmount(w);if(!CAPITAL_REPLAY_GRID.includes(capital as typeof CAPITAL_REPLAY_GRID[number])||capital==='100000'&&amount(w).gt(0))throw new Error('contest_primary_region');weights=weights.add(w);}
 if(!weights.eq(1))throw new Error('contest_primary_weights');
 if(!unique(m.folds.map(f=>f.id))||m.folds[0]?.validationFromMs!==m.replay.fromMs||m.folds.at(-1)?.validationToMs!==m.replay.toMs)throw new Error('contest_folds');
 for(const [k,f] of m.folds.entries())if(![f.trainFromMs,f.trainToMs,f.validationFromMs,f.validationToMs,f.embargoMs].every(Number.isSafeInteger)||f.trainFromMs<m.replay.warmupFromMs||f.trainFromMs>=f.trainToMs||f.trainToMs+f.embargoMs>f.validationFromMs||f.validationFromMs<f.trainToMs||f.validationFromMs>=f.validationToMs||f.validationFromMs<m.replay.fromMs||f.validationToMs>m.replay.toMs||f.embargoMs<0||k>0&&f.validationFromMs!==m.folds[k-1]!.validationToMs)throw new Error('contest_noncausal_fold');
 for(const c of m.candidates){
  if(!['trend','rotation','allocator','hold','passive','cash','exposure'].includes(c.family)||!n(c.lookbackDays,1,5000)||!n(c.volatilityDays,2,5000)||!n(c.cadenceDays,1,365)||!n(c.decisionDelayMs,1,DAY-1)||c.decisionDelayMs<m.replay.publicationDelayMs||!Number.isSafeInteger(c.anchorMs)||c.anchorMs%DAY||!n(c.topN,1,10)||!n(c.buffer,1,10))throw new Error('contest_candidate_invalid');
  if(c.family==='rotation'&&m.replay.assets.length<3)throw new Error('contest_rotation_buffer_degeneracy');
  if(c.family==='allocator'&&!c.momentum||c.family==='exposure'&&!m.candidates.some(x=>x.id===c.exposureOf&&['trend','rotation'].includes(x.family)))throw new Error('contest_component_missing');
  if(c.volatility&&(!Object.values(c.volatility).every(Number.isFinite)||c.volatility.targetVolPct<=0||c.volatility.minExposure<0||c.volatility.maxExposure>1||c.volatility.minExposure>c.volatility.maxExposure||c.volatility.belowTrendMaxExposure<0||c.volatility.belowTrendMaxExposure>1))throw new Error('contest_volatility_config');
  replayAmount(c.dustUsd);let sum=new D(0);for(const [asset,w] of Object.entries(c.baseWeights)){if(!m.replay.assets.includes(asset))throw new Error('contest_weight_identity');replayAmount(w);sum=sum.add(w);}if(sum.gt(1))throw new Error('contest_weight_risk');
 }
 for(const a of m.arms){const c=m.candidates.find(c=>c.id===a.candidateId);if(!c||a.group==='S'&&c.weighting==='hrp'||!['S','V','E','R'].includes(a.group)||!['legacy_shaped','band_edge'].includes(a.execution)||!n(a.shareBps,0,10000)||a.selectable&&(!['trend','rotation'].includes(c.family)||a.group!=='S')||a.capMode==='economic_cash_review'&&a.group!=='R')throw new Error('contest_arm_invalid');
  for(const x of [a.routineBand,a.changeBand,a.minimumBatchUsd,a.retainedCapitalUsd])replayAmount(x);
  if(amount(a.routineBand).gt(1)||amount(a.changeBand).gt(1))throw new Error('contest_band_invalid');
  for(const v of m.scenarios){const rows=m.trials.filter(t=>t.armId===a.id&&t.variantId===v.id);if(rows.map(t=>t.capitalUsd).sort().join()!==[...CAPITAL_REPLAY_GRID].sort().join())throw new Error('contest_all_capital_rows_required');}
 }
 if(m.trials.some(t=>!m.arms.some(a=>a.id===t.armId)||!m.scenarios.some(v=>v.id===t.variantId))||new Set(m.trials.map(t=>`${t.armId}|${t.capitalUsd}|${t.variantId}`)).size!==m.trials.length)throw new Error('contest_trial_identity');
 for(const c of m.contrasts)if(c.primary&&c.group==='S'&&c.minimumDifference<0||!m.arms.some(a=>a.id===c.left)||!m.arms.some(a=>a.id===c.right)||c.left===c.right||!m.scenarios.some(v=>v.id===c.variantId)||!Number.isFinite(c.minimumDifference))throw new Error('contest_contrast_invalid');
 if(!n(m.trialHistory.count,1,1_000_000)||m.trialHistory.sharpeTrials.some(x=>!Number.isFinite(x))||m.trialHistory.sharpeTrials.length>m.trialHistory.count||!m.trialHistory.evidenceRefs.length||!['complete','conservative-upper-bound','known-lower-bound'].includes(m.trialHistory.state))throw new Error('contest_trial_history');
 replayAmount(m.distributionObjective.minimumReservedOrReceivedUsd);if(!(m.distributionObjective.maxSacrificePct>=0&&m.distributionObjective.maxSacrificePct<=100)||!n(m.distributionObjective.maxFloorBreaches,0,100000))throw new Error('contest_distribution_objective');
 return capitalHash(m);
}
export function validateContestData(m:CapitalContestManifestV1,data:ContestInputManifestV1):void{
 if(capitalHash(data)!==m.dataHash||capitalHash(data.market)!==m.replay.marketTapeHash||data.market.length>5000||data.warmup.length>5000||data.membership.length>100000)throw new Error('contest_data_identity');
 const rows=[...data.warmup,...data.market];let last=-1;
 const availability=data.availability??[];if(m.replay.availabilityBasis==='observed'&&!availability.length||new Set(availability.map(a=>`${a.assetId}:${a.endMs}`)).size!==availability.length||availability.some(a=>!m.replay.assets.includes(a.assetId)||!Number.isSafeInteger(a.endMs)||!Number.isSafeInteger(a.observedAtMs)||a.observedAtMs<a.endMs))throw new Error('contest_observed_publication_evidence_missing');
 for(const row of rows){if(row.atMs<=last||row.atMs%DAY||row.endMs!==row.atMs+DAY||row.atMs<m.replay.warmupFromMs||row.endMs>m.replay.toMs)throw new Error('contest_dated_panel_invalid');last=row.atMs;
  for(const [id,a] of Object.entries(row.assets)){if(!m.replay.assets.includes(id))throw new Error('contest_provider_identity');for(const p of [a.openUsd,a.closeUsd,a.bidUsd,a.askUsd])if(p!==null){replayAmount(p);if(amount(p).lte(0))throw new Error('contest_invalid_price');}}
 }
 if(data.warmup.some(r=>r.endMs>m.replay.fromMs)||data.market.some(r=>r.atMs<m.replay.fromMs))throw new Error('contest_warmup_boundary');
 for(const x of data.membership)if(!m.replay.assets.includes(x.assetId)||![x.fromMs,x.toMs,x.observedAtMs].every(Number.isSafeInteger)||x.fromMs>=x.toMs||x.assurance==='observed'&&x.observedAtMs>=x.fromMs)throw new Error('contest_membership_noncausal');
}

/** Each bounded P4-format financial batch has one explicit cost/funding scenario. */
export function contestScenarioSpec(m:CapitalContestManifestV1,variantId:string){
 const variant=m.scenarios.find(v=>v.id===variantId);if(!variant)throw new Error('contest_scenario_missing');
 return {...m.replay,variants:[variant],cells:(['policy','cash','hold','passive','reinvest'] as const).flatMap(arm=>CAPITAL_REPLAY_GRID.map(capitalUsd=>({id:`${variantId}:${arm}:${capitalUsd}`,capitalUsd,variantId,arm})))};
}

export function contestWorkload(m:CapitalContestManifestV1){
 validateCapitalContest(m);const financialCellReplays=m.trials.length*(m.inference.resamples+1),days=(m.replay.toMs-m.replay.fromMs)/DAY;
 return {baseCells:m.trials.length,paths:m.inference.resamples,financialCellReplays,financialDayReplays:financialCellReplays*days,maximumActiveCellsPerBatch:256,detailedBatchLimitBytes:64*1024*1024,declaredDiskBudgetBytes:m.resources.maxOutputBytes,minimumMetricStorageBytes:financialCellReplays*256,warning:'Counts are workload estimates, not an ETA or a promise that this hardware can finish the job.'};
}
