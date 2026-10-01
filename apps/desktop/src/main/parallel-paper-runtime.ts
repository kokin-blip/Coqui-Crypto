import { withinDeadline, createRequestDeadline, type RequestDeadline, type HttpClient, type SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import { isRecoverableParallelTransientPause, ParallelPaperService, PARALLEL_INSTRUMENTS, resolveKillSwitch } from '@coqui/services';
import { appendParallelEvent, latestParallelExperiment, listParallelEvents, parallelExperimentStatus, type Db } from '@coqui/storage';

import { createPaperMarketFeed, type PaperMarketFeedDependencies } from './paper-market.js';
import type { createMlSignalRuntime } from './ml-signal-runtime.js';

export function createParallelPaperRuntime(input: {
  readonly profileId: string;
  readonly hostId?: string;
  readonly hostKind?: 'desktop' | 'headless';
  readonly database: Db;
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly bars: PaperMarketFeedDependencies['bars'];
  readonly secrets?: SecretStore;
  readonly onUnexpectedError: (context: string, error: unknown) => void;
  readonly widerUniverse?: { refresh(): Promise<void> };
  readonly breakout?: { refresh(): Promise<void> };
  readonly rangeRotation?: { refresh(): Promise<void> };
  readonly marketSelector?: { refresh(): Promise<void> };
  readonly mlSignal?: ReturnType<typeof createMlSignalRuntime>;
}) {
  const market = createPaperMarketFeed({ database: input.database, http: input.http, now: () => input.clock.nowMs(),
    instruments: () => PARALLEL_INSTRUMENTS, bars: input.bars,
    onUnexpectedError: input.onUnexpectedError });
  const service = new ParallelPaperService({ profileId: input.profileId,
    database: input.database, clock: input.clock,
    ...(input.hostId ? { hostId: input.hostId } : {}),
    ...(input.hostKind ? { hostKind: input.hostKind } : {}),
    ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    preparation: market.preparation, refreshFor: market.refresh,
    killSwitchEngaged: () => resolveKillSwitch(input.profileId, input.database).engaged,
    ...(input.mlSignal === undefined ? {} : { mlSignal: input.mlSignal.current }) });
  return { service, suspend() { service.suspend(); }, resume() { service.resume(); },
    async tick(): Promise<void> {
      const now = input.clock.nowMs(), slot = Math.floor(now / 14_400_000) * 14_400_000;
      const deadline = createRequestDeadline(() => input.clock.nowMs(), 30_000,
        now < slot + 900_000 ? slot + 900_000 : Number.MAX_SAFE_INTEGER);
      const experiment = latestParallelExperiment(input.profileId, input.database);
      let reason: string | null = null;
      try { await withinDeadline(this.refreshIfActive(now, deadline), deadline); await service.tick(deadline); }
      catch (error) { reason = error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'paper_pass_unavailable'; }
      finally {
        if (experiment) {
          const events = listParallelEvents(experiment.id, input.profileId, input.database), status = parallelExperimentStatus(events);
          const pending = events.some((event) => event.kind === 'external_intent' &&
            !events.some((other) => other.kind === 'external_order' && other.detail['clientOrderId'] === event.detail['clientOrderId'] && other.detail['status'] === 'filled'));
          const completed = events.find((event) => (event.kind === 'external_complete' || event.kind === 'intraday_complete') &&
            event.at >= slot && event.at < slot+900_000);
          const orders = events.filter((event) => event.kind === 'submit_attempt' && event.at >= slot && event.at < slot+900_000).length;
          const pauseReason = [...events].reverse().find((event) => event.kind === 'paused')?.detail['reason'];
          reason ??= status === 'paused' && typeof pauseReason === 'string' ? pauseReason : null;
          const outcome = ['stale_host_authority','execution_lease_unavailable','host_suspended'].includes(reason ?? '') ? 'host_unavailable' : reason === 'deadline_exceeded' ? 'deadline_exceeded' : status === 'paused' ? 'paused' : pending ? 'pending_order'
            : !market.preparation().ok ? 'stale_evidence' : completed ? (orders ? 'observed' : 'no_order') : 'stale_evidence';
          appendParallelEvent({ experimentId: experiment.id, profileId: input.profileId, kind: now < slot+900_000 ? 'slot_outcome' : 'readiness_check',
            key: `slot-outcome:${slot}:${now}`, at: input.clock.nowMs(), detail: {slotMs:slot,outcome,reason,
              eligibleWindow: now < slot+900_000, deadlineAtMs:deadline.expiresAtMs} }, input.database);
        }
        deadline.dispose();
      }

      // Research acquisition cannot delay the authoritative paper pass.
      // Fetch the completed hour before the point-in-time frame timestamps the slot.
      void (async () => { await input.breakout?.refresh(); await input.widerUniverse?.refresh();
        await input.breakout?.refresh();
        await input.rangeRotation?.refresh(); await input.marketSelector?.refresh(); })()
        .catch((error: unknown) => input.onUnexpectedError('paper_research_refresh', error));
    },
    async refreshIfActive(nowMs: number, deadline?: RequestDeadline): Promise<void> {
      const experiment = latestParallelExperiment(input.profileId, input.database);
      const events = experiment === null ? [] : listParallelEvents(experiment.id, input.profileId, input.database);
      const status = parallelExperimentStatus(events);
      const latestState = [...events].reverse().find((event) =>
        ['paused', 'resumed', 'stopped', 'started'].includes(event.kind));
      if (experiment !== null && (status === 'active' ||
          (status === 'paused' && isRecoverableParallelTransientPause(latestState?.detail['reason'])))) {
        const record = (kind: string) => appendParallelEvent({ experimentId: experiment.id,
          profileId: input.profileId, kind, key: `${kind}:${nowMs}`, at: input.clock.nowMs(),
          detail: { startedAtMs: nowMs, elapsedMs: input.clock.nowMs() - nowMs } }, input.database);
        record('market_refresh_started');
        try { await market.refresh(nowMs, deadline); } finally { record('market_refresh_finished'); }

        // Historical backfill and training never hold up the daily paper order window.
        void input.mlSignal?.refresh(nowMs);
      }
    },
  };
}
