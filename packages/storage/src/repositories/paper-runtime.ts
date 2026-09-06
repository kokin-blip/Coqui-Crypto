import {
  canonicalJson,
  sha256Hex,
  type CanonicalJsonValue,
  type PaperCampaignPlanV2,
  type PaperPendingExecutionV1,
  type PaperPortfolioSnapshotV1,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';
import { bootstrapPaperBalances } from './paper.js';

function content(value: unknown): { json: string; hash: string } {
  const json = canonicalJson(value as CanonicalJsonValue);
  return { json, hash: sha256Hex(json) };
}

export function getPaperBookOrigin(
  profileId: string,
  database: Db,
): { readonly snapshot: PaperPortfolioSnapshotV1; readonly contentHash: string } | null {
  const row = database.prepare(`
    SELECT snapshot_json, snapshot_hash FROM paper_book_origins_v1 WHERE profile_id = ?
  `).get(profileId) as { snapshot_json: string; snapshot_hash: string } | undefined;
  if (row === undefined) return null;
  if (sha256Hex(row.snapshot_json) !== row.snapshot_hash) throw new Error('Paper origin integrity failed.');
  return Object.freeze({
    snapshot: JSON.parse(row.snapshot_json) as PaperPortfolioSnapshotV1,
    contentHash: row.snapshot_hash,
  });
}

export function initializePaperBook(
  snapshot: PaperPortfolioSnapshotV1,
  database: Db,
): 'created' | 'exists' {
  if (snapshot.schemaVersion !== 1 || snapshot.source !== 'tracked_holdings_opening' ||
      snapshot.balances.length === 0 || snapshot.balances.some((balance) =>
        !balance.assetId || Number(balance.quantity) < 0 || Number(balance.priceUsd) <= 0 ||
        Number(balance.valueUsd) < 0) || snapshot.cashUsd !== '0') {
    throw new TypeError('Paper opening snapshot must be complete, priced, and use zero cash.');
  }
  const stored = content(snapshot);
  return inTransaction(database, () => {
    const existing = getPaperBookOrigin(snapshot.profileId, database);
    if (existing !== null) {
      if (existing.contentHash !== stored.hash) throw new Error('Paper book origin cannot change.');
      return 'exists';
    }
    const balances = database.prepare(
      'SELECT COUNT(*) AS count FROM paper_balances_v3 WHERE profile_id = ?',
    ).get(snapshot.profileId) as { count: number };
    if (balances.count !== 0) throw new Error('Existing paper balances require an explicit reset workflow.');
    bootstrapPaperBalances(snapshot.profileId, [
      { assetId: 'USD', quantity: '0' },
      ...snapshot.balances.map(({ assetId, quantity }) => ({ assetId: assetId as never, quantity })),
    ], `paper-origin:${stored.hash}`, snapshot.asOfMs, database);
    database.prepare(`
      INSERT INTO paper_book_origins_v1(profile_id, snapshot_json, snapshot_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(snapshot.profileId, stored.json, stored.hash, snapshot.asOfMs);
    return 'created';
  });
}

export function savePaperPendingExecution(
  pending: PaperPendingExecutionV1,
  database: Db,
): boolean {
  const stored = content(pending);
  if (pending.schemaVersion !== 1 || !pending.id || !pending.profileId || !pending.decisionId ||
      !pending.orderId || !Number.isSafeInteger(pending.requiredExecutionBarStartMs) ||
      pending.requiredExecutionBarStartMs < 0 || !/^[0-9a-f]{64}$/u.test(pending.costModelHash) ||
      pending.status !== 'submitted' || pending.settledAtMs !== null) {
    throw new TypeError('Invalid pending paper execution.');
  }
  const prior = database.prepare(`
    SELECT content_json, content_hash FROM paper_pending_executions_v1 WHERE id = ?
  `).get(pending.id) as { content_json: string; content_hash: string } | undefined;
  if (prior !== undefined) {
    if (prior.content_json !== stored.json || prior.content_hash !== stored.hash) {
      throw new Error('Pending execution identity cannot change.');
    }
    return false;
  }
  inTransaction(database, () => {
    database.prepare(`
      INSERT INTO paper_pending_executions_v1
        (id, profile_id, decision_id, order_id, required_bar_start, rule_snapshot_id,
         cost_model_hash, content_json, content_hash, status, submitted_at, settled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pending.id, pending.profileId, pending.decisionId, pending.orderId,
      pending.requiredExecutionBarStartMs, pending.productRuleSnapshotId,
      pending.costModelHash, stored.json, stored.hash, pending.status,
      pending.submittedAtMs, pending.settledAtMs,
    );
    database.prepare(`
      INSERT INTO paper_pending_execution_events_v1
        (id, pending_id, sequence, status, at, detail_json) VALUES (?, ?, 0, 'submitted', ?, '{}')
    `).run(sha256Hex(`${pending.id}:0:submitted`), pending.id, pending.submittedAtMs);
  });
  return true;
}

export function getPaperPendingExecution(id: string, database: Db): PaperPendingExecutionV1 | null {
  const row = database.prepare(
    'SELECT content_json, content_hash, status, settled_at FROM paper_pending_executions_v1 WHERE id = ?',
  ).get(id) as {
    content_json: string;
    content_hash: string;
    status: PaperPendingExecutionV1['status'];
    settled_at: number | null;
  } | undefined;
  if (row === undefined) return null;
  if (sha256Hex(row.content_json) !== row.content_hash) {
    throw new Error('Pending execution integrity failed.');
  }
  return Object.freeze({
    ...(JSON.parse(row.content_json) as PaperPendingExecutionV1),
    status: row.status,
    settledAtMs: row.settled_at,
  });
}

export function listSubmittedPaperExecutions(
  profileId: string,
  database: Db,
): readonly PaperPendingExecutionV1[] {
  const rows = database.prepare(`
    SELECT id FROM paper_pending_executions_v1
    WHERE profile_id = ? AND status = 'submitted'
    ORDER BY required_bar_start, id
  `).all(profileId) as Array<{ id: string }>;
  return Object.freeze(rows.map((row) => getPaperPendingExecution(row.id, database)!));
}

export function settlePaperPendingExecution(
  id: string,
  status: 'filled' | 'expired',
  at: number,
  database: Db,
): void {
  inTransaction(database, () => {
    const current = getPaperPendingExecution(id, database);
    if (current === null) throw new Error('Pending execution not found.');
    if (current.status !== 'submitted') {
      if (current.status === status) return;
      throw new Error('Pending execution is already terminal.');
    }
    database.prepare(`
      UPDATE paper_pending_executions_v1
      SET status = ?, settled_at = ? WHERE id = ?
    `).run(status, at, id);
    const sequence = 1;
    database.prepare(`
      INSERT INTO paper_pending_execution_events_v1
        (id, pending_id, sequence, status, at, detail_json) VALUES (?, ?, ?, ?, ?, ?)
    `).run(sha256Hex(`${id}:${sequence}:${status}`), id, sequence, status, at, '{}');
  });
}

export function savePaperCampaignPlanV2(plan: PaperCampaignPlanV2, database: Db): boolean {
  const stored = content(plan);
  const prior = database.prepare(`
    SELECT strategy_id, strategy_version, config_hash, code_hash,
      evidence_schema_version, cost_model_hash
    FROM paper_campaign_plans_v2 WHERE id = ?
  `).get(plan.id) as {
    strategy_id: string;
    strategy_version: string;
    config_hash: string;
    code_hash: string;
    evidence_schema_version: number;
    cost_model_hash: string;
  } | undefined;
  if (prior !== undefined) {
    if (prior.strategy_id !== plan.strategyId || prior.strategy_version !== plan.strategyVersion ||
        prior.config_hash !== plan.configHash || prior.code_hash !== plan.codeHash ||
        prior.evidence_schema_version !== plan.evidenceSchemaVersion ||
        prior.cost_model_hash !== plan.costModelHash) {
      throw new Error('Paper campaign identity cannot change.');
    }
    return false;
  }
  return database.prepare(`
    INSERT INTO paper_campaign_plans_v2
      (id, profile_id, strategy_id, strategy_version, config_hash, code_hash,
       evidence_schema_version, cost_model_hash, prospective_start, content_json,
       content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    plan.id, plan.profileId, plan.strategyId, plan.strategyVersion, plan.configHash,
    plan.codeHash, plan.evidenceSchemaVersion, plan.costModelHash,
    plan.prospectiveStartMs, stored.json, stored.hash, plan.createdAtMs,
  ).changes === 1;
}
