import {capitalHash,prospectivePaperConfiguration,type ProspectivePaperConfiguration,prospectiveStrategyId,prospectiveCoverage,PROSPECTIVE_VERSION,type QualifiedPaperEvidenceV1,type ProfitabilityEvidenceBinding} from '@coqui/core';
import {listProspectiveInstances,prospectiveDecisions,readProspectiveReport,prospectiveCaptureMetadata} from './capital-prospective.js';
import {readBoundProfitabilityEvidence} from './bound-profitability.js';
import {loadTrialRegistry} from './trials.js';
import {trialRegistryHash,trialCountForSignificance} from '@coqui/core';
import type {Db} from '../sqlite/index.js';
/** Legacy forward-edge proof stays unchanged; new shadow proof has its own explicit execution identity. */
export function readApplicablePaperQualification(profileId:string,db:Db,context:Omit<ProfitabilityEvidenceBinding,'validFromMs'|'validUntilMs'>,nowMs:number,configuration?:ProspectivePaperConfiguration){
 const legacy=readBoundProfitabilityEvidence(profileId,db,context,nowMs);if(legacy)return legacy;
 if(!configuration||context.profileId!==profileId||!context.strategyId.startsWith(PROSPECTIVE_VERSION+':')||context.normalization!=='gross_pct_per_turnover'||context.horizonMs!==86_400_000)return null;
 for(const {registration:r,design:d,binding:b} of listProspectiveInstances(profileId,db,100)){
  if(d.trialHistory.state==='known-lower-bound'||nowMs>=d.endMs+d.gates.qualificationValidForMs||b.archived||r.originProfileId!==profileId||d.runtime.artifactHash!==context.codeRevision||d.protocol.nativeMode!=='observed'||d.gates.actionClass!=='modeled_friction_bearing')continue;
  if((['development','final'] as const).some(phase=>prospectiveCoverage(d,r.id,phase,prospectiveCaptureMetadata(r.id,phase,db),nowMs).reasonCodes.length))continue;
  const arm=d.arms.find(a=>prospectiveStrategyId(a)===context.strategyId&&a.selectable),base=d.costs.find(c=>c.multiplier===1);if(!arm||!base||capitalHash(base)!==context.costProfileHash||!(Number(d.capitalWeights[configuration.capitalUsd]??0)>0)||capitalHash(configuration)!==capitalHash(prospectivePaperConfiguration(d,arm,configuration.capitalUsd)))continue;
  const review=prospectiveDecisions(r.id,'review',db).at(-1);if(!review||!review.evidenceRefs.includes(`configurationHash:${capitalHash(configuration)}`)||review.outcome!=='accepted'||!review.reportId||prospectiveDecisions(r.id,'revoke',db).some(e=>e.atMs>=review.atMs))continue;
  const until=Number(review.evidenceRefs.find(e=>e.startsWith('validUntilMs:'))?.slice(13));if(!Number.isSafeInteger(until)||nowMs<review.atMs||nowMs>=until)continue;
  const report=readProspectiveReport(profileId,r.id,review.reportId,db);if(!report||report.phase!=='final'||report.status!=='passed'||!report.paperQualificationEligible||report.candidateId!==arm.id||report.sourceHashes.length===0)continue;
  if(report.trialRegistryHash!==trialRegistryHash(loadTrialRegistry(db)))continue;
  const gross=report.diagnostics[`${base.id}:grossEdgeLowerBoundPct`],net=report.diagnostics[`${base.id}:netEdgeLowerBoundPct`],count=trialCountForSignificance(loadTrialRegistry(db));
  if(gross==null||net==null||!Number.isFinite(gross)||!Number.isFinite(net)||gross<=0||net<=0||count===null||count>(report.diagnostics['trialCount']??-1))continue;
  const result:QualifiedPaperEvidenceV1={version:'qualified-paper-evidence-v1',profileId,strategyId:context.strategyId,codeRevision:context.codeRevision,costProfileHash:context.costProfileHash,horizonMs:context.horizonMs,normalization:context.normalization,validFromMs:review.atMs,validUntilMs:until,resultHash:report.id,sourceHashes:report.sourceHashes,integrityVerified:true,grossEdgeLowerBoundPct:gross,netEdgeLowerBoundPct:net,evidenceClass:'prospective_modeled_shadow',method:'next-daily-cut-forward-counterfactual-v1',registrationId:r.id,reviewId:review.id};return result;
 }
 return null;
}
