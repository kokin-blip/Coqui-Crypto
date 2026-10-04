import { evaluateIntegrityDevelopment, evaluateIntegrityFinal, integrityPlanHash, familyCandidates,
  costScenarioHash, type IntegrityStudyPlan, type IntegrityDevelopmentResult, type IntegrityFinalResult,
  type DecisionMarketDataset, type CanonicalJsonValue } from '@coqui/core';
import { appendIntegrityEvent, listIntegrityEvents, claimIntegrityHoldout, appendTrialRecord,
  inTransaction, loadTrialRegistry, type Db } from '@coqui/storage';

export interface ResearchRuntimeIdentity { readonly codeRevision: string; readonly sourceManifestHash: string; readonly lockfileHash: string }
function json(value: unknown): CanonicalJsonValue { return value as CanonicalJsonValue; }
export function registerIntegrityStudy(plan: IntegrityStudyPlan, db: Db): string {
  const hash = integrityPlanHash(plan);
  familyCandidates(plan);
  appendIntegrityEvent({ namespace: hash, kind: 'plan', key: 'registered',
    atMs: new Date(plan.registeredAt).valueOf(), body: json(plan) }, db);
  return hash;
}
export function requireIntegrityStudy(hash: string, db: Db): IntegrityStudyPlan {
  const stored = listIntegrityEvents(hash, 'plan', db)[0];
  if (!stored) throw new Error('Integrity plan not registered');
  const plan = stored.body as unknown as IntegrityStudyPlan;
  if (integrityPlanHash(plan) !== hash) throw new Error('Integrity plan identity mismatch');
  return plan;
}
function assertRuntime(plan: IntegrityStudyPlan, identity: ResearchRuntimeIdentity) {
  if (identity.codeRevision !== plan.codeRevision || identity.sourceManifestHash !== plan.sourceManifestHash ||
      identity.lockfileHash !== plan.lockfileHash) throw new Error('Research runtime identity mismatch');
}
export function runIntegrityDevelopment(hash: string, dataset: DecisionMarketDataset,
  identity: ResearchRuntimeIdentity, atMs: number, db: Db): IntegrityDevelopmentResult {
  const plan = requireIntegrityStudy(hash, db);
  assertRuntime(plan, identity);
  if (!Number.isSafeInteger(atMs) || atMs < new Date(plan.registeredAt).valueOf() || atMs >= plan.validation.holdout.startMs) {
    throw new Error('Development cannot run after holdout begins');
  }
  const prior = listIntegrityEvents(hash, 'development_result', db)[0];
  if (prior) return prior.body as unknown as IntegrityDevelopmentResult;
  inTransaction(db, () => {
    if (listIntegrityEvents(hash, 'development_attempt', db).length > 0) throw new Error('Development attempt already reserved');
    appendTrialRecord({ id: `integrity:${hash}`, family: plan.family, searchKind: 'grid', evidenceStatus: 'verified',
      parameterSpace: plan.parameterSpace, trialCount: plan.candidateCount, searchedAt: new Date(atMs).toISOString(),
      datasetHash: plan.developmentDatasetHash, costProfileHash: costScenarioHash(plan.scenarios.find((s) => s.scenario === 'conservative')!),
      codeRevision: plan.codeRevision, producedDefaults: {}, studyRef: plan.studyRef }, db);
    appendIntegrityEvent({ namespace: hash, kind: 'development_attempt', key: 'once', atMs,
      body: { candidateCount: plan.candidateCount } }, db);
  });
  try {
    const result = evaluateIntegrityDevelopment(plan, dataset);
    appendIntegrityEvent({ namespace: hash, kind: 'development_result', key: 'once', atMs, body: json(result) }, db);
    return result;
  } catch (error) {
    appendIntegrityEvent({ namespace: hash, kind: 'development_failure', key: 'once', atMs,
      body: { reason: 'development_evaluation_failed' } }, db);
    throw error;
  }
}
export function freezeIntegrityCandidate(hash: string, candidateId: string | null, atMs: number, db: Db): string {
  const plan = requireIntegrityStudy(hash, db);
  const stored = listIntegrityEvents(hash, 'development_result', db)[0];
  if (!stored || !Number.isSafeInteger(atMs) || atMs < stored.atMs || atMs >= plan.validation.holdout.startMs) throw new Error('Candidate must freeze before holdout begins');
  const result = stored.body as unknown as IntegrityDevelopmentResult;
  if (candidateId !== null && candidateId !== result.selectedCandidate.id) throw new Error('Candidate differs from development selection');
  return appendIntegrityEvent({ namespace: hash, kind: 'freeze', key: 'once', atMs,
    body: { candidateId, developmentHash: stored.hash } }, db);
}
export async function runIntegrityFinal(hash: string, identity: ResearchRuntimeIdentity, atMs: number,
  loadHoldout: () => Promise<DecisionMarketDataset>, db: Db): Promise<IntegrityFinalResult | null> {
  const plan = requireIntegrityStudy(hash, db);
  assertRuntime(plan, identity);
  const stored = listIntegrityEvents(hash, 'final_result', db)[0];
  if (stored) return stored.body as unknown as IntegrityFinalResult;
  const frozen = listIntegrityEvents(hash, 'freeze', db)[0];
  const development = listIntegrityEvents(hash, 'development_result', db)[0];
  if (!frozen || !development) throw new Error('A frozen development result is required');
  const freeze = frozen.body as { candidateId: string | null; developmentHash: string };
  if (freeze.developmentHash !== development.hash) throw new Error('Frozen development hash mismatch');
  if (freeze.candidateId === null) return null;
  if (!Number.isSafeInteger(atMs) || atMs < plan.validation.holdout.endExclusiveMs || atMs < frozen.atMs) throw new Error('Holdout is not complete');
  claimIntegrityHoldout({ planHash: hash, startMs: plan.validation.holdout.startMs,
    endExclusiveMs: plan.validation.holdout.endExclusiveMs, assets: plan.universe.assets,
    dataLineage: plan.dataLineage, freezeHash: frozen.hash, atMs }, db);
  try {
    // No holdout read occurs before the durable, overlap-checked claim.
    const dataset = await loadHoldout();
    const result = evaluateIntegrityFinal(plan, development.body as unknown as IntegrityDevelopmentResult,
      dataset, loadTrialRegistry(db));
    if (result.candidateId !== freeze.candidateId) throw new Error('Frozen candidate identity mismatch');
    appendIntegrityEvent({ namespace: hash, kind: 'final_result', key: 'once', atMs, body: json(result) }, db);
    return result;
  } catch (error) {
    appendIntegrityEvent({ namespace: hash, kind: 'final_failure', key: 'once', atMs,
      body: { reason: 'final_evaluation_failed_holdout_consumed' } }, db);
    throw error;
  }
}
