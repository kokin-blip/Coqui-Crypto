import {prospectiveStrategyHash} from './paper-qualification.js';
import {capitalHash} from '../portfolio/capital-ledger.js';
import {budgetAmount as a} from '../execution/native-rules.js';
import {CAPITAL_REPLAY_GRID} from './capital-replay-types.js';
import {PROSPECTIVE_DAY as DAY,PROSPECTIVE_VERSION,type ProspectiveDesign,type ProspectiveRuntime,type ProspectiveFrame} from './capital-prospective-types.js';
const hash=(s:string)=>/^[a-f0-9]{64}$/u.test(s),at=(n:number)=>Number.isSafeInteger(n)&&n>=0;
export function validateProspectiveDesign(d:ProspectiveDesign):string {
 const fail=()=>{throw new Error('prospective_design_invalid');};
 const {id,...body}=d;if(capitalHash(body)!==id||d.version!==PROSPECTIVE_VERSION||!d.originProfileId||!d.workspaceId||!d.developmentEvidenceRef||d.liveExecutionPermitted||d.withdrawalPermitted||d.orderSubmissionPermitted)fail();
 const dates=[d.startMs,...d.foldEndsMs,d.finalStartMs,d.endMs];if(d.stepMs!==DAY||!d.foldEndsMs.length||d.developmentEndMs!==d.foldEndsMs.at(-1)||d.developmentEndMs>=d.finalStartMs||dates.some((n,i)=>!at(n)||n%DAY!==0||i>0&&n<=dates[i-1]!)||d.startMs>=d.developmentEndMs||d.finalStartMs>=d.endMs)fail();
 if(d.environment!==(d.provider==='alpaca'?'paper':'production_read_only'))fail();
 if(!d.assets.length||d.assets.length>10||new Set(d.assets).size!==d.assets.length||d.assets.some(s=>!s.startsWith(d.provider+'|spot|')||d.instrumentAliases[s]!==`asset:${s.split('|')[2]?.replace('-', '/')}`)||new Set(Object.values(d.instrumentAliases)).size!==d.assets.length)fail();
 if(!Object.values(d.runtime).every(s=>typeof s==='string'&&s.length>0)||![d.runtime.behaviorHash,d.runtime.artifactHash,d.runtime.lockfileHash,d.runtime.sourceManifestHash,d.protocol.hash,d.trialHistory.registryHash].every(hash))fail();
 if(!d.protocol.rightsRef||!d.protocol.warmupExposureRef||!at(d.protocol.completionDelayMs)||!at(d.protocol.latenessMs)||d.protocol.latenessMs>=DAY||d.protocol.completionDelayMs>d.protocol.latenessMs||d.protocol.historyDays<2||d.protocol.historyDays>1000)fail();
 if(d.openings.length!==9||CAPITAL_REPLAY_GRID.some(v=>d.openings.filter(o=>o.capitalUsd===v).length!==1))fail();
 for(const o of d.openings)if(a(o.cashUsd).lt(0)||o.assets.some(p=>!d.assets.includes(p.assetId)||a(p.quantity).lt(0))||a(o.cashUsd).gt(o.capitalUsd))fail();
 if(!d.arms.length||d.arms.length>16||new Set(d.arms.map(c=>c.id)).size!==d.arms.length||d.arms.some(c=>c.strategyHash!==prospectiveStrategyHash(c)||c.signal.id!==c.id||c.signal.cadenceDays<1||Math.max(c.signal.lookbackDays+1,c.signal.volatilityDays+1)>d.protocol.historyDays||c.signal.decisionDelayMs<0||c.signal.family==='rotation'&&c.signal.buffer>=d.assets.length||c.reserve.taxHold.backing==='unknown'))fail();
 if(!d.arms.some(c=>c.signal.family==='cash')||!d.arms.some(c=>c.signal.family==='passive')||!d.arms.some(c=>c.signal.family==='exposure')||d.arms.filter(c=>c.selectable).some(c=>c.group!=='signal'))fail();
 for(const c of d.arms){if((c.group==='reserve'||c.group==='execution')&&(!c.controlOf||!d.arms.some(a=>a.id===c.controlOf&&a.selectable)))fail();if(c.signal.family==='allocator'&&c.signal.momentum===null)fail();const weights=Object.entries(c.signal.baseWeights);if(weights.some(([k,v])=>!d.assets.includes(k)||a(v).lt(0))||weights.reduce((s,[,v])=>s.add(v),a('0')).gt(1)||a(c.executionBand).lt(0))fail();}
 if(!d.costs.length||d.costs.length>4||!d.costs.some(c=>c.multiplier===2)||!d.costs.some(c=>c.multiplier===1)||d.costs.some(c=>c.venue!==d.provider||!c.sourceRef||a(c.feeRate).lt(0)||a(c.feeRate).gte(1)||a(c.impactRefUsd).lte(0)))fail();
 if(d.flows.some(f=>!at(f.atMs)||f.atMs<d.startMs||f.atMs>=d.endMs)||Object.entries(d.capitalWeights).some(([k,v])=>!CAPITAL_REPLAY_GRID.includes(k as typeof CAPITAL_REPLAY_GRID[number])||a(v).lt(0))||!Object.values(d.capitalWeights).reduce((s,v)=>s.add(v),a('0')).eq(1))fail();
 const g=d.gates;if(!g.applicabilityRef||!g.powerReviewRef||g.historicalGateRefs.length===0||!g.parameterStabilityRef||g.minEffectiveBlocks<1||g.minPolicyTailReplications<1||!g.rollingDays.length||g.rollingDays.some(n=>!Number.isSafeInteger(n)||n<1)||g.minimumDays<1||g.minimumActions<0||g.maxPbo>0.05||g.maxPbo<=0||g.minDsr<0.95||g.minDsr>1||g.maxDrawdownPct>35||g.maxDrawdownPct<=0||!at(g.qualificationValidForMs)||g.qualificationValidForMs<1||g.qualificationValidForMs>30*DAY||g.horizonMs!==DAY||g.normalization!=='gross_pct_per_turnover'||g.partitions<4||g.partitions>16||g.partitions%2!==0||g.bootstrapResamples<100||g.bootstrapResamples>10000||g.blockDays<1)fail();
 if(g.historicalGateRefs.includes('forward-edge-365-30')&&(g.minimumDays<365||g.minimumActions<30||g.actionClass!=='actual_paper_settled'))fail();
 const days=(d.endMs-d.startMs)/DAY,selectable=d.arms.filter(a=>a.selectable).length,controls=d.arms.filter(a=>a.group==='control').length;
 if(selectable*d.costs.length*controls*g.bootstrapResamples*days>50_000_000)fail();
 const r=d.resources,cells=d.arms.length*d.openings.length*d.costs.length;if(!at(r.maxPolicyPaths)||r.maxPolicyPaths>1000||d.arms.some(a=>a.group==='reserve')&&r.maxPolicyPaths<100||!at(r.maxCells)||cells>r.maxCells||r.maxCells>576||r.maxCaptureBytes<1024||r.maxCaptureBytes>8*1024*1024||r.maxStoredBytes<r.maxCaptureBytes||r.maxStoredBytes>512*1024*1024||r.maxSlots<1||r.maxSlots>3660||(d.endMs-d.startMs)/DAY+1>r.maxSlots||r.deadlineMs<1||r.deadlineMs>120000)fail();
 return id;
}
export function prospectiveRuntimeMatches(a:ProspectiveRuntime,b:ProspectiveRuntime):boolean{return capitalHash(a)===capitalHash(b);}
export function prospectiveFrameReasons(d:ProspectiveDesign,f:ProspectiveFrame,nowMs:number):string[]{
 const reasons=[...f.reasonCodes];if(!f.complete)reasons.push('source_incomplete');
 if(f.provider!==d.provider||f.protocolHash!==d.protocol.hash||!hash(f.batchHash))reasons.push('source_protocol_mismatch');
 if(f.slotMs<d.startMs||f.slotMs>d.endMs||f.slotMs%DAY!==0||!at(f.observedAtMs)||!at(f.recordedAtMs)||f.observedAtMs<f.slotMs+d.protocol.completionDelayMs||f.availableAtMs>f.observedAtMs||f.recordedAtMs<f.observedAtMs||f.recordedAtMs>nowMs||nowMs<f.slotMs)reasons.push('capture_timing_invalid');
 if(f.observedAtMs>f.slotMs+d.protocol.latenessMs||f.recordedAtMs>f.slotMs+d.protocol.latenessMs)reasons.push('late_retrospective_capture');
 if(f.market.atMs<f.slotMs||f.market.atMs>f.observedAtMs||f.market.endMs!==f.slotMs+DAY)reasons.push('execution_time_invalid');
 if(f.history.length>d.protocol.historyDays||f.history.some((h,i)=>h.endMs>f.slotMs||h.observedAtMs>f.observedAtMs||h.observedAtMs<h.endMs||!hash(h.sourceHash)||i>0&&h.endMs!==f.history[i-1]!.endMs+DAY))reasons.push('causal_history_invalid');
 for(const id of d.assets){const m=f.market.assets[id],rule=f.rules[id];if(!m||m.openUsd===null||m.closeUsd===null||m.bidUsd===null||m.askUsd===null||m.quoteAtMs!==f.market.atMs||!rule||rule.assetId!==id||rule.provider!==d.provider||rule.environment!==d.environment||rule.observedAtMs>f.market.atMs||rule.expiresAtMs<=f.market.atMs)reasons.push('quote_native_or_valuation_missing');else{const {id:ruleId,...body}=rule;if(capitalHash(body)!==ruleId||!a(m.bidUsd).gt(0)||!a(m.askUsd).gte(m.bidUsd)||!a(m.closeUsd).gt(0)||f.history.at(-1)?.closes[id]!==m.closeUsd||d.protocol.nativeMode==='observed'&&rule.assurance!=='observed')reasons.push('quote_native_or_valuation_invalid');}}
 return [...new Set(reasons)].sort();
}
