import { budgetAmount, budgetText, capitalHash, evaluateCapitalFeasibility, instrumentKey,
  type FeasibilityAssetV1, type FeasibilityFeesV1, type FeasibilityPolicyV1, type ExecutionIntent, type CapitalFeasibilityReportV1 } from '@coqui/core';
import { proposalFeasibilityReport, saveBudgetReport, saveFeasibilityReport, saveNativeExecutionRules, inTransaction, type Db, type PaperExecutionProposalRecord } from '@coqui/storage';
import type { PaperCapitalBudgetPort } from './capital-budget-port.js';

export interface PaperCapitalPreviewModel {
  readonly assets: () => readonly FeasibilityAssetV1[];
  readonly fees: () => FeasibilityFeesV1;
  readonly policy: () => FeasibilityPolicyV1;
}
export function paperCapitalPreviewIsCurrent(report: CapitalFeasibilityReportV1 | null, port: PaperCapitalBudgetPort,
  model: PaperCapitalPreviewModel | undefined, nowMs: number): boolean {
  if (!report || !model || report.state !== 'feasible' || report.budgetRevision !== port.budget().revision || nowMs >= report.expiresAtMs) return false;
  const old = JSON.parse(report.inputsJson) as { assets: unknown; fees: unknown; policy: unknown };
  return capitalHash({ assets: old.assets, fees: old.fees, policy: old.policy }) === capitalHash({ assets: model.assets(), fees: model.fees(), policy: model.policy() });
}
/** New-version model binding. The existing review/gate chain remains necessary. */
export function paperCapitalPreview(proposal: PaperExecutionProposalRecord, port: PaperCapitalBudgetPort,
  model: PaperCapitalPreviewModel, nowMs: number, db: Db) {
  const budget = port.budget(), assets = model.assets(), fees = model.fees(), policy = model.policy();
  const prior = proposalFeasibilityReport(budget.scopeId, proposal.id, db);
  const previousInputs = prior ? JSON.parse(prior.inputsJson) as { assets: unknown; fees: unknown; policy: unknown } : null;
  if (prior && prior.inputManifest.proposal?.hash === proposal.proposalHash && prior.budgetRevision === budget.revision &&
    prior.inputManifest.policyId === policy.id && prior.inputManifest.feeId === fees.id &&
    capitalHash(previousInputs && { assets: previousInputs.assets, fees: previousInputs.fees, policy: previousInputs.policy }) ===
      capitalHash({ assets, fees, policy }) && nowMs < prior.expiresAtMs) return prior;
  const intents = (JSON.parse(proposal.intentsJson) as ExecutionIntent[]).map(intent => {
    const assetId = instrumentKey(intent.asset.instrument), mark = assets.find(asset => asset.assetId === assetId)?.markUsd;
    return { assetId, deltaQuantity: mark && budgetAmount(mark).gt(0) ? budgetText(budgetAmount(intent.amountUsd).div(mark).mul(intent.side === 'buy' ? 1 : -1)) : '0',
      reason: 'rebalance' as const, strategyRef: `proposal:${proposal.id}:${proposal.revision}` };
  });
  const report = evaluateCapitalFeasibility({ budget, expectedRevision: budget.revision, nowMs, assets, fees, policy, intents,
    proposal: { id: proposal.id, hash: proposal.proposalHash, revision: proposal.revision }, requireFullRequest: true });
  inTransaction(db, () => { for (const asset of assets) saveNativeExecutionRules(asset.rules, db);
    saveBudgetReport(budget, db); saveFeasibilityReport(report, db); });
  return report;
}
