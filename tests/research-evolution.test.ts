import { describe, expect, it } from 'vitest';
import { evaluatePromotionEligibility, type EvolutionMetricsV1, type EvolutionPolicyV1 } from '../packages/core/src/index.js';
import { EvolutionCoordinator, ResearchTriggerCoordinator } from '../packages/services/src/index.js';
import { getResearchTrigger, listResearchLineage, openDatabase } from '../packages/storage/src/index.js';

const metrics: EvolutionMetricsV1 = { oosReturnPct: 8, walkForwardPassRate: 0.8,
  stressReturnPct: 1, maxDrawdownPct: 12, turnoverPct: 30,
  significanceProbability: 0.95, stabilityScore: 0.8, trialCount: 10 };
const policy: EvolutionPolicyV1 = { minimumOosReturnPct: 1, minimumWalkForwardPassRate: 0.6,
  minimumStressReturnPct: 0, maximumDrawdownPct: 20, maximumTurnoverPct: 50,
  minimumSignificanceProbability: 0.9, minimumStabilityScore: 0.7, maximumTrialCount: 20 };

describe('host-owned research evolution', () => {
  it('applies every blocker deterministically', () => {
    expect(evaluatePromotionEligibility(metrics, policy)).toEqual({ eligible: true, blockers: [] });
    const failed = evaluatePromotionEligibility({ oosReturnPct: -1, walkForwardPassRate: 0,
      stressReturnPct: -2, maxDrawdownPct: 50, turnoverPct: 100,
      significanceProbability: 0.1, stabilityScore: 0.1, trialCount: 30 }, policy);
    expect(failed.blockers).toEqual(['oos_failed','walk_forward_failed','stress_failed','drawdown_failed',
      'turnover_failed','significance_failed','stability_failed','trial_budget_failed']);
  });

  it('keeps the champion unchanged until human approval and supports rollback lineage', () => {
    const database = openDatabase(':memory:'), evolution = new EvolutionCoordinator(database);
    const first = evolution.evaluate({ family: 'trendvol', strategyVersion: 'v1', evidenceId: 'e1',
      evidenceHash: 'a'.repeat(64), metrics, policy, createdAt: 1 });
    expect(first.state).toBe('promotion_eligible');
    expect(evolution.champion('trendvol')).toBeNull();
    expect(() => evolution.approve(first.id, '', 2)).toThrow('human approval');
    expect(evolution.approve(first.id, 'owner-ticket-1', 2).candidateId).toBe(first.id);
    const rejected = evolution.evaluate({ family: 'trendvol', strategyVersion: 'v2', parentId: first.id,
      evidenceId: 'e2', evidenceHash: 'b'.repeat(64), metrics: { ...metrics, stressReturnPct: -10 },
      policy, createdAt: 3 });
    expect(rejected.state).toBe('rejected');
    expect(() => evolution.approve(rejected.id, 'owner-ticket-2', 4)).toThrow('not promotion eligible');
    expect(() => evolution.rollback(rejected.id, 'owner-ticket-2', 4)).toThrow('never an active champion');
    expect(evolution.champion('trendvol')?.candidateId).toBe(first.id);
    const second = evolution.evaluate({ family: 'trendvol', strategyVersion: 'v3', parentId: first.id,
      evidenceId: 'e3', evidenceHash: 'c'.repeat(64), metrics, policy, createdAt: 5 });
    evolution.approve(second.id, 'owner-ticket-3', 6);
    const rolledBack = evolution.rollback(first.id, 'owner-ticket-4', 7);
    expect(rolledBack).toMatchObject({ candidateId: first.id, fencingGeneration: 3 });
    expect((database.prepare('SELECT action FROM research_activation_history_v1 ORDER BY at').all() as { action: string }[])
      .map((row) => row.action)).toEqual(['activate', 'activate', 'rollback']);
    expect(listResearchLineage(10, database)).toEqual([
      expect.objectContaining({ candidateId: second.id, parentId: first.id, active: false }),
      expect.objectContaining({ candidateId: rejected.id, parentId: first.id, active: false }),
      expect.objectContaining({ candidateId: first.id, parentId: null, active: true,
        activationId: rolledBack.activationId, activatedAtMs: 7 }),
    ]);
    expect(() => listResearchLineage(101, database)).toThrow('Invalid lineage limit');
    database.close();
  });

  it('rejects exploratory paper evidence before candidate scoring', () => {
    const database = openDatabase(':memory:'), evolution = new EvolutionCoordinator(database);
    expect(() => evolution.evaluate({ family: 'trendvol',
      strategyVersion: 'trendvol-exploratory-paper-v1', evidenceId: 'paper-decision',
      evidenceHash: 'd'.repeat(64), metrics, policy, createdAt: 1 }))
      .toThrow('ineligible for research promotion');
    expect(listResearchLineage(10, database)).toEqual([]);
    database.close();
  });
});

describe('research trigger coordinator', () => {
  it('debounces events and enforces cooldown, duration, and trial budget', () => {
    const database = openDatabase(':memory:'), coordinator = new ResearchTriggerCoordinator(database);
    coordinator.configure({ id: 'vol-shift', family: 'trendvol', kind: 'event', debounceMs: 100,
      cooldownMs: 1_000, maxDurationMs: 5_000, trialBudget: 3, updatedAt: 0 });
    expect(coordinator.request('vol-shift', 2, 10)).toMatchObject({ start: false, reasonCode: 'debouncing' });
    expect(coordinator.request('vol-shift', 2, 50)).toMatchObject({ start: false, reasonCode: 'debouncing' });
    expect(coordinator.request('vol-shift', 2, 110)).toEqual({ start: true, reasonCode: 'started', deadlineAt: 5_110 });
    expect(coordinator.request('vol-shift', 1, 200).reasonCode).toBe('cooldown');
    expect(coordinator.request('vol-shift', 2, 2_000).reasonCode).toBe('trial_budget_exhausted');
    expect(getResearchTrigger('vol-shift', database)).toMatchObject({ trialsUsed: 2, lastTriggeredAt: 110 });
    database.close();
  });
});
