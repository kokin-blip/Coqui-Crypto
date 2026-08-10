import {
  sha256Hex,
  tradeCostConfigHash,
  trialRegistryHash,
  totalRegisteredTrialCount,
  type JsonValue,
  type TradeCostConfig,
} from '@coqui/core';
import {
  listResearchEvidenceSnapshots,
  loadTrialRegistry,
  saveResearchEvidenceSnapshot,
  type Db,
  type StoredResearchEvidenceSnapshot,
} from '@coqui/storage';
import { requireResearchPreRegistration } from './pre-registration.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface ResearchEvidenceInput {
  readonly id: string;
  readonly createdAtMs: number;
  readonly datasetHash: string;
  readonly codeRevision: string;
  readonly preRegistrationHash: string;
  readonly tradeCosts: TradeCostConfig;
  readonly result: JsonValue;
}

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
}

function snapshotHash(snapshot: Omit<StoredResearchEvidenceSnapshot, 'snapshotHash'>): string {
  return sha256Hex(JSON.stringify(snapshot));
}

/** Persist evidence only after trial-history completeness and cost provenance pass. */
export function createResearchEvidenceSnapshot(
  input: ResearchEvidenceInput,
  database: Db,
): StoredResearchEvidenceSnapshot {
  if (input.id.length === 0 || input.id.length > 200) throw new TypeError('Invalid evidence id.');
  if (!Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0) {
    throw new TypeError('createdAtMs must be a non-negative safe integer.');
  }
  if (!HASH_PATTERN.test(input.datasetHash)) throw new TypeError('Invalid evidence dataset hash.');
  if (input.codeRevision.length === 0 || input.codeRevision.length > 200) {
    throw new TypeError('Evidence requires an explicit code revision.');
  }
  const registeredPlan = requireResearchPreRegistration(input.preRegistrationHash, database);
  if (input.createdAtMs < new Date(registeredPlan.registeredAt).valueOf()) {
    throw new Error('Research evidence cannot predate its pre-registration.');
  }
  const suppliedCostHash = tradeCostConfigHash(input.tradeCosts);
  if (registeredPlan.datasetHash !== input.datasetHash ||
      registeredPlan.costProfileHash !== suppliedCostHash ||
      registeredPlan.codeRevision !== input.codeRevision) {
    throw new Error('Research evidence does not match its pre-registered dataset, costs, and code.');
  }
  const registry = loadTrialRegistry(database);
  if (registry.completeness !== 'complete') {
    throw new Error('Research evidence is blocked until the historical trial audit is complete.');
  }
  if (totalRegisteredTrialCount(registry) === 0) {
    throw new Error('Research evidence requires at least one registered trial.');
  }
  const resultJson = JSON.stringify(canonical(input.result));
  const withoutHash = {
    id: input.id,
    createdAtMs: input.createdAtMs,
    datasetHash: input.datasetHash,
    trialRegistryHash: trialRegistryHash(registry),
    costProfileHash: suppliedCostHash,
    codeRevision: input.codeRevision,
    preRegistrationHash: input.preRegistrationHash,
    resultJson,
  };
  const snapshot = Object.freeze({ ...withoutHash, snapshotHash: snapshotHash(withoutHash) });
  saveResearchEvidenceSnapshot(snapshot, database);
  return snapshot;
}

/** Load snapshots and fail closed if stored evidence bytes no longer match. */
export function verifiedResearchEvidenceSnapshots(
  database: Db,
): readonly StoredResearchEvidenceSnapshot[] {
  return Object.freeze(listResearchEvidenceSnapshots(database).map((snapshot) => {
    const { snapshotHash: storedHash, ...withoutHash } = snapshot;
    if (snapshotHash(withoutHash) !== storedHash) {
      throw new Error('Stored research evidence failed integrity validation.');
    }
    return Object.freeze(snapshot);
  }));
}
