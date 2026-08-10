import {
  researchPreRegistrationHash,
  runNestedChronologicalStudy,
  tradeCostConfigHash,
  type DecisionMarketDataset,
  type NestedChronologicalStudyResult,
  type TradeCostConfig,
} from '@coqui/core';
import {
  appendTrialRecord,
  canonicalStudyResult,
  inTransaction,
  loadTrialRegistry,
  researchStudyRunHash,
  saveResearchStudyRun,
  type Db,
} from '@coqui/storage';
import { requireResearchPreRegistration } from './pre-registration.js';

export interface RegisteredNestedStudyInput {
  readonly preRegistrationHash: string;
  readonly dataset: DecisionMarketDataset;
  readonly tradeCosts: TradeCostConfig;
  readonly codeRevision: string;
  readonly completedAtMs: number;
}

/** Execute the frozen grid and append its full search budget, regardless of outcome. */
export function runRegisteredNestedStudy(
  input: RegisteredNestedStudyInput,
  database: Db,
): NestedChronologicalStudyResult {
  const plan = requireResearchPreRegistration(input.preRegistrationHash, database);
  if (researchPreRegistrationHash(plan) !== input.preRegistrationHash) {
    throw new Error('Research plan hash changed before execution.');
  }
  if (input.dataset.report.datasetHash !== plan.datasetHash) {
    throw new Error('Research dataset does not match its pre-registration.');
  }
  if (tradeCostConfigHash(input.tradeCosts) !== plan.costProfileHash) {
    throw new Error('Research costs do not match their pre-registration.');
  }
  if (input.codeRevision !== plan.codeRevision) {
    throw new Error('Research code revision does not match its pre-registration.');
  }
  if (!Number.isSafeInteger(input.completedAtMs) ||
      input.completedAtMs < new Date(plan.registeredAt).valueOf()) {
    throw new TypeError('Research completion must be a safe timestamp after registration.');
  }
  const registryBeforeRun = loadTrialRegistry(database);
  if (registryBeforeRun.records.some((record) => record.id === `pre-registration:${plan.id}`)) {
    throw new Error('This pre-registered study has already been executed.');
  }
  const result = runNestedChronologicalStudy(
    plan,
    input.dataset,
    input.tradeCosts,
    registryBeforeRun,
  );
  const resultJson = canonicalStudyResult(result);
  const runWithoutHash = {
    id: `study-run:${plan.id}`,
    preRegistrationHash: input.preRegistrationHash,
    completedAtMs: input.completedAtMs,
    datasetHash: plan.datasetHash,
    costProfileHash: plan.costProfileHash,
    codeRevision: plan.codeRevision,
    selectedCandidateId: result.selectedCandidate.id,
    adopted: result.holdout.adopted,
    resultJson,
  };
  inTransaction(database, () => {
    appendTrialRecord({
      id: `pre-registration:${plan.id}`,
      family: plan.family,
      searchKind: 'grid',
      evidenceStatus: 'verified',
      parameterSpace: plan.parameterSpace,
      trialCount: plan.candidateCount,
      searchedAt: new Date(input.completedAtMs).toISOString(),
      datasetHash: plan.datasetHash,
      costProfileHash: plan.costProfileHash,
      codeRevision: plan.codeRevision,
      producedDefaults: result.selectedCandidate.parameters,
      studyRef: plan.studyRef,
    }, database);
    saveResearchStudyRun({
      ...runWithoutHash,
      runHash: researchStudyRunHash(runWithoutHash),
    }, database);
  });
  return result;
}
