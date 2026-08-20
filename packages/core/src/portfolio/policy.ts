import {
  instrumentKey,
  type AllocationPolicy,
  type AllocationTarget,
} from '../types/index.js';

const WEIGHT_SUM_TOLERANCE = 1e-9;

export type AllocationPolicyIssueCode =
  | 'targets_required'
  | 'invalid_instrument'
  | 'duplicate_instrument'
  | 'invalid_weight'
  | 'weight_sum_not_one'
  | 'invalid_rebalance_band';

/** Secret-safe, path-addressable configuration violation. */
export interface AllocationPolicyIssue {
  readonly code: AllocationPolicyIssueCode;
  readonly path: string;
}

export type AllocationPolicyValidationResult =
  | { readonly ok: true; readonly policy: AllocationPolicy }
  | { readonly ok: false; readonly issues: readonly AllocationPolicyIssue[] };

class AllocationPolicyIssueCollector {
  readonly #issues: AllocationPolicyIssue[] = [];

  get hasIssues(): boolean {
    return this.#issues.length > 0;
  }

  add(code: AllocationPolicyIssueCode, path: string): void {
    this.#issues.push(Object.freeze({ code, path }));
  }

  finish(policy: AllocationPolicy): AllocationPolicyValidationResult {
    if (this.#issues.length > 0) {
      return Object.freeze({ ok: false, issues: Object.freeze([...this.#issues]) });
    }
    return Object.freeze({ ok: true, policy });
  }
}

function validOperationalTarget(target: AllocationTarget): string | null {
  try {
    const key = instrumentKey(target.instrument);
    return target.instrument.venue === 'coinbase' &&
      target.instrument.productType === 'spot'
      ? key
      : null;
  } catch {
    return null;
  }
}

function frozenPolicy(targets: readonly AllocationTarget[], rebalanceBandPct: number): AllocationPolicy {
  return Object.freeze({
    targets: Object.freeze(targets.map((target) => Object.freeze({
      instrument: Object.freeze({ ...target.instrument }),
      weight: target.weight,
    }))),
    rebalanceBandPct,
  });
}

/** Validate every allocation invariant before returning a canonical immutable policy. */
export function validateAllocationPolicy(
  policy: AllocationPolicy,
): AllocationPolicyValidationResult {
  const issues = new AllocationPolicyIssueCollector();
  const keys = new Set<string>();
  let weightSum = 0;

  if (policy.targets.length === 0) issues.add('targets_required', 'targets');

  for (let index = 0; index < policy.targets.length; index += 1) {
    const target = policy.targets[index]!;
    const key = validOperationalTarget(target);
    if (key === null) {
      issues.add('invalid_instrument', `targets[${index}].instrument`);
    } else if (keys.has(key)) {
      issues.add('duplicate_instrument', `targets[${index}].instrument`);
    } else {
      keys.add(key);
    }

    if (!Number.isFinite(target.weight) || target.weight <= 0 || target.weight > 1) {
      issues.add('invalid_weight', `targets[${index}].weight`);
    } else {
      weightSum += target.weight;
    }
  }

  if (
    policy.targets.length > 0 &&
    Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE
  ) issues.add('weight_sum_not_one', 'targets');

  if (
    !Number.isFinite(policy.rebalanceBandPct) ||
    policy.rebalanceBandPct <= 0 ||
    policy.rebalanceBandPct > 100
  ) issues.add('invalid_rebalance_band', 'rebalanceBandPct');

  if (issues.hasIssues) return issues.finish(policy);

  const canonical = frozenPolicy(
    [...policy.targets].sort((left, right) =>
      instrumentKey(left.instrument).localeCompare(instrumentKey(right.instrument)),
    ),
    policy.rebalanceBandPct,
  );
  return issues.finish(canonical);
}
