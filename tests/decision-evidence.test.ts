import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  sha256Hex,
  strategyDecisionId,
  type DecisionEvidenceEventV1,
  type StrategyDecisionV1,
} from '../packages/core/src/index.js';
import {
  appendDecisionEvidenceEvent,
  getStrategyDecision,
  linkWalletDecisionRun,
  listDecisionEvidenceEvents,
  openDatabase,
  saveStrategyDecision,
  saveWalletDecisionRun,
  type Db,
} from '../packages/storage/src/index.js';

function decision(
  profileId = 'profile-a',
  scheduledForMs = 1_725_000_000_000,
): StrategyDecisionV1 {
  return {
    schemaVersion: 1,
    decisionId: strategyDecisionId(profileId, scheduledForMs),
    profileId,
    runId: sha256Hex(`run:${profileId}:${scheduledForMs}`),
    scheduledForMs,
    strategy: {
      id: 'allocation-policy-rebalancer',
      version: 'allocation-policy-rebalancer-v1',
      configHash: sha256Hex('config'),
    },
    market: {
      snapshotHash: sha256Hex('market'),
      asOfMs: scheduledForMs - 86_400_000,
      expectedAsOfMs: scheduledForMs - 86_400_000,
      freshness: 'fresh',
    },
    portfolio: {
      snapshotHash: sha256Hex('portfolio'),
      version: 'paper-v1',
      source: 'paper_ledger',
    },
    targets: [
      { assetId: 'asset:btc', weight: 0.6 },
      { assetId: 'asset:eth', weight: 0.3 },
    ],
    cashWeight: 0.1,
    exposure: 0.9,
    historyStatus: 'complete',
    createdAtMs: scheduledForMs,
  };
}

function strategyEvent(
  value: StrategyDecisionV1,
  sequence = 0,
): Extract<DecisionEvidenceEventV1, { readonly kind: 'strategy_evaluated' }> {
  return {
    schemaVersion: 1,
    decisionId: value.decisionId,
    profileId: value.profileId,
    sequence,
    kind: 'strategy_evaluated',
    atMs: value.createdAtMs,
    detail: { decisionHash: saveHash(value) },
  };
}

function saveHash(value: StrategyDecisionV1): string {
  return sha256Hex(canonicalJson(value as never));
}

function saveLegacyRun(value: StrategyDecisionV1, database: Db): void {
  saveWalletDecisionRun({
    id: value.runId,
    profileId: value.profileId,
    scheduledFor: value.scheduledForMs,
    strategyVersion: value.strategy.version,
    snapshotHash: sha256Hex('legacy'),
    snapshotJson: '{}',
    status: 'completed',
    createdAt: value.createdAtMs,
    updatedAt: value.createdAtMs,
    error: null,
  }, database);
}

describe('strategy decision evidence', () => {
  it('canonicalizes object keys recursively while preserving array order', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true })).toBe(
      '{"a":true,"z":[{"a":1,"b":2}]}',
    );
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow('finite');
  });

  it('uses a slot-stable decision identity and rejects changed content', () => {
    const database = openDatabase(':memory:');
    const value = decision();
    const stored = saveStrategyDecision(value, database);
    expect(saveStrategyDecision(value, database)).toEqual(stored);
    expect(getStrategyDecision(value.decisionId, database)).toEqual(stored);

    expect(() => saveStrategyDecision({
      ...value,
      strategy: { ...value.strategy, configHash: sha256Hex('changed') },
    }, database)).toThrow('cannot change content');
    database.close();
  });

  it('appends ordered idempotent events and enforces profile isolation', () => {
    const database = openDatabase(':memory:');
    const value = decision();
    const stored = saveStrategyDecision(value, database);
    const evaluated = strategyEvent(value);
    const stoodDown: DecisionEvidenceEventV1 = {
      schemaVersion: 1,
      decisionId: value.decisionId,
      profileId: value.profileId,
      sequence: 1,
      kind: 'stand_down',
      atMs: value.createdAtMs + 1,
      detail: { reasonCode: 'stale_market_data' },
    };

    expect(evaluated.detail.decisionHash).toBe(stored.contentHash);
    expect(appendDecisionEvidenceEvent(evaluated, database)).toBe(true);
    expect(appendDecisionEvidenceEvent(evaluated, database)).toBe(false);
    expect(() => appendDecisionEvidenceEvent({ ...stoodDown, sequence: 2 }, database))
      .toThrow('contiguous sequence');
    expect(appendDecisionEvidenceEvent(stoodDown, database)).toBe(true);
    expect(listDecisionEvidenceEvents(value.decisionId, value.profileId, database))
      .toEqual([evaluated, stoodDown]);
    expect(() => appendDecisionEvidenceEvent(
      { ...stoodDown, profileId: 'profile-b', sequence: 2 },
      database,
    )).toThrow('does not match');
    database.close();
  });

  it('validates strict schemas and immutable database rows', () => {
    const database = openDatabase(':memory:');
    const value = decision();
    saveStrategyDecision(value, database);
    appendDecisionEvidenceEvent(strategyEvent(value), database);

    expect(() => saveStrategyDecision({
      ...value,
      targets: [...value.targets].reverse(),
    }, database)).toThrow('Invalid or duplicate');
    expect(() => appendDecisionEvidenceEvent({
      ...strategyEvent(value, 1),
      detail: { decisionHash: 'bad' },
    }, database)).toThrow('Invalid strategy evidence');
    expect(() => database.prepare(
      'UPDATE strategy_decisions_v1 SET strategy_version = ? WHERE decision_id = ?',
    ).run('changed', value.decisionId)).toThrow('immutable');
    expect(() => database.prepare(
      'DELETE FROM decision_evidence_events_v1 WHERE decision_id = ?',
    ).run(value.decisionId)).toThrow('append-only');
    expect(() => database.prepare(`
      INSERT INTO strategy_decisions_v1
        (decision_id, profile_id, run_id, scheduled_for, strategy_id,
         strategy_version, content_json, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sha256Hex('malformed-id'), 'profile-a', sha256Hex('malformed-run'), 3,
      'strategy', 'v1', '{', sha256Hex('malformed-content'), 3,
    )).toThrow();
    database.close();
  });

  it('links the compatibility summary once and rejects relinking', () => {
    const database = openDatabase(':memory:');
    const first = decision();
    const second = decision('profile-a', first.scheduledForMs + 1);
    saveStrategyDecision(first, database);
    saveStrategyDecision(second, database);
    saveLegacyRun(first, database);

    expect(linkWalletDecisionRun(first.runId, first.decisionId, database)).toBe(true);
    expect(linkWalletDecisionRun(first.runId, first.decisionId, database)).toBe(false);
    expect(() => linkWalletDecisionRun(first.runId, second.decisionId, database))
      .toThrow('cannot change');

    const foreign = decision('profile-b', first.scheduledForMs + 2);
    saveStrategyDecision(foreign, database);
    expect(() => linkWalletDecisionRun(first.runId, foreign.decisionId, database))
      .toThrow('profile mismatch');
    database.close();
  });
});
