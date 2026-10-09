import type { NewsHostRuntime } from './news-host-runtime.js';
import { fullApplicationArtifactHash } from './research-provenance.js';
import { clearInterval, setInterval } from 'node:timers';

import type { Clock } from '@coqui/core';
import {
  createPaperRunLoopTask,
  DesktopHost,
  recoverPaperOrdersAtStartup,
  WalletSchedulerService,
  type PaperRunLoopDependencies,
  type WalletSchedulerTask,
  type HostLifecycle, type ProfileOperationGate,
} from '@coqui/services';
import { appendRemediationEvidence, getAuthoritativeHost, listRemediationEvidence, type Db } from '@coqui/storage';

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
  readonly operationGate?: ProfileOperationGate;
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
  readonly news?: NewsHostRuntime;
  readonly research?: { recover():unknown; tick():Promise<void> };
  readonly overlayShadow?: { tick(): Promise<void> };
  readonly parallelPaper?: { tick(): Promise<void>; suspend?(): void; resume?(): void };
}

export interface SchedulerRuntime extends HostLifecycle {
  dispose(): void;
  suspend(): void;
  resume(): void;
}

export function startSchedulerRuntime(options: SchedulerRuntimeOptions): SchedulerRuntime {
  const report = options.onUnexpectedError ?? (() => {});
  const hostId = options.hostId ?? 'desktop-main-test';

  const paperTask = createPaperRunLoopTask(options.paper);
  // The scheduler holds no task registry — tasks are passed by value to
  // ensureSchedules and to every tick, so the list is built once here.
  const tasks: readonly WalletSchedulerTask[] = [paperTask as WalletSchedulerTask];

  let scheduler: WalletSchedulerService | null = null;
  let running = false, suspended = false, sequence = listRemediationEvidence(options.profileId, `host-lifecycle-v1:${hostId}`, 'launch', options.database).length * 1000000;
  const namespace = `host-lifecycle-v1:${hostId}`;
  const record = (kind: string, detail: Record<string, string | number | null> = {}) => {
    const atMs = options.clock.nowMs();
    appendRemediationEvidence({ profileId: options.profileId, namespace, kind,
      key: `${atMs}:${sequence++}`, atMs, body: { ...detail, hostId,
        generation: getAuthoritativeHost(options.profileId, options.database)?.fencingGeneration ?? 0 } }, options.database);
  };
  const prior = listRemediationEvidence(options.profileId, namespace, 'tick_finish', options.database).at(-1);
  let lastFinishedAtMs = prior?.atMs ?? options.clock.nowMs();
  const recordMissingSlots = () => {
    const now=options.clock.nowMs(), step=14_400_000;
    const recorded=new Set(listRemediationEvidence(options.profileId,namespace,'slot_outcome',options.database).map((row)=>row.key));
    for(let slot=Math.floor(lastFinishedAtMs/step)*step+step;slot+900_000<=now;slot+=step) {
      if(recorded.has(String(slot))) continue;
      appendRemediationEvidence({profileId:options.profileId,namespace,kind:'slot_outcome',key:String(slot),atMs:now,
        body:{slotMs:slot,outcome:'host_unavailable',reason:'no_recorded_host_tick',recoveredAtMs:now}},options.database);
    }
  };
  recordMissingSlots();
  try { record('launch', { artifactHash: fullApplicationArtifactHash() }); }
  catch { record('launch', { artifactHash: null, artifactReason: 'artifact_unavailable' }); }
  const tick = async (): Promise<void> => {
    // Ticks never overlap. The scheduler bounds concurrency across profiles,
    // but nothing stops a slow tick from being re-entered by the timer.
    if (running || suspended) return;
    if (options.operationGate && !options.operationGate.begin()) return;
    running = true;
    const started = performance.now();
    recordMissingSlots();
    record('tick_start');
    try { void options.news?.tick().catch(() => report('news_host_tick', new Error('News collector failed.'))); }
    catch { report('news_host_tick', new Error('News collector failed.')); }
    try {
      // The narrow Alpaca window must not wait behind local portfolio/research work.
      if (options.parallelPaper !== undefined) {
        try { await options.parallelPaper.tick(); } catch (error) { report('parallel_paper_tick', error); }
      }
      if (options.prepare !== undefined) {
        try {
          await options.prepare(options.clock.nowMs());
        } catch (error) {
          // A stale-data tick is a worse outcome than no tick only if the data
          // is missing entirely, and the engine already refuses that case.
          report('scheduler_prepare', error);
        }
      }
      if (options.overlayShadow) { try { await options.overlayShadow.tick(); } catch (error) { report('overlay_shadow_tick', error); } }
      await scheduler?.tick(tasks);
      if (options.research !== undefined) await options.research.tick();
    } catch (error) {
      report('scheduler_tick', error);
    } finally {
      record('tick_finish', { durationMs: performance.now() - started });
      lastFinishedAtMs = options.clock.nowMs();
      running = false;
      options.operationGate?.end();
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
      options.news?.resume();
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
      options.news?.suspend();
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
    dispose: () => { options.news?.dispose(); options.parallelPaper?.suspend?.(); record('shutdown'); host.stop(); },
    suspend: () => { suspended = true; options.news?.suspend(); options.parallelPaper?.suspend?.(); record('suspend'); },
    resume: () => { record('resume'); options.news?.resume(); options.parallelPaper?.resume?.(); suspended = false; void host.tick(); },
  };
}
