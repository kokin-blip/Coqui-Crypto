import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import {
  createOperationalMetrics,
  type MetricObservation,
} from '../packages/observability/src/index.js';
import {
  WalletSchedulerService,
  nextUtcScheduleBoundary,
  type SchedulerTaskOutcome,
  type WalletSchedulerTask,
} from '../packages/services/src/index.js';
import {
  acquireWalletScheduleLease,
  getWalletSchedule,
  openDatabase,
} from '../packages/storage/src/index.js';

const DAY_MS = 86_400_000;

function completedTask(profileId: string, execute?: WalletSchedulerTask['execute']): WalletSchedulerTask {
  return {
    profileId,
    cadenceMs: DAY_MS,
    execute: execute ?? (async () => ({ status: 'completed' })),
  };
}

describe('wallet scheduler UTC boundaries', () => {
  it('selects the first strict aligned boundary without local-time behavior', () => {
    expect(nextUtcScheduleBoundary(0, DAY_MS)).toBe(DAY_MS);
    expect(nextUtcScheduleBoundary(DAY_MS, DAY_MS)).toBe(2 * DAY_MS);
    expect(nextUtcScheduleBoundary(50, 1_000, 100)).toBe(100);
    expect(nextUtcScheduleBoundary(100, 1_000, 100)).toBe(1_100);
    expect(() => nextUtcScheduleBoundary(0, 1_000, 1_000)).toThrow(RangeError);
  });
});

describe('durable wallet scheduler service', () => {
  it('returns bounded secret-free automation health without mutating leases', () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    const observations: MetricObservation[] = [];
    const scheduler = new WalletSchedulerService({
      database,
      clock,
      ownerId: 'desktop-a',
      metrics: createOperationalMetrics({
        clock: () => clock.nowMs(),
        sink: (observation) => observations.push(observation),
      }),
    });
    const tasks = ['family-f', 'family-e', 'family-d', 'family-c', 'family-b', 'family-a']
      .map((profileId) => completedTask(profileId));
    scheduler.ensureSchedules(tasks);
    clock.set(DAY_MS);
    acquireWalletScheduleLease('family-a', 'desktop-b', DAY_MS, 100, database);
    database.prepare(`
      UPDATE wallet_schedule_lease
      SET state = 'running', owner_id = 'legacy-worker', leased_until = ?,
          error = 'raw provider diagnostic with secret'
      WHERE profile_id = 'family-c'
    `).run(DAY_MS);
    database.prepare(`
      UPDATE wallet_schedule_lease SET state = 'error', error = 'raw diagnostic: api-key-value'
      WHERE profile_id = 'family-d'
    `).run();
    database.prepare(`
      UPDATE wallet_schedule_lease SET state = 'stopped', error = 'scheduler_stopped'
      WHERE profile_id = 'family-e'
    `).run();
    database.prepare(`
      UPDATE wallet_schedule_lease SET enabled = 0 WHERE profile_id = 'family-f'
    `).run();

    const statuses = scheduler.automationStatuses();
    expect(statuses.map((status) => status.profileId)).toEqual([
      'family-a', 'family-b', 'family-c', 'family-d', 'family-e', 'family-f',
    ]);
    expect(statuses.map(({ health, reasonCode }) => ({ health, reasonCode }))).toEqual([
      { health: 'running', reasonCode: null },
      { health: 'overdue', reasonCode: null },
      { health: 'lease_expired', reasonCode: 'lease_expired' },
      { health: 'error', reasonCode: 'legacy_unverified_error' },
      { health: 'stopped', reasonCode: 'scheduler_stopped' },
      { health: 'disabled', reasonCode: null },
    ]);
    expect(statuses[0]).not.toHaveProperty('ownerId');
    expect(statuses[0]).toEqual(expect.objectContaining({
      leaseActive: true, leaseExpiresAtMs: DAY_MS + 100,
    }));
    expect(statuses[2]).toEqual(expect.objectContaining({
      leaseActive: false, leaseExpiresAtMs: null,
    }));
    expect(JSON.stringify(statuses)).not.toContain('api-key-value');
    expect(Object.isFrozen(statuses)).toBe(true);
    expect(statuses.every((status) => Object.isFrozen(status))).toBe(true);
    expect(getWalletSchedule('family-c', database)).toEqual(expect.objectContaining({
      state: 'running', ownerId: 'legacy-worker', leasedUntil: DAY_MS,
    }));
    expect(scheduler.automationStatuses(2).map((status) => status.profileId))
      .toEqual(['family-a', 'family-b']);
    expect(scheduler.automationStatus('missing-profile')).toBeNull();
    expect(() => scheduler.automationStatus('../secret')).toThrow(TypeError);
    expect(observations.every((entry) =>
      !Object.values(entry.labels).some((value) => value.startsWith('family-')),
    )).toBe(true);
    database.close();
  });

  it('registers immutable schedules and runs due work FIFO with concurrency two', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    const scheduler = new WalletSchedulerService({ database, clock, ownerId: 'desktop-a' });
    let active = 0;
    let maximumActive = 0;
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const tasks = ['family-c', 'family-a', 'family-b'].map((profileId) => completedTask(
      profileId,
      async () => new Promise((resolve) => {
        started.push(profileId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        releases.set(profileId, () => {
          active -= 1;
          resolve({ status: 'completed' });
        });
      }),
    ));

    expect(scheduler.ensureSchedules(tasks).map((row) => row.nextRunAt))
      .toEqual([DAY_MS, DAY_MS, DAY_MS]);
    expect((await scheduler.tick(tasks)).dueCount).toBe(0);
    clock.set(DAY_MS);
    const running = scheduler.tick(tasks);
    await vi.waitFor(() => expect(started).toEqual(['family-a', 'family-b']));
    expect(scheduler.status()).toEqual({ active: 2, pending: 1, disposed: false });
    releases.get('family-a')!();
    await vi.waitFor(() => expect(started).toEqual(['family-a', 'family-b', 'family-c']));
    releases.get('family-b')!();
    releases.get('family-c')!();
    const result = await running;

    expect(maximumActive).toBe(2);
    expect(result.results.map((entry) => entry.profileId))
      .toEqual(['family-a', 'family-b', 'family-c']);
    expect(result.results.map((entry) => entry.outcome))
      .toEqual(['completed', 'completed', 'completed']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.results)).toBe(true);
    expect(Object.isFrozen(result.results[0])).toBe(true);
    expect(getWalletSchedule('family-a', database)).toEqual(expect.objectContaining({
      nextRunAt: 2 * DAY_MS,
      state: 'idle',
      error: null,
    }));
    database.close();
  });

  it('uses stable reason codes and never exposes thrown diagnostics', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    const observations: MetricObservation[] = [];
    const metrics = createOperationalMetrics({
      clock: () => clock.nowMs(),
      sink: (observation) => observations.push(observation),
    });
    const scheduler = new WalletSchedulerService({
      database, clock, ownerId: 'desktop-a', metrics,
    });
    const secret = 'secret-bearing-provider-diagnostic';
    const tasks = [
      completedTask('family-a', async () => ({
        status: 'degraded', reasonCode: 'provider_stale',
      })),
      completedTask('family-b', async () => { throw new Error(secret); }),
      completedTask('family-c', async () => ({
        status: 'degraded', reasonCode: secret,
      })),
    ];
    scheduler.ensureSchedules(tasks);
    clock.set(DAY_MS);
    const result = await scheduler.tick(tasks);

    expect(result.results.map(({ outcome, reasonCode }) => ({ outcome, reasonCode }))).toEqual([
      { outcome: 'degraded', reasonCode: 'provider_stale' },
      { outcome: 'failed', reasonCode: 'task_failed' },
      { outcome: 'failed', reasonCode: 'invalid_task_outcome' },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(getWalletSchedule('family-b', database)?.error).toBe('task_failed');
    expect(observations.some((entry) => entry.name === 'scheduler_run_outcomes_total')).toBe(true);
    expect(observations.every((entry) =>
      !Object.values(entry.labels).some((value) => value.startsWith('family-')),
    )).toBe(true);
    database.close();
  });

  it('reports lease conflicts and deterministically recovers expired work', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    const scheduler = new WalletSchedulerService({
      database, clock, ownerId: 'desktop-a', leaseMs: 50,
    });
    const task = completedTask('family-a');
    scheduler.ensureSchedules([task]);
    clock.set(DAY_MS);
    acquireWalletScheduleLease('family-a', 'desktop-b', DAY_MS, 50, database);
    expect((await scheduler.tick([task])).results[0]).toEqual(expect.objectContaining({
      outcome: 'lease_unavailable', reasonCode: 'lease_unavailable',
    }));

    clock.advanceBy(50);
    const recovered = await scheduler.tick([task]);
    expect(recovered.expiredLeasesFinalized).toBe(1);
    expect(recovered.results[0]).toEqual(expect.objectContaining({ outcome: 'completed' }));
    expect(getWalletSchedule('family-a', database)?.nextRunAt).toBe(2 * DAY_MS);
    database.close();
  });

  it('does not execute one profile twice when host ticks overlap', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    const scheduler = new WalletSchedulerService({ database, clock, ownerId: 'desktop-a' });
    let release!: () => void;
    const execute = vi.fn(async () => new Promise<SchedulerTaskOutcome>((resolve) => {
      release = () => resolve({ status: 'completed' });
    }));
    const task = completedTask('family-a', execute);
    scheduler.ensureSchedules([task]);
    clock.set(DAY_MS);

    const first = scheduler.tick([task]);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const overlapping = await scheduler.tick([task]);
    expect(overlapping.results[0]).toEqual(expect.objectContaining({
      outcome: 'lease_unavailable',
    }));
    expect(execute).toHaveBeenCalledOnce();
    release();
    expect((await first).results[0]?.outcome).toBe('completed');
    database.close();
  });

  it('cancels active and queued work idempotently without advancing canceled schedules', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    const scheduler = new WalletSchedulerService({ database, clock, ownerId: 'desktop-a' });
    const started: string[] = [];
    const tasks = ['family-a', 'family-b', 'family-c'].map((profileId) => completedTask(
      profileId,
      async ({ signal }) => new Promise((resolve) => {
        started.push(profileId);
        signal.addEventListener('abort', () => resolve({ status: 'completed' }), { once: true });
      }),
    ));
    scheduler.ensureSchedules(tasks);
    clock.set(DAY_MS);
    const running = scheduler.tick(tasks);
    await vi.waitFor(() => expect(started).toEqual(['family-a', 'family-b']));
    scheduler.dispose();
    scheduler.dispose();
    const result = await running;

    expect(result.results.map((entry) => entry.outcome))
      .toEqual(['canceled', 'canceled', 'canceled']);
    expect(started).toEqual(['family-a', 'family-b']);
    expect(getWalletSchedule('family-a', database)).toEqual(expect.objectContaining({
      nextRunAt: DAY_MS, state: 'stopped', error: 'scheduler_stopped',
    }));
    expect(getWalletSchedule('family-c', database)).toEqual(expect.objectContaining({
      nextRunAt: DAY_MS, state: 'idle', error: null,
    }));
    expect(scheduler.status()).toEqual({ active: 0, pending: 0, disposed: true });
    await expect(scheduler.tick(tasks)).rejects.toThrow('disposed');
    database.close();
  });

  it('validates the complete task set before mutation and never reads keychain-like extras', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(0);
    let keychainReads = 0;
    const dependencies = {
      database,
      clock,
      ownerId: 'desktop-a',
      get keychain() {
        keychainReads += 1;
        throw new Error('scheduler must not read credentials');
      },
    };
    const scheduler = new WalletSchedulerService(dependencies);
    expect(() => scheduler.ensureSchedules([
      completedTask('family-a'),
      completedTask('family-a'),
    ])).toThrow('unique');
    expect(getWalletSchedule('family-a', database)).toBeNull();

    const task = completedTask('family-a');
    scheduler.ensureSchedules([task]);
    clock.set(DAY_MS);
    await scheduler.tick([task]);
    expect(keychainReads).toBe(0);
    database.close();
  });
});
