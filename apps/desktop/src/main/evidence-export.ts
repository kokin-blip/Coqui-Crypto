import { newsEvidenceHash, sha256Hex } from '@coqui/core';
import { getStrategyDecision, listDecisionEvidenceEvents, latestAssociatedNewsReport, type Db } from '@coqui/storage';
import { readBuildIdentity } from './build-identity.js';
/** Explicit allowlist: never include article text, account identifiers, paths, raw DBs or sealed outcomes. */
export function buildEvidenceBundle(profileId: string, atMs: number, database: Db) {
  const associated = latestAssociatedNewsReport(profileId,atMs,database);
  const build = readBuildIdentity();
  const rows=database.prepare('SELECT decision_id FROM strategy_decisions_v1 WHERE profile_id=? AND created_at<=? ORDER BY created_at DESC LIMIT 20').all(profileId,atMs) as {decision_id:string}[];
  const decisions=rows.map(row=>{
    const stored=getStrategyDecision(row.decision_id,database);
    if(!stored || stored.decision.profileId!==profileId)throw new Error('export_decision_integrity');
    const count=database.prepare('SELECT count(*) AS n FROM decision_evidence_events_v1 WHERE decision_id=? AND profile_id=?').get(row.decision_id,profileId)!['n'];
    if(typeof count!=='number'||count>100)throw new Error('export_event_bound');
    return {originalHash:stored.contentHash,atMs:stored.decision.createdAtMs,
      outcomes:listDecisionEvidenceEvents(row.decision_id,profileId,database).filter(e=>e.atMs<=atMs).map(e=>({originalHash:sha256Hex(JSON.stringify(e)),kind:e.kind,atMs:e.atMs}))};
  });
  const body = { version:'redacted-evidence-bundle-v1', generatedAtMs:atMs,
    environment:build, schemaVersion:database.prepare('PRAGMA user_version').get()!['user_version'],
    profileKind:profileId==='main'?'main':'secondary', simulated:false,
    newsReport: associated.report ? { originalHash:associated.report.reportHash,
      completedAtMs:associated.report.completedAtMs, horizons:associated.report.horizons.map(h=>({
        cadence:h.cadence,horizonHours:h.horizonHours,status:h.status,prospectiveRows:h.prospectiveRows,
        manifestHash:h.manifestHash,datasetHash:h.datasetHash,costHash:h.costHash,sourceManifestHashes:h.sourceManifestHashes,
        sourceRevision:/^[a-f0-9]{40}$/u.test(h.codeRevision)?h.codeRevision:null,
        reasons:h.reasons.filter(r=>/^[a-z0-9_]{1,100}$/u.test(r)) })) } : null,
    association:associated.association, rights:'generated_operational_summary_only',
    decisions,decisionScope:'latest_20_in_selected_profile; at_most_100_events_each; sanitized_identity_and_time_only',
    omittedFields:['profile identity','local paths','account/broker identifiers','credentials','news title/snippet/body/URL','raw report/model evidence','sealed holdout performance','raw databases','unsupplied artifacts'],
    openGates:['G01','G02','G03','G04','G05','G06','G07','G08','G09'],
    exclusions:['does not certify broker/provider operation','does not certify actual-profile restore','does not establish review/merge/publication'] };
  return { ...body, sanitizedDerivativeHash:newsEvidenceHash(body) };
}
