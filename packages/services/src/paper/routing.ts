import {
  routeExecutionPlan,
  budgetAmount,
  executionRouteCandidatesHash,
  instrumentKey, modeledFill, DEFAULT_TRADE_COST_CONFIG,
  type ExecutionPlanV1,
  type ExecutionRouteCandidateV1,
  type ExecutionRouteV1,
  type ExecutionRoutingResultV1,
  type PaperVenueAdapter,
  type PaperVenuePlacement,
} from '@coqui/core';
import {
  connectionRemoval, getProfileConnectionV2, connectionEligible,
  getExecutionPlan,
  latestMultiConnectionPaperCampaign,
  linkPaperConnectionRoute,
  listExecutionRoutes,
  linkExecutionPlanEvidence,
  saveExecutionPlan,
  validateExecutionLease,
  saveCapitalRouteBudgetBinding, capitalRouteBudgetBinding, inTransaction,
  type Db,
} from '@coqui/storage';
import type { PaperCapitalBudgetPort } from './capital-budget-port.js';
import type { capitalRouteCandidates } from './capital-routing.js';

export interface VenueNeutralRoutingDependencies {
  /** New isolated local version only; never installed into connected campaigns. */
  readonly capitalBudget?: PaperCapitalBudgetPort;
  readonly database: Db;
  readonly adapters: readonly PaperVenueAdapter[];
  /** Rebuilds the exact capability/balance/rule/health assumption immediately before placement. */
  readonly currentAssumptionHash: (route: ExecutionRouteV1) => string | null;
  readonly ownerId: string;
  readonly fencingToken: () => number | null;
  readonly nowMs: () => number;
}

export class VenueNeutralPaperRoutingService {
  readonly #database: Db;
  readonly #adapters: ReadonlyMap<string, PaperVenueAdapter>;
  readonly #currentAssumptionHash: (route: ExecutionRouteV1) => string | null;
  readonly #ownerId: string;
  readonly #fencingToken: () => number | null;
  readonly #nowMs: () => number;
  readonly #capitalBudget: PaperCapitalBudgetPort | undefined;

  constructor(dependencies: VenueNeutralRoutingDependencies) {
    this.#database = dependencies.database;
    this.#adapters = new Map(dependencies.adapters.map((adapter) => [adapter.provider, adapter]));
    this.#currentAssumptionHash = dependencies.currentAssumptionHash;
    this.#ownerId = dependencies.ownerId;
    this.#fencingToken = dependencies.fencingToken;
    this.#nowMs = dependencies.nowMs;
    this.#capitalBudget = dependencies.capitalBudget;
  }

  plan(
    plan: ExecutionPlanV1,
    candidates: readonly ExecutionRouteCandidateV1[],
    executionPlannedEventId?: string,
    budgetContext?: ReturnType<typeof capitalRouteCandidates>,
  ): ExecutionRoutingResultV1 {
    let routing = routeExecutionPlan(plan, candidates);
    if (this.#capitalBudget) {
      const budget = this.#capitalBudget.budget();
      if (!budget.executionEligible || budget.scopeId !== budgetContext?.scopeId || budget.revision !== budgetContext.revision ||
        executionRouteCandidatesHash(candidates) !== executionRouteCandidatesHash(budgetContext.candidates)) throw new Error('budget_revision_stale');
      let cash = budgetAmount(budget.spendableUsd!);
      const quantities = Object.fromEntries(Object.entries(budget.quantities).map(([id, quantity]) => [id, budgetAmount(quantity)]));
      const routes: ExecutionRouteV1[] = [], rejected = [...routing.unrouteable];
      for (const route of routing.routes) {
        const debit = route.side === 'buy' ? budgetAmount(modeledFill('buy', route.amountUsd, '1', DEFAULT_TRADE_COST_CONFIG).cashChange).neg() : budgetAmount('0');
        const key = instrumentKey(route.instrument), mark = budgetContext.marks[key];
        const quantity = route.side === 'sell' && mark && budgetAmount(mark).gt(0) ? budgetAmount(route.amountUsd).div(mark) : null;
        if (cash.lt(debit) || route.side === 'sell' && (!quantity || quantity.gt(quantities[key] ?? '0'))) rejected.push({ exposureKey: route.exposureKey, side: route.side, amountUsd: route.amountUsd });
        else { routes.push(route); cash = cash.sub(debit); if (quantity) quantities[key] = quantities[key]!.sub(quantity); }
      }
      routing = { routes, unrouteable: rejected };
    }
    inTransaction(this.#database, () => {
      saveExecutionPlan(plan, routing.routes, this.#database);
      if (this.#capitalBudget && budgetContext) for (const route of routing.routes) saveCapitalRouteBudgetBinding({
        scopeId: budgetContext.scopeId, routeId: route.id, budgetRevision: budgetContext.revision, assumptionHash: route.assumptionHash }, this.#database);
    });
    const campaign = latestMultiConnectionPaperCampaign(plan.profileId, this.#database);
    if (campaign !== null) {
      for (const route of routing.routes) {
        const book = campaign.books.find((candidate) => candidate.connectionId === route.connectionId);
        if (book !== undefined) linkPaperConnectionRoute({
          profileId: plan.profileId, routeId: route.id, campaignId: campaign.campaign.id,
          bookSnapshotId: book.id, connectionId: route.connectionId, createdAtMs: route.createdAtMs,
        }, this.#database);
      }
    }
    if (executionPlannedEventId !== undefined) {
      linkExecutionPlanEvidence(plan.id, executionPlannedEventId, this.#database);
    }
    return routing;
  }

  place(profileId: string, planId: string, routeId: string): PaperVenuePlacement {
    const plan = getExecutionPlan(planId, profileId, this.#database);
    const route = listExecutionRoutes(planId, profileId, this.#database)
      .find((candidate) => candidate.id === routeId);
    if (plan === null || route === undefined) {
      throw new Error('execution_route_not_found');
    }
    const connection=getProfileConnectionV2(profileId,route.connectionId,this.#database);
    if(connection!==null&&!connectionEligible(connection,this.#database))return {accepted:false,providerOrderId:null,reasonCode:'assumption_changed',idempotencyKey:route.idempotencyKey};
    const removal=connectionRemoval(profileId,route.connectionId,this.#database);
    if(removal!==null&&removal.state!=='reactivated')return {accepted:false,providerOrderId:null,reasonCode:'assumption_changed',idempotencyKey:route.idempotencyKey};
    const latest = this.#currentAssumptionHash(route);
    if (latest === null || latest !== route.assumptionHash) {
      return Object.freeze({
        accepted: false, providerOrderId: null, reasonCode: 'assumption_changed',
        idempotencyKey: route.idempotencyKey,
      });
    }
    const token = this.#fencingToken();
    if (token === null || !validateExecutionLease(
      profileId, this.#ownerId, token, this.#nowMs(), this.#database,
    )) {
      return Object.freeze({
        accepted: false, providerOrderId: null, reasonCode: 'execution_lease_invalid',
        idempotencyKey: route.idempotencyKey,
      });
    }
    const adapter = this.#adapters.get(route.provider);
    if (adapter === undefined) {
      return Object.freeze({
        accepted: false, providerOrderId: null, reasonCode: 'venue_refused',
        idempotencyKey: route.idempotencyKey,
      });
    }
    if (!this.#capitalBudget) return adapter.place(route);
    const budget = this.#capitalBudget.budget();
    const binding = capitalRouteBudgetBinding(budget.scopeId, route.id, this.#database);
    if (!budget.executionEligible || binding?.budgetRevision !== budget.revision || binding.assumptionHash !== route.assumptionHash) return {
      accepted: false, providerOrderId: null, reasonCode: 'assumption_changed', idempotencyKey: route.idempotencyKey };
    return this.#capitalBudget.withIntent({ profileId, campaignId: null, orderId: route.id, instrument: route.instrument,
      side: route.side, requestedUsd: route.amountUsd, expectedRevision: budget.revision, pending: true }, () => adapter.place(route));
  }
}
