import { describe, expect, it } from 'vitest';

import {
  evaluateForwardEdgeResult,
  forwardEdgeDeflatedSharpeProbability,
  forwardEdgeLowerConfidenceBoundPct,
  scoreForwardEdgeEvent,
  type ForwardEdgeStudyResult,
} from '../packages/core/src/index.js';
import {
  activateProfitabilityEstimate,
  openDatabase,
  readProfitabilityEstimateEvidence,
  recordForwardEdgeStudyResult,
  registerForwardEdgeStudy,
} from '../packages/storage/src/index.js';
import { SHIPPED_FORWARD_EDGE_PLAN } from '../apps/desktop/src/main/forward-edge-plan.js';

const SOURCE = 'a'.repeat(64);

function passing(planHash: string): ForwardEdgeStudyResult {
  return evaluateForwardEdgeResult({
    planHash,
    completedDays: 365,
    costBearingRebalances: 30,
    completeValuations: true,
    grossEdgeLowerConfidenceBoundPct: 3,
    netEdgeLowerConfidenceBoundPct: 1,
    excessVsHoldPct: 2,
    excessVsPassivePct: 1,
    deflatedSharpeProbability: 0.95,
    maximumDrawdownPct: 35,
    sourceHashes: [SOURCE],
  });
}

describe('prospective edge scoring', () => {
  it('subtracts recorded execution costs exactly once', () => {
    expect(scoreForwardEdgeEvent({
      atMs: 1, turnoverUsd: '100', actualEndingEquityUsd: '109',
      noTradeEndingEquityUsd: '100', recordedCostUsd: '4',
      valuationComplete: true, stateHash: SOURCE,
    })).toEqual({ grossEdgePct: '13', costPct: '4', netEdgePct: '9' });
  });

  it('rejects incomplete valuations and incomplete samples', () => {
    expect(scoreForwardEdgeEvent({
      atMs: 1, turnoverUsd: '100', actualEndingEquityUsd: '109',
      noTradeEndingEquityUsd: '100', recordedCostUsd: '4',
      valuationComplete: false, stateHash: SOURCE,
    })).toBeNull();
    expect(evaluateForwardEdgeResult({ ...passing(SOURCE), completedDays: 364 }).outcome)
      .toBe('incomplete');
  });

  it('requires every registered adoption threshold', () => {
    expect(passing(SOURCE).outcome).toBe('passed');
    expect(evaluateForwardEdgeResult({
      ...passing(SOURCE), netEdgeLowerConfidenceBoundPct: 0,
    }).outcome).toBe('failed');
    expect(evaluateForwardEdgeResult({
      ...passing(SOURCE), deflatedSharpeProbability: 0.949,
    }).outcome).toBe('failed');
    expect(evaluateForwardEdgeResult({
      ...passing(SOURCE), maximumDrawdownPct: 35.01,
    }).outcome).toBe('failed');
  });

  it('uses deterministic block bootstrap and the registered trial upper bound', () => {
    const edges = Array.from({ length: 40 }, (_, index) => 1 + (index % 3) / 10);
    expect(forwardEdgeLowerConfidenceBoundPct(edges, 42))
      .toBe(forwardEdgeLowerConfidenceBoundPct(edges, 42));
    const dsr = forwardEdgeDeflatedSharpeProbability(
      Array.from({ length: 365 }, (_, index) => 0.002 + (index % 5) * 0.0001),
      [0.01, 0.02, 0.03],
    );
    expect(dsr).not.toBeNull();
    expect(dsr).toBeGreaterThanOrEqual(0);
    expect(dsr).toBeLessThanOrEqual(1);
  });
});

describe('migration 49 evidence authority', () => {
  it('keeps plans immutable and ignores the predecessor manual setting', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('paper.net_edge_estimate_pct', '99')").run();
    expect(readProfitabilityEstimateEvidence('main', db)).toBeNull();
    expect(() => db.prepare('UPDATE forward_edge_study_plans_v1 SET code_revision = ? WHERE plan_hash = ?')
      .run('tampered', planHash)).toThrow('immutable');
    db.close();
  });

  it('activates only an integrity-verified passing result and remains profile scoped', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    const resultHash = recordForwardEdgeStudyResult(passing(planHash), 2_000_000_000_000, true, db);
    activateProfitabilityEstimate({ profileId: 'alpha', resultHash, commandId: 'activate-1',
      activatedAt: 2_000_000_000_001 }, db);
    expect(readProfitabilityEstimateEvidence('alpha', db)?.grossEdgeLowerBoundPct).toBe(3);
    expect(readProfitabilityEstimateEvidence('beta', db)).toBeNull();
    expect(() => activateProfitabilityEstimate({ profileId: 'beta', resultHash,
      commandId: 'activate-1', activatedAt: 2_000_000_000_002 }, db))
      .toThrow('command_conflict');
    db.close();
  });

  it('refuses failed or integrity-unverified results', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    const resultHash = recordForwardEdgeStudyResult(passing(planHash), 2_000_000_000_000, false, db);
    expect(() => activateProfitabilityEstimate({ profileId: 'main', resultHash,
      commandId: 'activate-2', activatedAt: 2_000_000_000_001 }, db))
      .toThrow('not_eligible');
    db.close();
  });
});
