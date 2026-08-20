import { describe, expect, it } from 'vitest';

import {
  acknowledgeWalletSafetyStop,
  acquireWalletScheduleLease,
  activateWalletSafetyStop,
  appendRuntimeIncident,
  appendWalletRunAudit,
  ensureWalletSchedule,
  ensureWalletUtcSchedule,
  finalizeExpiredWalletScheduleLeases,
  getWalletDecisionRun,
  getWalletRiskState,
  getWalletSafetyStop,
  listRuntimeIncidents,
  listDueWalletSchedules,
  listWalletSchedules,
  listWalletRunAudits,
  listWalletSafetyStopEvents,
  openDatabase,
  releaseWalletScheduleLease,
  saveWalletDecisionRun,
  saveWalletRiskState,
} from '../packages/storage/src/index.js';

describe('wallet scheduler and risk persistence', () => {
  it('provides an owner-bound lease and isolates profiles', () => {
    const database = openDatabase(':memory:');
    ensureWalletSchedule('family-a', 100, database);
    ensureWalletSchedule('family-b', 100, database);
    expect(acquireWalletScheduleLease('family-a', 'worker-a', 100, 50, database)?.ownerId)
      .toBe('worker-a');
    expect(acquireWalletScheduleLease('family-a', 'worker-a', 101, 50, database)).toBeNull();
    expect(acquireWalletScheduleLease('family-a', 'worker-b', 101, 50, database)).toBeNull();
    expect(acquireWalletScheduleLease('family-b', 'worker-b', 101, 50, database)?.ownerId)
      .toBe('worker-b');
    expect(releaseWalletScheduleLease('family-a', 'wrong-worker', 200, 'idle', null, 110, database))
      .toBe(false);
    expect(releaseWalletScheduleLease('family-a', 'worker-a', 200, 'idle', null, 110, database))
      .toBe(true);
    database.close();
  });

  it('persists immutable UTC cadence and recovers expired leases idempotently', () => {
    const database = openDatabase(':memory:');
    ensureWalletUtcSchedule('family-b', 1_000, 100, 1_100, database);
    ensureWalletUtcSchedule('family-a', 1_000, 100, 1_100, database);
    expect(ensureWalletUtcSchedule('family-a', 1_000, 100, 1_100, database)).toEqual(
      expect.objectContaining({ cadenceMs: 1_000, utcOffsetMs: 100, enabled: true }),
    );
    expect(() => ensureWalletUtcSchedule('family-a', 2_000, 100, 2_100, database))
      .toThrow('immutable');
    expect(listDueWalletSchedules(1_100, 10, database).map((row) => row.profileId))
      .toEqual(['family-a', 'family-b']);
    expect(listWalletSchedules(1, database).map((row) => row.profileId)).toEqual(['family-a']);
    expect(() => listWalletSchedules(1_001, database)).toThrow('[1, 1000]');

    expect(acquireWalletScheduleLease('family-a', 'worker-a', 1_100, 50, database)?.state)
      .toBe('running');
    expect(finalizeExpiredWalletScheduleLeases(1_149, database)).toBe(0);
    expect(finalizeExpiredWalletScheduleLeases(1_150, database)).toBe(1);
    expect(finalizeExpiredWalletScheduleLeases(1_150, database)).toBe(0);
    expect(listDueWalletSchedules(1_150, 1, database)).toEqual([
      expect.objectContaining({ profileId: 'family-a', error: 'lease_expired', ownerId: null }),
    ]);
    database.close();
  });

  it('round-trips risk peaks as exact decimals and locks decision snapshots', () => {
    const database = openDatabase(':memory:');
    saveWalletRiskState({
      profileId: 'family-a', stage: 'normal', dailyPeakUsd: '123.456789123456789',
      rollingPeakUsd: null, lifetimePeakUsd: '999.000000000000001', hardStopped: false,
      reason: null, updatedAt: 1,
    }, database);
    expect(getWalletRiskState('family-a', database)).toEqual({
      profileId: 'family-a', stage: 'normal', dailyPeakUsd: '123.456789123456789',
      rollingPeakUsd: null, lifetimePeakUsd: '999.000000000000001', hardStopped: false,
      reason: null, updatedAt: 1,
    });
    const decision = {
      id: 'decision-1', profileId: 'family-a', scheduledFor: 100,
      strategyVersion: 'v1', snapshotHash: 'hash', snapshotJson: '{"paperOnly":true}',
      status: 'prepared' as const, createdAt: 1, updatedAt: 1, error: null,
    };
    saveWalletDecisionRun(decision, database);
    expect(() => saveWalletDecisionRun({ ...decision, snapshotHash: 'changed' }, database))
      .toThrow('immutable');
    expect(getWalletDecisionRun(decision.id, database)).toEqual(decision);
    database.close();
  });
});

describe('append-only wallet audit trail', () => {
  it('records safety-stop activation and explicit acknowledgement events', () => {
    const database = openDatabase(':memory:');
    const stop = activateWalletSafetyStop({
      eventId: 'stop-1', profileId: 'family-a', kind: 'drawdown',
      reason: 'Daily drawdown limit reached.', at: 10, runId: 'run-1',
    }, database);
    expect(stop.active).toBe(true);
    expect(activateWalletSafetyStop({
      eventId: 'stop-1', profileId: 'family-a', kind: 'drawdown',
      reason: 'Daily drawdown limit reached.', at: 10, runId: 'run-1',
    }, database)).toEqual(stop);
    expect(() => activateWalletSafetyStop({
      eventId: 'stop-1', profileId: 'family-b', kind: 'other', reason: 'Changed.', at: 11,
    }, database)).toThrow('identity cannot change');
    acknowledgeWalletSafetyStop({
      eventId: 'ack-1', profileId: 'family-a', reason: 'Reviewed and accepted.', at: 20,
    }, database);
    expect(getWalletSafetyStop('family-a', database)?.active).toBe(false);
    expect(listWalletSafetyStopEvents('family-a', 10, database).map((event) => event.action))
      .toEqual(['acknowledged', 'activated']);
    database.close();
  });

  it('accepts exact retries but rejects conflicting audit and incident identities', () => {
    const database = openDatabase(':memory:');
    const audit = {
      id: 'audit-1', profileId: 'family-a', runId: 'run-1', at: 1,
      kind: 'decision', status: 'paper', detailJson: '{"paperOnly":true}',
    };
    expect(appendWalletRunAudit(audit, database)).toBe(true);
    expect(appendWalletRunAudit(audit, database)).toBe(false);
    expect(() => appendWalletRunAudit({ ...audit, status: 'changed' }, database))
      .toThrow('identity cannot change');
    expect(listWalletRunAudits('family-a', 10, database)).toEqual([audit]);

    const incident = {
      id: 'incident-1', profileId: 'family-a', runId: 'run-1',
      kind: 'provider_invalid' as const, severity: 'blocking' as const,
      source: 'coingecko', detailJson: '{"reason":"stale"}', occurredAt: 2,
      resolvedAt: null, resolution: null,
    };
    expect(appendRuntimeIncident(incident, database)).toBe(true);
    expect(appendRuntimeIncident(incident, database)).toBe(false);
    expect(() => appendRuntimeIncident({ ...incident, severity: 'critical' }, database))
      .toThrow('identity cannot change');
    expect(listRuntimeIncidents('family-a', true, 10, database)).toEqual([incident]);
    database.close();
  });
});
