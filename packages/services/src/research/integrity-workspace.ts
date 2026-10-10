import { costScenarioHash, integrityPlanHash, type IntegrityStudyPlan } from '@coqui/core';
import { listIntegrityEvents, type Db } from '@coqui/storage';
/** Read stage metadata only. Sealed final-performance bodies are never loaded for this dashboard. */
export function readIntegrityWorkspace(db: Db) {
  const count = db.prepare("SELECT count(*) AS n FROM research_integrity_events WHERE kind='plan'").get()!['n'];
  if (typeof count !== 'number' || count > 100) throw new Error('research_workspace_bound');
  return listIntegrityEvents(null,'plan',db).map(event => {
    const plan = event.body as unknown as IntegrityStudyPlan;
    if (integrityPlanHash(plan) !== event.namespace) throw new Error('research_plan_identity_mismatch');
    const stages = db.prepare('SELECT kind,count(*) AS count,max(at_ms) AS last_at FROM research_integrity_events WHERE namespace=? GROUP BY kind')
      .all(event.namespace) as { kind:string; count:number; last_at:number }[];
    const frozen = listIntegrityEvents(event.namespace,'freeze',db)[0];
    const body = frozen?.body as { candidateId:string|null; developmentHash:string } | undefined;
    if (frozen && (!body || body.candidateId !== null && !/^[a-f0-9]{64}$/u.test(body.candidateId) ||
        !listIntegrityEvents(event.namespace,'development_result',db).some(e=>e.hash===body.developmentHash))) throw new Error('research_freeze_identity_mismatch');
    return { planHash:event.namespace, planEventHash:event.hash, family:plan.family, codeRevision:plan.codeRevision,
      sourceManifestHash:plan.sourceManifestHash, lockfileHash:plan.lockfileHash, datasetHash:plan.developmentDatasetHash,
      dataLineage:plan.dataLineage, engineVersion:plan.engineVersion, candidateCount:plan.candidateCount,
      costHashes:plan.scenarios.map(costScenarioHash), freezeHash:frozen?.hash ?? null,
      candidateState:!frozen?'not_frozen':body?.candidateId===null?'none':'frozen', candidateId:body?.candidateId ?? null,
      holdoutState:stages.some(s=>s.kind==='final_claim')?'consumed':'no_claim_in_this_namespace',
      developmentState:stages.some(s=>s.kind==='development_failure')?'failed':stages.some(s=>s.kind==='development_result')?'recorded':stages.some(s=>s.kind==='development_attempt')?'attempted':'not_run',
      qualification:'requires_current_runtime_and_data_verification', prospectiveEnrollment:'not_verified',
      stages:stages.map(s=>({kind:s.kind,count:s.count,lastAtMs:s.last_at})),
      gates:['G03 compatible executable/data/cost identity','G04 freeze and holdout exposure','G05 approved elapsed prospective coverage'] };
  });
}
