import { clearInterval, setInterval } from 'node:timers';

import type { Clock } from '@coqui/core';
import {
  createPaperRunLoopTask,
  DesktopHost,
  recoverPaperOrdersAtStartup,
  WalletSchedulerService,
  type PaperRunLoopDependencies,
  type WalletSchedulerTask,
  type HostLifecycle,
} from '@coqui/services';
import type { Db } from '@coqui/storage';

/**
 * The wake-up the scheduler has never had.
 *
 * `WalletSchedulerService` owns cadence, leases, bounded concurrency and
 * shutdown, and its own documentation says "the composition root owns the
 * wake-up mechanism". Until now nothing did, so the whole thing was
 * unreachable. This is the missing half.
 *
 * The timer lives here rather than in a service on purpose. `packages/core` may
 * not read a clock at all, and a service that owned a timer would be
 * untestable without waiting for it — the same reason no renderer component
 * owns a `setInterval`. Everything below the composition root takes an injected
 * `Clock` and is driven.
 */

/**
 * How often to *check* for due work, not how often work runs.
 *
 * The paper task's cadence is daily and enforced by the scheduler's own UTC
 * boundaries; this only decides how promptly a due slot is noticed after a
 * launch or a resume. A minute is frequent enough that a machine woken from
 * sleep picks up the day's slot quickly, and cheap because a tick with nothing
 * due is one indexed query.
 */
const DEFAULT_POLL_MS = 60_000;

export interface SchedulerRuntimeOptions {
  readonly database: Db;
  readonly clock: Clock;
  readonly profileId: string;
  readonly hostId?: string;
  readonly paper: PaperRunLoopDependencies;
  /**
   * Runs before every tick. The decision itself is synchronous by design, so
   * anything that needs the network — refreshing bars and venue rules, taking a
   * holdings snapshot — has to happen here, outside the decision.
   */
  readonly prepare?: (nowMs: number) => Promise<void>;
  readonly pollMs?: number;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
  readonly research?: { recover():unknown; tick():Promise<void> };
  readonly parallelPaper?: { tick(): Promise<void> };
}

export interface SchedulerRuntime extends HostLifecycle {
  dispose(): void;
}

export function startSchedulerRuntime(options: SchedulerRuntimeOptions): SchedulerRuntime {
  const report = options.onUnexpectedError ?? (() => {});
  const hostId = options.hostId ?? 'desktop-main-test';

  const paperTask = createPaperRunLoopTask(options.paper);
  // The scheduler holds no task registry — tasks are passed by value to
  // ensureSchedules and to every tick, so the list is built once here.
  const tasks: readonly WalletSchedulerTask[] = [paperTask as WalletSchedulerTask];

  let scheduler: WalletSchedulerService | null = null;
  let running = false;
  const tick = async (): Promise<void> => {
    // Ticks never overlap. The scheduler bounds concurrency across profiles,
    // but nothing stops a slow tick from being re-entered by the timer.
    if (running) return;
    running = true;
    try {
      if (options.prepare !== undefined) {
        try {
          await options.prepare(options.clock.nowMs());
        } catch (error) {
          // A stale-data tick is a worse outcome than no tick only if the data
          // is missing entirely, and the engine already refuses that case.
          report('scheduler_prepare', error);
        }
      }
      await scheduler?.tick(tasks);
      if (options.parallelPaper !== undefined) await options.parallelPaper.tick();
      if (options.research !== undefined) await options.research.tick();
    } catch (error) {
      report('scheduler_tick', error);
    } finally {
      running = false;
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const host = new DesktopHost({
    hostId,
    recover() {
      try {
        recoverPaperOrdersAtStartup({
          database: options.database, clock: options.clock, profileId: options.profileId,
        });
      } catch (error) {
        report('paper_recovery', error);
      }
      try { options.research?.recover(); } catch (error) { report('research_recovery',error); }
    },
    start() {
      scheduler = new WalletSchedulerService({
        database: options.database, clock: options.clock, ownerId: hostId,
      });
      try {
        scheduler.ensureSchedules(tasks);
      } catch (error) {
        report('scheduler_ensure', error);
      }
      timer = setInterval(() => { void host.tick(); }, options.pollMs ?? DEFAULT_POLL_MS);
      timer.unref?.();
    },
    tick,
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      scheduler?.dispose();
      scheduler = null;
    },
  });
  host.start();
  return {
    start: () => host.start(),
    recover: () => host.recover(),
    tick: () => host.tick(),
    stop: () => host.stop(),
    status: () => host.status(),
    dispose: () => host.stop(),
  };
}
