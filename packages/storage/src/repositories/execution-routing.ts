import {
  canonicalJson,
  executionPlanHash,
  executionRouteHash,
  sha256Hex,
  type CanonicalJsonValue,
  type ExecutionPlanV1,
  type ExecutionRouteV1,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

const SHA256 = /^[0-9a-f]{64}$/u;

function json(value: unknown): string {
  return canonicalJson(value as CanonicalJsonValue);
}

function assertPlan(value: ExecutionPlanV1): void {
  if (value.schemaVersion !== 1 || !SHA256.test(value.id) || !value.profileId ||
      !SHA256.test(value.decisionId) || !SHA256.test(value.contentHash) ||
      executionPlanHash(value) !== value.contentHash ||
      value.id !== sha256Hex(`execution-plan-v1:${value.contentHash}`) ||
      !Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0 ||
      value.deltas.length === 0) throw new TypeError('Invalid execution plan.');
}

function assertRoute(value: ExecutionRouteV1, plan: ExecutionPlanV1): void {
  if (value.schemaVersion !== 1 || value.profileId !== plan.profileId ||
      value.decisionId !== plan.decisionId || value.planId !== plan.id ||
      !SHA256.test(value.id) || !SHA256.test(value.contentHash) ||
      !SHA256.test(value.idempotencyKey) || !SHA256.test(value.assumptionHash) ||
      executionRouteHash(value) !== value.contentHash ||
      value.id !== sha256Hex(`execution-route-v1:${value.contentHash}`)) {
    throw new TypeError('Invalid execution route.');
  }
}

export function saveExecutionPlan(
  plan: ExecutionPlanV1,
  routes: readonly ExecutionRouteV1[],
  database: Db,
): void {
  assertPlan(plan);
  for (const route of routes) assertRoute(route, plan);
  const planJson = json(plan);
  inTransaction(database, () => {
    const prior = database.prepare('SELECT content_json FROM execution_plans_v1 WHERE id = ?')
      .get(plan.id) as { content_json: string } | undefined;
    if (prior !== undefined) {
      if (prior.content_json !== planJson) throw new Error('Execution plan identity cannot change.');
    } else {
      database.prepare(`INSERT INTO execution_plans_v1
        (id, profile_id, decision_id, content_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(plan.id, plan.profileId, plan.decisionId, planJson, plan.contentHash, plan.createdAtMs);
    }
    for (const route of routes) {
      const routeJson = json(route);
      const existing = database.prepare('SELECT content_json FROM execution_routes_v1 WHERE id = ?')
        .get(route.id) as { content_json: string } | undefined;
      if (existing !== undefined) {
        if (existing.content_json !== routeJson) throw new Error('Execution route identity cannot change.');
        continue;
      }
      database.prepare(`INSERT INTO execution_routes_v1
        (id, plan_id, profile_id, decision_id, connection_id, provider,
         idempotency_key, assumption_hash, content_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(route.id, route.planId, route.profileId, route.decisionId, route.connectionId,
          route.provider, route.idempotencyKey, route.assumptionHash, routeJson,
          route.contentHash, route.createdAtMs);
    }
  });
}

export function linkExecutionPlanEvidence(planId: string, eventId: string, database: Db): void {
  if (!SHA256.test(planId) || !SHA256.test(eventId)) throw new TypeError('Invalid execution evidence link.');
  database.prepare(`INSERT INTO execution_plan_evidence_links_v1 (plan_id, event_id)
    VALUES (?, ?) ON CONFLICT(plan_id) DO NOTHING`).run(planId, eventId);
  const stored = database.prepare(`SELECT event_id FROM execution_plan_evidence_links_v1 WHERE plan_id = ?`)
    .get(planId) as { event_id: string } | undefined;
  if (stored?.event_id !== eventId) throw new Error('Execution evidence link cannot change.');
}

export function getExecutionPlan(id: string, profileId: string, database: Db): ExecutionPlanV1 | null {
  const row = database.prepare(`SELECT content_json FROM execution_plans_v1 WHERE id = ? AND profile_id = ?`)
    .get(id, profileId) as { content_json: string } | undefined;
  if (row === undefined) return null;
  const value = JSON.parse(row.content_json) as ExecutionPlanV1;
  assertPlan(value);
  if (json(value) !== row.content_json) throw new Error('Stored execution plan integrity failed.');
  return Object.freeze(value);
}

export function listExecutionRoutes(planId: string, profileId: string, database: Db): readonly ExecutionRouteV1[] {
  const plan = getExecutionPlan(planId, profileId, database);
  if (plan === null) return Object.freeze([]);
  const rows = database.prepare(`SELECT content_json FROM execution_routes_v1
    WHERE plan_id = ? AND profile_id = ? ORDER BY id`).all(planId, profileId) as { content_json: string }[];
  return Object.freeze(rows.map((row) => {
    const value = JSON.parse(row.content_json) as ExecutionRouteV1;
    assertRoute(value, plan);
    if (json(value) !== row.content_json) throw new Error('Stored execution route integrity failed.');
    return Object.freeze(value);
  }));
}
