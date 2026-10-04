import { evaluateOverlayDevelopment, evaluateOverlayFinal, freezeOverlayArtifacts, overlayPlanHash, overlayHash,
  overlayCandidates, costScenarioHash, type OverlayStudyPlan, type OverlayDevelopment, type OverlayFreeze,
  type OverlayFinalResult, type DecisionMarketDataset, type LiquidityObservation, type CanonicalJsonValue } from '@coqui/core';
import { appendIntegrityEvent, listIntegrityEvents, claimIntegrityHoldout, appendTrialRecord,
  inTransaction, loadTrialRegistry, type Db } from '@coqui/storage';
import type { ResearchRuntimeIdentity } from './integrity-study.js';
const json = (value: unknown) => value as CanonicalJsonValue;
export function registerOverlayStudy(plan: OverlayStudyPlan, db: Db): string {
  const hash = overlayPlanHash(plan);
  appendIntegrityEvent({ namespace: hash, kind: 'overlay_plan', key: 'registered', atMs: Date.parse(plan.registeredAt), body: json(plan) }, db);
  return hash;
}
export function requireOverlayStudy(hash: string, db: Db): OverlayStudyPlan {
  const event = listIntegrityEvents(hash, 'overlay_plan', db)[0];
  if (!event || overlayPlanHash(event.body as unknown as OverlayStudyPlan) !== hash) throw new Error('overlay_plan_not_registered');
  return event.body as unknown as OverlayStudyPlan;
}
function runtime(plan: OverlayStudyPlan, identity: ResearchRuntimeIdentity) {
  if (plan.codeRevision !== identity.codeRevision || plan.sourceManifestHash !== identity.sourceManifestHash || plan.lockfileHash !== identity.lockfileHash)
    throw new Error('overlay_runtime_mismatch');
}
export function runOverlayDevelopment(hash: string, dataset: DecisionMarketDataset, identity: ResearchRuntimeIdentity,
  atMs: number, db: Db, liquidity: readonly LiquidityObservation[] = []): OverlayDevelopment {
  const plan = requireOverlayStudy(hash, db); runtime(plan, identity);
  if (!Number.isSafeInteger(atMs) || atMs < Date.parse(plan.registeredAt) || atMs >= plan.validation.holdout.startMs) throw new Error('overlay_development_time');
  const prior = listIntegrityEvents(hash, 'overlay_development', db)[0]; if (prior) return prior.body as unknown as OverlayDevelopment;
  inTransaction(db, () => {
    if (listIntegrityEvents(hash, 'overlay_attempt', db).length) throw new Error('overlay_attempt_reserved');
    appendTrialRecord({ id: `overlay:${hash}`, family: 'trendvol', searchKind: 'grid', evidenceStatus: 'verified',
      parameterSpace: plan.parameterSpace, trialCount: overlayCandidates().length, searchedAt: new Date(atMs).toISOString(),
      datasetHash: plan.developmentDatasetHash, costProfileHash: costScenarioHash(plan.scenarios.find((s) => s.scenario === 'conservative')!),
      codeRevision: plan.codeRevision, producedDefaults: {}, studyRef: plan.studyRef }, db);
    appendIntegrityEvent({ namespace: hash, kind: 'overlay_attempt', key: 'once', atMs,
      body: { candidateCount: overlayCandidates().length, liquidityHash: overlayHash(liquidity) } }, db);
  });
  try {
    const result = evaluateOverlayDevelopment(plan, dataset, liquidity);
    appendIntegrityEvent({ namespace: hash, kind: 'overlay_development', key: 'once', atMs, body: json(result) }, db); return result;
  } catch (error) {
    appendIntegrityEvent({ namespace: hash, kind: 'overlay_failure', key: 'development', atMs, body: { reason: 'failed_trials_retained' } }, db); throw error;
  }
}
export function freezeOverlayStudy(hash: string, dataset: DecisionMarketDataset, atMs: number, db: Db,
  liquidity: readonly LiquidityObservation[] = []): OverlayFreeze {
  const plan = requireOverlayStudy(hash, db), development = listIntegrityEvents(hash, 'overlay_development', db)[0];
  const attempt = listIntegrityEvents(hash, 'overlay_attempt', db)[0];
  if (!development || atMs < development.atMs || atMs >= plan.validation.holdout.startMs ||
    (attempt?.body as { liquidityHash: string }).liquidityHash !== overlayHash(liquidity)) throw new Error('overlay_freeze_preconditions');
  const frozen = freezeOverlayArtifacts(plan, development.body as unknown as OverlayDevelopment, dataset, liquidity);
  appendIntegrityEvent({ namespace: hash, kind: 'overlay_freeze', key: 'once', atMs, body: json(frozen) }, db); return frozen;
}
export async function runOverlayFinal(hash: string, identity: ResearchRuntimeIdentity, atMs: number,
  loadHoldout: () => Promise<DecisionMarketDataset | { dataset: DecisionMarketDataset; liquidity: readonly LiquidityObservation[] }>, db: Db, liquidity: readonly LiquidityObservation[] = []): Promise<OverlayFinalResult | null> {
  const plan = requireOverlayStudy(hash, db); runtime(plan, identity);
  const prior = listIntegrityEvents(hash, 'overlay_final', db)[0]; if (prior) return prior.body as unknown as OverlayFinalResult;
  const freeze = listIntegrityEvents(hash, 'overlay_freeze', db)[0], development = listIntegrityEvents(hash, 'overlay_development', db)[0];
  if (!freeze || !development || atMs < plan.validation.holdout.endExclusiveMs) throw new Error('overlay_final_preconditions');
  const frozen = freeze.body as unknown as OverlayFreeze;
  if (frozen.developmentHash !== overlayHash(development.body)) throw new Error('overlay_freeze_mismatch');
  if (!frozen.selected.length) return null;
  claimIntegrityHoldout({ planHash: hash, startMs: plan.validation.holdout.startMs, endExclusiveMs: plan.validation.holdout.endExclusiveMs,
    assets: plan.universe.assets, dataLineage: plan.dataLineage, freezeHash: freeze.hash, atMs }, db);
  try {
    const loaded = await loadHoldout();
    const dataset = 'dataset' in loaded ? loaded.dataset : loaded;
    const finalLiquidity = 'dataset' in loaded ? loaded.liquidity : liquidity;
    const result = evaluateOverlayFinal(plan, development.body as unknown as OverlayDevelopment, frozen, dataset, loadTrialRegistry(db), finalLiquidity);
    appendIntegrityEvent({ namespace: hash, kind: 'overlay_final', key: 'once', atMs, body: json(result) }, db); return result;
  } catch (error) {
    appendIntegrityEvent({ namespace: hash, kind: 'overlay_failure', key: 'final', atMs, body: { reason: 'failed_holdout_consumed' } }, db); throw error;
  }
}
