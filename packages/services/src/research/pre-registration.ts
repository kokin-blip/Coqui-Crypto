import {
  canonicalResearchPreRegistration,
  researchPreRegistrationHash,
  type ResearchPreRegistration,
} from '@coqui/core';
import {
  findResearchPreRegistrationByHash,
  listResearchPreRegistrations,
  saveResearchPreRegistration,
  type Db,
  type StoredResearchPreRegistration,
} from '@coqui/storage';

/** Freeze a complete study design before any candidate or holdout result is inspected. */
export function registerResearchPreRegistration(
  plan: ResearchPreRegistration,
  database: Db,
): string {
  const planJson = canonicalResearchPreRegistration(plan);
  const planHash = researchPreRegistrationHash(plan);
  saveResearchPreRegistration({
    id: plan.id,
    registeredAt: plan.registeredAt,
    family: plan.family,
    candidateCount: plan.candidateCount,
    datasetHash: plan.datasetHash,
    costProfileHash: plan.costProfileHash,
    codeRevision: plan.codeRevision,
    planJson,
    planHash,
  }, database);
  return planHash;
}

function verifiedStoredPlan(stored: StoredResearchPreRegistration): ResearchPreRegistration {
  const plan = JSON.parse(stored.planJson) as ResearchPreRegistration;
  if (researchPreRegistrationHash(plan) !== stored.planHash ||
      plan.id !== stored.id || plan.registeredAt !== stored.registeredAt ||
      plan.family !== stored.family || plan.candidateCount !== stored.candidateCount ||
      plan.datasetHash !== stored.datasetHash || plan.costProfileHash !== stored.costProfileHash ||
      plan.codeRevision !== stored.codeRevision) {
    throw new Error('Stored research pre-registration failed integrity validation.');
  }
  return Object.freeze(plan);
}

export function requireResearchPreRegistration(
  planHash: string,
  database: Db,
): ResearchPreRegistration {
  const stored = findResearchPreRegistrationByHash(planHash, database);
  if (stored === null) throw new Error('Research evidence requires a registered plan.');
  return verifiedStoredPlan(stored);
}

export function verifiedResearchPreRegistrations(
  database: Db,
): readonly ResearchPreRegistration[] {
  return Object.freeze(listResearchPreRegistrations(database)
    .map(verifiedStoredPlan));
}
