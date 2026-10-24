import { identifiedBudgetFact, type BudgetReportV1 } from '@coqui/core';
import { budgetCheckpoint, currentBudget, getBudgetSource, getNativeExecutionRules, getSetting, type Db } from '@coqui/storage';
import type { ChannelResponse } from '@coqui/contracts';
import { capitalScopesView } from './capital-performance.js';

export function accessibleCapitalBudget(profileId: string, scopeId: string, nowMs: number, database: Db): ChannelResponse<'capital.budget'> {
  const descriptor = capitalScopesView(profileId, database).scopes.find(row => row.scope.id === scopeId);
  if (!descriptor) throw new Error('capital_scope_unavailable');
  let budget = currentBudget(scopeId, nowMs, database);
  const checkpoint = budgetCheckpoint(scopeId, database), source = checkpoint ? getBudgetSource(checkpoint.source_id, database) : null;
  const ruleIds = source?.ruleIds ?? [];
  const codes: string[] = [];
  if (descriptor.mode !== 'active') codes.push(`budget_scope_${descriptor.mode}`);
  if (Number(getSetting(`capital.budget_failure.${scopeId}`, database) ?? -1) >= (source?.observedAtMs ?? 0)) codes.push('budget_capture_failed');
  if (budget && codes.length) budget = unavailableBudget(budget, ...codes);
  return { schemaVersion: 1, budget, nativeRules: ruleIds.map(id => getNativeExecutionRules(id, database)).filter(row => row !== null),
    reasonCodes: budget ? codes : [...codes, 'budget_source_not_recorded'] };
}
export function unavailableBudget(report: BudgetReportV1, ...codes: string[]): BudgetReportV1 {
  return identifiedBudgetFact({ ...report, state: 'unavailable' as const, spendableUsd: null, executionEligible: false,
    reasonCodes: [...new Set([...report.reasonCodes, ...codes])].sort(),
    restoration: [...report.restoration, ...codes.map(code => `Refresh and reconcile ${code.replaceAll('_', ' ')}; archived observations do not grant current authority.`)] });
}
