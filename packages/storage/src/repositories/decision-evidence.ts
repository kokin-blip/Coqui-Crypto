import {
  decisionEvidenceEventJson,
  sha256Hex,
  strategyDecisionHash,
  strategyDecisionId,
  strategyDecisionJson,
  type DecisionEvidenceEventV1,
  type StrategyDecisionV1,
} from '@coqui/core';

import type { Db } from '../sqlite/index.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REASON = /^[a-z][a-z0-9_]{0,79}$/u;
const EVENT_KINDS = new Set([
  'strategy_evaluated', 'risk_evaluated', 'execution_planned', 'no_trade',
  'stand_down', 'execution_submitted', 'execution_filled',
  'execution_refused', 'recovery',
]);

function validTime(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function assertDecision(decision: StrategyDecisionV1): void {
  const completeMarket = decision.market.snapshotHash !== null &&
    decision.market.asOfMs !== null && decision.market.expectedAsOfMs !== null;
  if (decision.schemaVersion !== 1 || decision.profileId.length === 0 ||
      decision.profileId.length > 64 || !ID.test(decision.runId) ||
      !ID.test(decision.strategy.id) || !ID.test(decision.strategy.version) ||
      !SHA256.test(decision.strategy.configHash) ||
      !Number.isSafeInteger(decision.scheduledForMs) || decision.scheduledForMs < 0 ||
      !Number.isSafeInteger(decision.createdAtMs) || decision.createdAtMs < 0 ||
      !validTime(decision.market.asOfMs) || !validTime(decision.market.expectedAsOfMs) ||
      (decision.market.snapshotHash !== null && !SHA256.test(decision.market.snapshotHash)) ||
      !REASON.test(decision.market.refreshResult) ||
      (decision.market.ruleSnapshotHash !== null && !SHA256.test(decision.market.ruleSnapshotHash)) ||
      typeof decision.market.rulesFresh !== 'boolean' ||
      (decision.portfolio.snapshotHash !== null && !SHA256.test(decision.portfolio.snapshotHash)) ||
      (decision.portfolio.version !== null && !ID.test(decision.portfolio.version)) ||
      !['profile_holdings', 'paper_ledger', 'unavailable'].includes(decision.portfolio.source) ||
      !['fresh', 'stale', 'unavailable'].includes(decision.market.freshness) ||
      !['complete', 'partial', 'insufficient', 'unavailable'].includes(decision.historyStatus) ||
      (decision.market.snapshotHash !== null && !completeMarket) ||
      (decision.market.rulesFresh && decision.market.ruleSnapshotHash === null) ||
      (decision.market.refreshResult === 'succeeded' &&
        (!completeMarket || !decision.market.rulesFresh || decision.market.freshness !== 'fresh')) ||
      decision.decisionId !== strategyDecisionId(decision.profileId, decision.scheduledForMs)) {
    throw new TypeError('Invalid strategy decision identity or provenance.');
  }
  for (const value of [decision.cashWeight, decision.exposure]) {
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError('Strategy decision weights must be finite values in [0, 1].');
    }
  }
  let total = 0;
  const assets = new Set<string>();
  let previousAssetId: string | null = null;
  for (const target of decision.targets) {
    if (target.assetId.length === 0 || target.assetId.length > 160 || assets.has(target.assetId) ||
        !Number.isFinite(target.weight) || target.weight < 0 || target.weight > 1 ||
        (previousAssetId !== null && target.assetId <= previousAssetId)) {
      throw new TypeError('Invalid or duplicate strategy decision target.');
    }
    assets.add(target.assetId);
    previousAssetId = target.assetId;
    total += target.weight;
  }
  if (total > 1 + 1e-12) throw new TypeError('Strategy decision targets cannot exceed 100%.');
  if (decision.facts !== null) {
    if ((decision.facts.realizedVolPct !== null &&
        (!Number.isFinite(decision.facts.realizedVolPct) || decision.facts.realizedVolPct < 0)) ||
        (decision.facts.belowTrend !== null && typeof decision.facts.belowTrend !== 'boolean')) {
      throw new TypeError('Invalid strategy decision facts.');
    }
    const factAssets = new Set<string>();
    for (const fact of decision.facts.momentum) {
      if (!fact.assetId || factAssets.has(fact.assetId) ||
          ![fact.returnPct, fact.volatilityPct, fact.riskAdjustedMomentum].every(Number.isFinite) ||
          fact.volatilityPct < 0) {
        throw new TypeError('Invalid strategy decision momentum facts.');
      }
      factAssets.add(fact.assetId);
    }
  }
}

function eventReason(event: DecisionEvidenceEventV1): string | null {
  if (event.kind === 'stand_down' || event.kind === 'no_trade' ||
      event.kind === 'execution_refused') return event.detail.reasonCode;
  return null;
}

function assertEvent(event: DecisionEvidenceEventV1): void {
  if (event.schemaVersion !== 1 || !SHA256.test(event.decisionId) ||
      event.profileId.length === 0 || event.profileId.length > 64 ||
      !Number.isSafeInteger(event.sequence) || event.sequence < 0 ||
      !Number.isSafeInteger(event.atMs) || event.atMs < 0 ||
      !EVENT_KINDS.has(event.kind)) {
    throw new TypeError('Invalid decision evidence event.');
  }
  const reason = eventReason(event);
  if (reason !== null && !REASON.test(reason)) {
    throw new TypeError('Invalid decision evidence reason code.');
  }
  switch (event.kind) {
    case 'strategy_evaluated':
      if (!SHA256.test(event.detail.decisionHash)) throw new TypeError('Invalid strategy evidence.');
      break;
    case 'risk_evaluated':
      if (typeof event.detail.approved !== 'boolean' ||
          !SHA256.test(event.detail.assessmentHash) ||
          !event.detail.reasonCodes.every((code) => REASON.test(code))) {
        throw new TypeError('Invalid risk evidence.');
      }
      break;
    case 'execution_planned':
      if (!ID.test(event.detail.planId) || !SHA256.test(event.detail.planHash) ||
          !Number.isSafeInteger(event.detail.intentCount) || event.detail.intentCount < 0) {
        throw new TypeError('Invalid execution-plan evidence.');
      }
      break;
    case 'no_trade':
      for (const amount of [event.detail.estimatedTradeUsd, event.detail.minimumUsefulTradeUsd]) {
        if (amount !== null && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(amount)) {
          throw new TypeError('Invalid no-trade amount.');
        }
      }
      break;
    case 'stand_down':
      break;
    case 'execution_submitted':
      if (!ID.test(event.detail.proposalId) || !SHA256.test(event.detail.proposalHash) ||
          !event.detail.orderIds.every((id) => ID.test(id))) {
        throw new TypeError('Invalid submission evidence.');
      }
      break;
    case 'execution_filled':
      if (!ID.test(event.detail.proposalId) ||
          !Number.isSafeInteger(event.detail.filledCount) || event.detail.filledCount < 0 ||
          !Number.isSafeInteger(event.detail.refusedCount) || event.detail.refusedCount < 0) {
        throw new TypeError('Invalid fill evidence.');
      }
      break;
    case 'execution_refused':
      if ((event.detail.proposalId !== null && !ID.test(event.detail.proposalId)) ||
          !Number.isSafeInteger(event.detail.refusedCount) || event.detail.refusedCount < 0) {
        throw new TypeError('Invalid refusal evidence.');
      }
      break;
    case 'recovery':
      if (!ID.test(event.detail.orderId) ||
          !['filled', 'cancelled', 'expired', 'unknown', 'reconciled'].includes(
            event.detail.disposition,
          )) {
        throw new TypeError('Invalid recovery evidence.');
      }
      break;
  }
}

export interface StoredStrategyDecision {
  readonly decision: StrategyDecisionV1;
  readonly contentHash: string;
}

export function saveStrategyDecision(
  decision: StrategyDecisionV1,
  database: Db,
): StoredStrategyDecision {
  assertDecision(decision);
  const contentJson = strategyDecisionJson(decision);
  const contentHash = strategyDecisionHash(decision);
  const existing = database.prepare(`
    SELECT content_json, content_hash FROM strategy_decisions_v1 WHERE decision_id = ?
  `).get(decision.decisionId) as { content_json: string; content_hash: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_json !== contentJson || existing.content_hash !== contentHash) {
      throw new Error('Strategy decision identity cannot change content.');
    }
    return { decision, contentHash };
  }
  database.prepare(`
    INSERT INTO strategy_decisions_v1
      (decision_id, profile_id, run_id, scheduled_for, strategy_id,
       strategy_version, content_json, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    decision.decisionId,
    decision.profileId,
    decision.runId,
    decision.scheduledForMs,
    decision.strategy.id,
    decision.strategy.version,
    contentJson,
    contentHash,
    decision.createdAtMs,
  );
  return { decision, contentHash };
}

export function getStrategyDecision(
  decisionId: string,
  database: Db,
): StoredStrategyDecision | null {
  const row = database.prepare(`
    SELECT content_json, content_hash FROM strategy_decisions_v1 WHERE decision_id = ?
  `).get(decisionId) as { content_json: string; content_hash: string } | undefined;
  if (row === undefined) return null;
  const decision = JSON.parse(row.content_json) as StrategyDecisionV1;
  assertDecision(decision);
  if (strategyDecisionJson(decision) !== row.content_json ||
      strategyDecisionHash(decision) !== row.content_hash) {
    throw new Error('Stored strategy decision integrity validation failed.');
  }
  return { decision, contentHash: row.content_hash };
}

export function appendDecisionEvidenceEvent(
  event: DecisionEvidenceEventV1,
  database: Db,
): boolean {
  assertEvent(event);
  const decision = getStrategyDecision(event.decisionId, database);
  if (decision === null || decision.decision.profileId !== event.profileId) {
    throw new Error('Decision evidence profile does not match its decision.');
  }
  const payloadJson = decisionEvidenceEventJson(event);
  const payloadHash = sha256Hex(payloadJson);
  const id = sha256Hex(`${event.decisionId}:${event.sequence}:${event.kind}`);
  const existing = database.prepare(`
    SELECT payload_json, payload_hash FROM decision_evidence_events_v1 WHERE id = ?
  `).get(id) as { payload_json: string; payload_hash: string } | undefined;
  if (existing !== undefined) {
    if (existing.payload_json !== payloadJson || existing.payload_hash !== payloadHash) {
      throw new Error('Decision evidence event identity cannot change content.');
    }
    return false;
  }
  const latest = database.prepare(`
    SELECT MAX(sequence) AS sequence FROM decision_evidence_events_v1 WHERE decision_id = ?
  `).get(event.decisionId) as { sequence: number | null };
  const expectedSequence = latest.sequence === null ? 0 : latest.sequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new Error('Decision evidence events must append in contiguous sequence order.');
  }
  database.prepare(`
    INSERT INTO decision_evidence_events_v1
      (id, decision_id, profile_id, sequence, kind, reason_code, at,
       payload_json, payload_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    event.decisionId,
    event.profileId,
    event.sequence,
    event.kind,
    eventReason(event),
    event.atMs,
    payloadJson,
    payloadHash,
  );
  return true;
}

export function listDecisionEvidenceEvents(
  decisionId: string,
  profileId: string,
  database: Db,
): readonly DecisionEvidenceEventV1[] {
  const rows = database.prepare(`
    SELECT payload_json, payload_hash FROM decision_evidence_events_v1
    WHERE decision_id = ? AND profile_id = ? ORDER BY sequence
  `).all(decisionId, profileId) as unknown as Array<{
    payload_json: string;
    payload_hash: string;
  }>;
  return Object.freeze(rows.map((row) => {
    if (sha256Hex(row.payload_json) !== row.payload_hash) {
      throw new Error('Stored decision evidence event integrity validation failed.');
    }
    const event = JSON.parse(row.payload_json) as DecisionEvidenceEventV1;
    assertEvent(event);
    return event;
  }));
}

export function linkWalletDecisionRun(
  runId: string,
  decisionId: string,
  database: Db,
): boolean {
  if (!ID.test(runId) || !SHA256.test(decisionId)) throw new TypeError('Invalid decision link.');
  const ownership = database.prepare(`
    SELECT wallet.profile_id AS wallet_profile_id, decision.profile_id AS decision_profile_id
    FROM wallet_decision_runs wallet, strategy_decisions_v1 decision
    WHERE wallet.id = ? AND decision.decision_id = ?
  `).get(runId, decisionId) as {
    wallet_profile_id: string;
    decision_profile_id: string;
  } | undefined;
  if (ownership === undefined || ownership.wallet_profile_id !== ownership.decision_profile_id) {
    throw new Error('Wallet decision link profile mismatch.');
  }
  const existing = database.prepare(`
    SELECT decision_id FROM wallet_decision_links_v1 WHERE run_id = ?
  `).get(runId) as { decision_id: string } | undefined;
  if (existing !== undefined) {
    if (existing.decision_id !== decisionId) throw new Error('Wallet decision link cannot change.');
    return false;
  }
  return database.prepare(`
    INSERT INTO wallet_decision_links_v1 (run_id, decision_id) VALUES (?, ?)
  `).run(runId, decisionId).changes === 1;
}
