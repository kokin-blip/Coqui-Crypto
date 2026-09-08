import {
  routeExecutionPlan,
  type ExecutionPlanV1,
  type ExecutionRouteCandidateV1,
  type ExecutionRouteV1,
  type ExecutionRoutingResultV1,
  type PaperVenueAdapter,
  type PaperVenuePlacement,
} from '@coqui/core';
import {
  getExecutionPlan,
  latestMultiConnectionPaperCampaign,
  linkPaperConnectionRoute,
  listExecutionRoutes,
  linkExecutionPlanEvidence,
  saveExecutionPlan,
  validateExecutionLease,
  type Db,
} from '@coqui/storage';

export interface VenueNeutralRoutingDependencies {
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

  constructor(dependencies: VenueNeutralRoutingDependencies) {
    this.#database = dependencies.database;
    this.#adapters = new Map(dependencies.adapters.map((adapter) => [adapter.provider, adapter]));
    this.#currentAssumptionHash = dependencies.currentAssumptionHash;
    this.#ownerId = dependencies.ownerId;
    this.#fencingToken = dependencies.fencingToken;
    this.#nowMs = dependencies.nowMs;
  }

  plan(
    plan: ExecutionPlanV1,
    candidates: readonly ExecutionRouteCandidateV1[],
    executionPlannedEventId?: string,
  ): ExecutionRoutingResultV1 {
    const routing = routeExecutionPlan(plan, candidates);
    saveExecutionPlan(plan, routing.routes, this.#database);
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
    return adapter.place(route);
  }
}
