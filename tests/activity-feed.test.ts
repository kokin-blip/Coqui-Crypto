import { describe, expect, it } from 'vitest';

import { sha256Hex, strategyDecisionId, type StrategyDecisionV1 } from '../packages/core/src/index.js';
import { appendDecisionEvidenceEvent, listActivityFeed, openDatabase,
  readOperationsFloor, saveStrategyDecision } from '../packages/storage/src/index.js';

function decision(profileId: string, at: number): StrategyDecisionV1 {
  return { schemaVersion: 1, decisionId: strategyDecisionId(profileId, at), profileId,
    runId: sha256Hex(`run:${profileId}:${at}`), scheduledForMs: at,
    strategy: { id: 'trendvol', version: 'trendvol-paper-v1-unvalidated', configHash: sha256Hex('config') },
    market: { snapshotHash: sha256Hex('market'), asOfMs: at, expectedAsOfMs: at,
      freshness: 'fresh', refreshResult: 'succeeded', ruleSnapshotHash: sha256Hex('rules'), rulesFresh: true },
    portfolio: { snapshotHash: sha256Hex('portfolio'), version: 'paper-v1', source: 'paper_ledger' },
    targets: [], cashWeight: 1, exposure: 0, historyStatus: 'complete', facts: null, createdAtMs: at };
}

describe('bounded activity feed', () => {
  it('merges sources newest-first, paginates by cursor, and isolates profiles', () => {
    const database = openDatabase(':memory:');
    database.prepare(`
      INSERT INTO wallet_decision_runs
      (id, profile_id, scheduled_for, strategy_version, snapshot_hash, snapshot_json, status, created_at, updated_at, error)
      VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, NULL)
    `).run('decision-1', 'main', 100, 'trendvol-legacy-unvalidated', 'a'.repeat(64), 'completed', 100, 100);
    database.prepare(`
      INSERT INTO runtime_incidents
      (id, profile_id, run_id, kind, severity, source, detail_json, occurred_at, resolved_at, resolution)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL)
    `).run('incident-1', 'main', 'scheduler_failure', 'blocking', 'scheduler', '{"secret":"not-forwarded"}', 200);
    database.prepare(`
      INSERT INTO runtime_incidents
      (id, profile_id, run_id, kind, severity, source, detail_json, occurred_at, resolved_at, resolution)
      VALUES (?, ?, NULL, ?, ?, ?, '{}', ?, NULL, NULL)
    `).run('incident-other', 'other', 'worker_failure', 'warning', 'worker', 300);

    const first = listActivityFeed('main', 1, null, database);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ id: 'incident:incident-1', occurredAt: 200 });
    expect(first.events[0]?.detail).not.toContain('not-forwarded');
    expect(first.nextCursor).not.toBeNull();

    const second = listActivityFeed('main', 1, first.nextCursor, database);
    expect(second.events).toEqual([expect.objectContaining({ id: 'decision:decision-1' })]);
    expect(second.events[0]?.detail).toContain(
      'legacy allocation rebalancer (historically mislabeled as TrendVol)',
    );
    expect(second.events.some((event) => event.id.includes('other'))).toBe(false);
    database.close();
  });

  it('projects immutable decision steps with shared identities and reason codes', () => {
    const database = openDatabase(':memory:'), value = decision('main', 500);
    const stored = saveStrategyDecision(value, database);
    appendDecisionEvidenceEvent({ schemaVersion: 1, decisionId: value.decisionId,
      profileId: 'main', sequence: 0, kind: 'strategy_evaluated', atMs: 500,
      detail: { decisionHash: stored.contentHash } }, database);
    appendDecisionEvidenceEvent({ schemaVersion: 1, decisionId: value.decisionId,
      profileId: 'main', sequence: 1, kind: 'no_trade', atMs: 501,
      detail: { reasonCode: 'no_rebalance_needed', estimatedTradeUsd: '0', minimumUsefulTradeUsd: '10' } }, database);
    const feed = listActivityFeed('main', 10, null, database);
    expect(feed.events).toHaveLength(2);
    expect(feed.events[0]).toMatchObject({ kind: 'decision', status: 'blocked',
      decisionId: value.decisionId, reasonCode: 'no_rebalance_needed' });
    expect(feed.events[0]?.evidenceId).toHaveLength(64);
    expect(feed.events.every((event) => event.provenance?.length === 64)).toBe(true);
    database.close();
  });

  it('returns exactly six bounded persisted subsystem read models with honest gaps', () => {
    const database = openDatabase(':memory:'), value = decision('main', 800);
    saveStrategyDecision(value, database);
    appendDecisionEvidenceEvent({ schemaVersion: 1, decisionId: value.decisionId,
      profileId: 'main', sequence: 0, kind: 'risk_evaluated', atMs: 801,
      detail: { approved: false, reasonCodes: ['profitability_gate_failed'], assessmentHash: sha256Hex('risk') } }, database);
    const floor = readOperationsFloor('main', database);
    expect(floor.map((item) => item.subsystem)).toEqual(['host', 'market', 'risk', 'research', 'routing', 'execution']);
    expect(floor.find((item) => item.subsystem === 'market')).toMatchObject({ state: 'nominal', decisionId: value.decisionId });
    expect(floor.find((item) => item.subsystem === 'risk')).toMatchObject({ state: 'attention', decisionId: value.decisionId });
    expect(floor.filter((item) => item.state === 'unavailable').map((item) => item.subsystem))
      .toEqual(['host', 'research', 'routing', 'execution']);
    expect(JSON.stringify(floor)).not.toMatch(/payload_json|request_json|error|secret/iu);
    database.close();
  });
});
