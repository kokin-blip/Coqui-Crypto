import { budgetAmount, budgetEvidence, budgetText, capitalHash, evaluateCapitalFeasibility, inapplicableNativeRule,
  projectAccountBudget, type CashClaimV1, type CapitalFeasibilityInputV1 } from '@coqui/core';

/** An isolated new simulation version. No registered arm, broker balance, source mutation or order port. */
export function previewCapitalSimulation(input: Omit<CapitalFeasibilityInputV1, 'budget' | 'expectedRevision'> & {
  readonly scopeId: string; readonly bookId: string; readonly cashUsd: string;
  readonly quantities: Readonly<Record<string, string>>; readonly claims: readonly CashClaimV1[];
}) {
  const equity = Object.entries(input.quantities).reduce((sum, [id, quantity]) => {
    const mark = input.assets.find(asset => asset.assetId === id)?.markUsd;
    if (!mark && !budgetAmount(quantity).isZero()) throw new Error('simulation_mark_missing');
    return sum.add(budgetAmount(quantity).mul(mark ?? '0'));
  }, budgetAmount(input.cashUsd));
  const source = budgetEvidence({ scopeId: input.scopeId, bookId: input.bookId, provider: 'local_paper', environment: 'simulation',
    observedAtMs: input.nowMs, expiresAtMs: input.nowMs + 30_000, cashUsd: input.cashUsd, equityUsd: budgetText(equity),
    positions: input.quantities, marks: Object.fromEntries(input.assets.map(asset => [asset.assetId, asset.markUsd])), quotes: {},
    ruleIds: input.assets.map(asset => asset.rules.id), fees: input.fees, venueEligibleUsd: inapplicableNativeRule('virtual_book_only'),
    complete: true, holdMatchingComplete: true, authority: 'isolated_book', assurance: 'scenario', reasonCodes: [],
    evidenceRefs: [capitalHash({ version: 'capital-simulation-preview-v1', bookId: input.bookId, cash: input.cashUsd, quantities: input.quantities })] });
  const budget = projectAccountBudget(source, input.claims, input.nowMs);
  const report = evaluateCapitalFeasibility({ budget, expectedRevision: budget.revision, nowMs: input.nowMs,
    assets: input.assets, fees: input.fees, policy: input.policy, intents: input.intents });
  return { version: 'capital-simulation-preview-v1' as const, modeledOnly: true as const, budget, report };
}
