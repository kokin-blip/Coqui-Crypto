import {
  budgetEvidence, capitalHash, budgetAmount, budgetText, evaluateCapitalFeasibility, inapplicableNativeRule as na,
  knownNativeRule as known, nativeExecutionRules, projectAccountBudget, type CapitalFeasibilityInputV1,
  type CapitalFeasibilityReportV1, type FeasibilityPolicyV1,
} from '@coqui/core';
import { getBudgetSource, getPaperExecutionProposal, proposalFeasibilityReport, type Db } from '@coqui/storage';
import type { ChannelRequest } from '@coqui/contracts';
import { accessibleCapitalBudget, unavailableBudget } from './capital-budget.js';
import { capitalScopesView } from './capital-performance.js';

/** Fixed conservative illustrative policy, never a change to a campaign or the legacy tier helper. */
export function smallCapitalScenario(scopeId: string, capitalUsd: string, tradeUsd: string, minimumQuantity: string,
  quantityIncrement: string, nowMs: number): CapitalFeasibilityInputV1 {
  const assetId = 'illustrative-asset-usd', source = budgetEvidence({ scopeId, bookId: 'hypothetical-book', provider: 'local_paper', environment: 'simulation',
    observedAtMs: nowMs, expiresAtMs: nowMs + 30_000, cashUsd: capitalUsd, equityUsd: capitalUsd, venueEligibleUsd: na('no_provider_account_in_scenario'),
    positions: {}, marks: {}, quotes: {}, ruleIds: [], fees: null, complete: true, holdMatchingComplete: true, authority: 'isolated_book',
    assurance: 'scenario', reasonCodes: [], evidenceRefs: ['explicit_hypothetical_scenario_not_ledger_funding'] });
  const budget = projectAccountBudget(source, [], nowMs);
  const body = { maxOrders: 1, maxOrderUsd: capitalUsd, maxTurnoverUsd: budgetText(budgetAmount(capitalUsd).mul('0.16')), usedTurnoverUsd: '0',
    maxEntryFraction: '0.05', maxPositionFraction: '0.20', accountMaxPositionFraction: '0.20', maxInvestedFraction: '0.90', accountMaxInvestedFraction: '0.90',
    discretionaryFloorUsd: '25', riskExitBypassesDiscretionaryFloor: false, killSwitchEngaged: false };
  const policy: FeasibilityPolicyV1 = { ...body, id: capitalHash({ version: 'small-capital-scenario-policy-v1', ...body }) };
  const rule = nativeExecutionRules({ provider: 'coinbase', environment: 'production_read_only', assetId, productId: 'ILLUSTRATIVE-USD', baseCurrency: 'ILLUSTRATIVE', quoteCurrency: 'USD',
    form: 'market_quantity', timeInForce: 'gtc', tradable: true, assurance: 'scenario', quantityIncrement: known(quantityIncrement), quantityMin: known(minimumQuantity),
    quantityMax: na('explicit_scenario_no_quantity_max'), quoteIncrement: known('0.01'), quoteMin: known('0.01'), quoteMax: na('explicit_scenario_no_quote_max'),
    priceIncrement: known('0.001'), observedAtMs: nowMs, expiresAtMs: nowMs + 30_000, source: 'hypothetical_venue_rules', evidenceRefs: ['scenario'] });
  const fees = { rate: '0.0025', fixedUsd: '0', currency: 'received' as const, slippageBps: '15', assurance: 'scenario' as const, expiresAtMs: nowMs + 30_000 };
  return { budget, expectedRevision: budget.revision, nowMs,
    assets: [{ assetId, markUsd: '1', quote: { bid: '0.999', ask: '1.001', atMs: nowMs }, rules: rule }],
    intents: [{ assetId, deltaQuantity: tradeUsd, reason: 'entry', strategyRef: 'illustrative_only_no_forecast' }],
    policy, fees: { ...fees, id: capitalHash(fees) } };
}
export function capitalFeasibilityView(profileId: string, request: ChannelRequest<'capital.feasibility'>, nowMs: number, database: Db): CapitalFeasibilityReportV1 {
  if (request.scopeId !== null && !capitalScopesView(profileId, database).scopes.some(row => row.scope.id === request.scopeId)) throw new Error('capital_scope_unavailable');
  if (request.mode === 'scenario') return evaluateCapitalFeasibility(smallCapitalScenario(request.scopeId ?? capitalHash('standalone-hypothetical-book'), request.capitalUsd, request.tradeUsd,
    request.minimumQuantity, request.quantityIncrement, nowMs));
  const view = accessibleCapitalBudget(profileId, request.scopeId, nowMs, database);
  if (!view.budget) throw new Error('budget_source_not_recorded');
  const proposal = getPaperExecutionProposal(request.proposalId, database);
  if (!proposal || proposal.profileId !== profileId) throw new Error('budget_proposal_unavailable');
  const saved = proposalFeasibilityReport(request.scopeId, proposal.id, database);
  if (saved?.inputManifest.proposal?.hash === proposal.proposalHash && saved.inputManifest.proposal.revision === proposal.revision &&
    saved.budgetRevision === request.expectedRevision && saved.budgetRevision === view.budget.revision &&
    view.budget.state === 'available' && nowMs < saved.expiresAtMs) return saved;
  const source = getBudgetSource(view.budget.sourceId, database)!;
  // A legacy proposal has no approved new-version risk policy/rule/fee binding. Never fill the gaps from renderer input.
  const frame = smallCapitalScenario(request.scopeId, view.budget.equityUsd ?? '0', '0', '0.01', '0.01', nowMs);
  const budget = unavailableBudget(view.budget, 'proposal_budget_policy_binding_missing', ...(source.fees ? [] : ['fee_terms_unavailable']));
  return evaluateCapitalFeasibility({ ...frame, budget, expectedRevision: request.expectedRevision, assets: [], intents: [] });
}
