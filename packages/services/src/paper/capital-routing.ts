import { budgetAmount, budgetText, capitalHash, instrumentKey, type BudgetReportV1, type ExecutionRouteCandidateV1 } from '@coqui/core';

export function capitalRouteAssumption(original: string, budget: BudgetReportV1): string {
  return capitalHash({ version: 'capital-route-v1', original, scopeId: budget.scopeId, revision: budget.revision, expiresAtMs: budget.expiresAtMs });
}
/** One account ceiling, never one copy of its cash per connection. Final routing rechecks the shared sum. */
export function capitalRouteCandidates(candidates: readonly ExecutionRouteCandidateV1[], budget: BudgetReportV1, marks: Readonly<Record<string, string>>) {
  if (!budget.executionEligible) throw new Error('capital_budget_unavailable');
  const rows = candidates.map(candidate => ({ ...candidate, availableCashUsd: budget.spendableUsd!,
    availableAssetValueUsd: budgetText(budgetAmount(budget.quantities[instrumentKey(candidate.instrument)] ?? '0')
      .mul(marks[instrumentKey(candidate.instrument)] ?? '0')),
    assumptionHash: capitalRouteAssumption(candidate.assumptionHash, budget) }));
  return { candidates: rows, revision: budget.revision, scopeId: budget.scopeId, marks };
}
