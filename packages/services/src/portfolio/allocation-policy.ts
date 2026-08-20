import {
  validateAllocationPolicy,
  type AllocationPolicy,
  type AllocationPolicyValidationResult,
} from '@coqui/core';
import {
  clearAllocationPolicy,
  DEFAULT_REBALANCE_BAND_PCT,
  saveAllocationPolicy,
  type Db,
} from '@coqui/storage';
import { freezeValue } from './immutable.js';

export interface PortfolioAllocationPolicyDependencies {
  readonly database: Db;
}

export type SavePortfolioAllocationPolicyResult = AllocationPolicyValidationResult;

export interface ClearPortfolioAllocationPolicyResult {
  readonly ok: true;
  readonly policy: AllocationPolicy;
}

/** Atomic user-owned allocation configuration; it never derives strategy targets. */
export class PortfolioAllocationPolicyService {
  readonly #database: Db;

  constructor(dependencies: PortfolioAllocationPolicyDependencies) {
    this.#database = dependencies.database;
  }

  savePolicy(policy: AllocationPolicy): SavePortfolioAllocationPolicyResult {
    const validated = validateAllocationPolicy(policy);
    if (!validated.ok) return validated;
    saveAllocationPolicy(validated.policy, this.#database);
    return validated;
  }

  clearPolicy(): ClearPortfolioAllocationPolicyResult {
    clearAllocationPolicy(this.#database);
    return freezeValue({
      ok: true as const,
      policy: {
        targets: [],
        rebalanceBandPct: DEFAULT_REBALANCE_BAND_PCT,
      },
    });
  }
}
