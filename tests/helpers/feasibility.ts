import { budgetEvidence, capitalHash, capitalScopeId, inapplicableNativeRule as na, knownNativeRule as known, nativeExecutionRules,
  projectAccountBudget, type AccountBudgetEvidenceV1, type CapitalFeasibilityInputV1 } from '@coqui/core';
export const NOW = 1_000_000, BOOK = capitalHash('p2-book'), SCOPE = capitalScopeId('local_paper', 'simulation', BOOK), ASSET = 'coinbase|spot|BTC-USD';
export const rules = nativeExecutionRules({ provider: 'coinbase', environment: 'production_read_only', assetId: ASSET, productId: 'BTC-USD',
  baseCurrency: 'BTC', quoteCurrency: 'USD', form: 'market_quantity', timeInForce: 'gtc', tradable: true, assurance: 'scenario',
  quantityIncrement: known('0.01'), quantityMin: known('0.01'), quantityMax: na('synthetic-no-max'),
  quoteIncrement: known('0.01'), quoteMin: known('0.01'), quoteMax: na('synthetic-no-max'), priceIncrement: known('0.01'),
  observedAtMs: NOW, expiresAtMs: NOW + 30_000, source: 'synthetic-independent-fixture', evidenceRefs: ['synthetic'] });
export function source(overrides: Partial<Omit<AccountBudgetEvidenceV1, 'id'>> = {}) {
  return budgetEvidence({ scopeId: SCOPE, bookId: BOOK, provider: 'local_paper', environment: 'simulation', observedAtMs: NOW,
    expiresAtMs: NOW + 30_000, cashUsd: '500', equityUsd: '500', venueEligibleUsd: na('local-book-cash'), positions: {}, marks: {}, quotes: {},
    ruleIds: [rules.id], fees: null, complete: true, holdMatchingComplete: true, authority: 'isolated_book', assurance: 'scenario', reasonCodes: [], evidenceRefs: ['fixture'], ...overrides });
}
export function feasibility(capital = '500', changes: Partial<CapitalFeasibilityInputV1> = {}): CapitalFeasibilityInputV1 {
  const budget = projectAccountBudget(source({ cashUsd: capital, equityUsd: capital }), [], NOW);
  return { budget, expectedRevision: budget.revision, nowMs: NOW,
    assets: [{ assetId: ASSET, markUsd: '1', rules, quote: { bid: '1', ask: '1', atMs: NOW } }],
    intents: [{ assetId: ASSET, deltaQuantity: '10', reason: 'entry', strategyRef: 'fixture' }],
    policy: { id: capitalHash('fixed-policy'), maxOrders: 5, maxOrderUsd: capital, maxTurnoverUsd: capital, usedTurnoverUsd: '0',
      maxEntryFraction: '1', maxPositionFraction: '1', accountMaxPositionFraction: '1', maxInvestedFraction: '1', accountMaxInvestedFraction: '1',
      discretionaryFloorUsd: '0', riskExitBypassesDiscretionaryFloor: false, killSwitchEngaged: false },
    fees: { id: capitalHash('zero-fee-scenario'), rate: '0', fixedUsd: '0', currency: 'USD', slippageBps: '0', assurance: 'scenario', expiresAtMs: NOW + 60_000 }, ...changes };
}
