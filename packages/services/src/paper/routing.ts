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
  listExecutionRoutes,
  linkExecutionPlanEvidence,
  saveExecutionPlan,
  type Db,
} from '@coqui/storage';

export interface VenueNeutralRoutingDependencies {
  readonly database: Db;
  readonly adapters: readonly PaperVenueAdapter[];
  /** Rebuilds the exact capability/balance/rule/health assumption immediately before placement. */
  readonly currentAssumptionHash: (route: ExecutionRouteV1) => string | null;
}

export class VenueNeutralPaperRoutingService {
  readonly #database: Db;
  readonly #adapters: ReadonlyMap<string, PaperVenueAdapter>;
  readonly #currentAssumptionHash: (route: ExecutionRouteV1) => string | null;

  constructor(dependencies: VenueNeutralRoutingDependencies) {
    this.#database = dependencies.database;
    this.#adapters = new Map(dependencies.adapters.map((adapter) => [adapter.provider, adapter]));
    this.#currentAssumptionHash = dependencies.currentAssumptionHash;
  }

  plan(
    plan: ExecutionPlanV1,
    candidates: readonly ExecutionRouteCandidateV1[],
    executionPlannedEventId?: string,
  ): ExecutionRoutingResultV1 {
    const routing = routeExecutionPlan(plan, candidates);
    saveExecutionPlan(plan, routing.routes, this.#database);
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
