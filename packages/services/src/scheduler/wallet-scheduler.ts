import { createSemaphore, type Clock, type Semaphore } from '@coqui/core';
import { NOOP_METRICS, type OperationalMetrics } from '@coqui/observability';
import {
  acquireWalletScheduleLease,
  ensureWalletUtcSchedule,
  finalizeExpiredWalletScheduleLeases,
  getWalletSchedule,
  listDueWalletSchedules,
  listWalletSchedules,
  releaseWalletScheduleLease,
  type Db,
  type StoredWalletScheduleLease,
} from '@coqui/storage';

const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const MAX_DUE_PER_TICK = 1_000;
const DEFAULT_LEASE_MS = 5 * 60 * 1_000;
const SCHEDULER_CONCURRENCY = 2;

export type SchedulerTaskStatus = 'completed' | 'degraded';

export interface SchedulerTaskOutcome {
  readonly status: SchedulerTaskStatus;
  readonly reasonCode?: string;
}

export interface SchedulerTaskContext {
  readonly profileId: string;
  readonly scheduledForMs: number;
  readonly startedAtMs: number;
  readonly signal: AbortSignal;
}

export interface WalletSchedulerTask {
  readonly profileId: string;
  readonly cadenceMs: number;
  readonly utcOffsetMs?: number;
  execute(context: SchedulerTaskContext): Promise<SchedulerTaskOutcome>;
}

export type SchedulerRunOutcome =
  | 'completed'
  | 'degraded'
  | 'failed'
  | 'canceled'
  | 'lease_unavailable'
  | 'lease_lost';

export interface SchedulerRunResult {
  readonly profileId: string;
  readonly scheduledForMs: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly outcome: SchedulerRunOutcome;
  readonly reasonCode: string | null;
}

export interface SchedulerTickResult {
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly expiredLeasesFinalized: number;
  readonly dueCount: number;
  readonly results: readonly SchedulerRunResult[];
}

export type WalletAutomationHealth =
  | 'scheduled'
  | 'running'
  | 'overdue'
  | 'lease_expired'
  | 'stopped'
  | 'error'
  | 'disabled';

export interface WalletAutomationStatus {
  readonly profileId: string;
  readonly asOfMs: number;
  readonly cadenceMs: number;
  readonly utcOffsetMs: number;
  readonly nextRunAtMs: number;
  readonly lastRunAtMs: number | null;
  readonly health: WalletAutomationHealth;
  readonly leaseActive: boolean;
  readonly leaseExpiresAtMs: number | null;
  readonly reasonCode: string | null;
}

export interface WalletSchedulerDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly ownerId: string;
  readonly metrics?: OperationalMetrics;
  readonly leaseMs?: number;
}

interface ValidatedTask {
  readonly profileId: string;
  readonly cadenceMs: number;
  readonly utcOffsetMs: number;
  execute(context: SchedulerTaskContext): Promise<SchedulerTaskOutcome>;
}

function safeTime(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe epoch millisecond.`);
  }
  return value;
}

function validateTasks(tasks: readonly WalletSchedulerTask[]): readonly ValidatedTask[] {
  const seen = new Set<string>();
  return Object.freeze(tasks.map((task) => {
    const offset = task.utcOffsetMs ?? 0;
    if (!STABLE_ID.test(task.profileId)) {
      throw new TypeError('Scheduler profiles require stable lowercase identifiers.');
    }
    if (seen.has(task.profileId)) {
      throw new TypeError('Scheduler profiles must be unique within a task set.');
    }
    seen.add(task.profileId);
    if (!Number.isSafeInteger(task.cadenceMs) || task.cadenceMs <= 0) {
      throw new RangeError('Scheduler cadence must be a positive safe duration.');
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= task.cadenceMs) {
      throw new RangeError('Scheduler UTC offset must be within its cadence.');
    }
    if (typeof task.execute !== 'function') {
      throw new TypeError('Scheduler tasks require an execute function.');
    }
    return Object.freeze({
      profileId: task.profileId,
      cadenceMs: task.cadenceMs,
      utcOffsetMs: offset,
      execute: task.execute.bind(task),
    });
  }));
}

/** Return the first exact UTC cadence boundary strictly after a timestamp. */
export function nextUtcScheduleBoundary(
  afterMs: number,
  cadenceMs: number,
  utcOffsetMs = 0,
): number {
  safeTime(afterMs, 'Schedule time');
  if (!Number.isSafeInteger(cadenceMs) || cadenceMs <= 0) {
    throw new RangeError('Schedule cadence must be a positive safe duration.');
  }
  if (!Number.isSafeInteger(utcOffsetMs) || utcOffsetMs < 0 || utcOffsetMs >= cadenceMs) {
    throw new RangeError('Schedule UTC offset must be within its cadence.');
  }
  if (afterMs < utcOffsetMs) return utcOffsetMs;
  const periods = Math.floor((afterMs - utcOffsetMs) / cadenceMs) + 1;
  return safeTime(utcOffsetMs + periods * cadenceMs, 'Next schedule time');
}

function frozenRun(result: SchedulerRunResult): SchedulerRunResult {
  return Object.freeze(result);
}

function taskOutcome(value: SchedulerTaskOutcome): SchedulerTaskOutcome | null {
  if (!value || (value.status !== 'completed' && value.status !== 'degraded')) return null;
  if (value.status === 'completed' && value.reasonCode !== undefined) return null;
  if (value.status === 'degraded' && !REASON_CODE.test(value.reasonCode ?? '')) return null;
  return value;
}

function automationStatus(
  schedule: StoredWalletScheduleLease,
  asOfMs: number,
): WalletAutomationStatus {
  const leaseActive = schedule.ownerId !== null && schedule.leasedUntil !== null &&
    schedule.leasedUntil > asOfMs;
  const health: WalletAutomationHealth = !schedule.enabled
    ? 'disabled'
    : leaseActive
      ? 'running'
      : schedule.state === 'running'
        ? 'lease_expired'
        : schedule.state === 'error'
          ? 'error'
          : schedule.state === 'stopped'
            ? 'stopped'
            : schedule.nextRunAt <= asOfMs
              ? 'overdue'
              : 'scheduled';
  const storedReason = REASON_CODE.test(schedule.error ?? '') ? schedule.error : null;
  const reasonCode = health === 'lease_expired'
    ? 'lease_expired'
    : health === 'error' || health === 'stopped'
      ? storedReason ?? 'legacy_unverified_error'
      : null;
  return Object.freeze({
    profileId: schedule.profileId,
    asOfMs,
    cadenceMs: schedule.cadenceMs,
    utcOffsetMs: schedule.utcOffsetMs,
    nextRunAtMs: schedule.nextRunAt,
    lastRunAtMs: schedule.lastRunAt,
    health,
    leaseActive,
    leaseExpiresAtMs: leaseActive ? schedule.leasedUntil : null,
    reasonCode,
  });
}

/**
 * Durable, host-driven wallet scheduler. The composition root owns the wake-up
 * mechanism; this service owns cadence, leases, bounded concurrency and shutdown.
 */
export class WalletSchedulerService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #ownerId: string;
  readonly #metrics: OperationalMetrics;
  readonly #leaseMs: number;
  readonly #semaphore: Semaphore = createSemaphore(SCHEDULER_CONCURRENCY);
  readonly #shutdown = new AbortController();
  #disposed = false;

  constructor(dependencies: WalletSchedulerDependencies) {
    if (!STABLE_ID.test(dependencies.ownerId)) {
      throw new TypeError('Scheduler owner requires a stable lowercase identifier.');
    }
    const leaseMs = dependencies.leaseMs ?? DEFAULT_LEASE_MS;
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new RangeError('Scheduler lease duration must be a positive safe duration.');
    }
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#ownerId = dependencies.ownerId;
    this.#metrics = (dependencies.metrics ?? NOOP_METRICS).child({ component: 'wallet_scheduler' });
    this.#leaseMs = leaseMs;
  }

  /** Validate the full task set before persisting any immutable cadence policy. */
  ensureSchedules(tasks: readonly WalletSchedulerTask[]): readonly StoredWalletScheduleLease[] {
    if (this.#disposed) throw new Error('Wallet scheduler is disposed.');
    const validated = validateTasks(tasks);
    const now = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    return Object.freeze(validated.map((task) => ensureWalletUtcSchedule(
      task.profileId,
      task.cadenceMs,
      task.utcOffsetMs,
      nextUtcScheduleBoundary(now, task.cadenceMs, task.utcOffsetMs),
      this.#database,
    )));
  }

  /** Read one secret-free status without acquiring, finalizing, or changing a lease. */
  automationStatus(profileId: string): WalletAutomationStatus | null {
    if (!STABLE_ID.test(profileId)) {
      throw new TypeError('Scheduler profiles require stable lowercase identifiers.');
    }
    const asOfMs = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    const schedule = getWalletSchedule(profileId, this.#database);
    const result = schedule ? automationStatus(schedule, asOfMs) : null;
    this.#recordStatusQuery(result ? [result] : [], result === null ? 'empty' : 'found');
    return result;
  }

  /** Read a bounded deterministic multi-profile status view. */
  automationStatuses(limit = 100): readonly WalletAutomationStatus[] {
    const asOfMs = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    const result = Object.freeze(
      listWalletSchedules(limit, this.#database).map((schedule) =>
        automationStatus(schedule, asOfMs)),
    );
    this.#recordStatusQuery(result, result.length === 0 ? 'empty' : 'found');
    return result;
  }

  async tick(tasks: readonly WalletSchedulerTask[]): Promise<SchedulerTickResult> {
    if (this.#disposed) throw new Error('Wallet scheduler is disposed.');
    const validated = validateTasks(tasks);
    const taskByProfile = new Map(validated.map((task) => [task.profileId, task]));
    const startedAtMs = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    const expiredLeasesFinalized = finalizeExpiredWalletScheduleLeases(startedAtMs, this.#database);
    const due = listDueWalletSchedules(startedAtMs, MAX_DUE_PER_TICK, this.#database)
      .filter((schedule) => taskByProfile.has(schedule.profileId));

    this.#metrics.gauge('scheduler_due_jobs', due.length);
    this.#metrics.gauge('scheduler_active_jobs', this.#semaphore.active());
    this.#metrics.gauge('scheduler_queue_depth', this.#semaphore.pending());
    if (expiredLeasesFinalized > 0) {
      this.#metrics.counter('scheduler_expired_leases_total', expiredLeasesFinalized);
    }

    const results = await Promise.all(due.map((schedule) => this.#semaphore.run(async () => {
      const task = taskByProfile.get(schedule.profileId)!;
      return this.#runOne(task, schedule);
    })));
    const completedAtMs = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    return Object.freeze({
      startedAtMs,
      completedAtMs,
      expiredLeasesFinalized,
      dueCount: due.length,
      results: Object.freeze(results),
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#shutdown.abort('scheduler_stopped');
  }

  status(): Readonly<{ active: number; pending: number; disposed: boolean }> {
    return Object.freeze({
      active: this.#semaphore.active(),
      pending: this.#semaphore.pending(),
      disposed: this.#disposed,
    });
  }

  async #runOne(
    task: ValidatedTask,
    schedule: StoredWalletScheduleLease,
  ): Promise<SchedulerRunResult> {
    const startedAtMs = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    if (this.#disposed) {
      return this.#record(frozenRun({
        profileId: task.profileId,
        scheduledForMs: schedule.nextRunAt,
        startedAtMs,
        completedAtMs: startedAtMs,
        outcome: 'canceled',
        reasonCode: 'scheduler_stopped',
      }));
    }
    const lease = acquireWalletScheduleLease(
      task.profileId,
      this.#ownerId,
      startedAtMs,
      this.#leaseMs,
      this.#database,
    );
    if (!lease) {
      return this.#record(frozenRun({
        profileId: task.profileId,
        scheduledForMs: schedule.nextRunAt,
        startedAtMs,
        completedAtMs: startedAtMs,
        outcome: 'lease_unavailable',
        reasonCode: 'lease_unavailable',
      }));
    }

    let outcome: SchedulerRunOutcome = 'failed';
    let reasonCode: string | null = 'task_failed';
    try {
      const returned = taskOutcome(await task.execute(Object.freeze({
        profileId: task.profileId,
        scheduledForMs: lease.nextRunAt,
        startedAtMs,
        signal: this.#shutdown.signal,
      })));
      if (this.#shutdown.signal.aborted) {
        outcome = 'canceled';
        reasonCode = 'scheduler_stopped';
      } else if (returned === null) {
        reasonCode = 'invalid_task_outcome';
      } else {
        outcome = returned.status;
        reasonCode = returned.reasonCode ?? null;
      }
    } catch {
      if (this.#shutdown.signal.aborted) {
        outcome = 'canceled';
        reasonCode = 'scheduler_stopped';
      }
    }

    const completedAtMs = safeTime(this.#clock.nowMs(), 'Scheduler clock');
    const nextRunAt = outcome === 'canceled'
      ? lease.nextRunAt
      : nextUtcScheduleBoundary(
        Math.max(completedAtMs, lease.nextRunAt),
        lease.cadenceMs,
        lease.utcOffsetMs,
      );
    const released = releaseWalletScheduleLease(
      task.profileId,
      this.#ownerId,
      nextRunAt,
      outcome === 'failed' ? 'error' : outcome === 'canceled' ? 'stopped' : 'idle',
      reasonCode,
      completedAtMs,
      this.#database,
    );
    if (!released) {
      outcome = 'lease_lost';
      reasonCode = 'lease_lost';
    }
    return this.#record(frozenRun({
      profileId: task.profileId,
      scheduledForMs: lease.nextRunAt,
      startedAtMs,
      completedAtMs,
      outcome,
      reasonCode,
    }));
  }

  #record(result: SchedulerRunResult): SchedulerRunResult {
    this.#metrics.counter('scheduler_run_outcomes_total', 1, { outcome: result.outcome });
    this.#metrics.histogram(
      'scheduler_run_lag_ms',
      Math.max(0, result.startedAtMs - result.scheduledForMs),
      { outcome: result.outcome },
    );
    return result;
  }

  #recordStatusQuery(
    statuses: readonly WalletAutomationStatus[],
    outcome: 'empty' | 'found',
  ): void {
    this.#metrics.counter('scheduler_status_queries_total', 1, { outcome });
    this.#metrics.gauge('scheduler_profiles', statuses.length);
    this.#metrics.gauge(
      'scheduler_active_leases',
      statuses.filter((status) => status.leaseActive).length,
    );
    this.#metrics.gauge(
      'scheduler_unhealthy_profiles',
      statuses.filter((status) =>
        status.health === 'error' || status.health === 'lease_expired').length,
    );
  }
}
