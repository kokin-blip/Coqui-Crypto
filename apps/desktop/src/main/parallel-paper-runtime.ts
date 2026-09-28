import type { HttpClient, SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import { isRecoverableParallelTransientPause, ParallelPaperService, PARALLEL_INSTRUMENTS, resolveKillSwitch } from '@coqui/services';
import { appendParallelEvent, latestParallelExperiment, listParallelEvents, parallelExperimentStatus, type Db } from '@coqui/storage';

import { createPaperMarketFeed, type PaperMarketFeedDependencies } from './paper-market.js';
import type { createMlSignalRuntime } from './ml-signal-runtime.js';

export function createParallelPaperRuntime(input: {
  readonly profileId: string;
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
  const market = createPaperMarketFeed({ database: input.database, http: input.http,
    instruments: () => PARALLEL_INSTRUMENTS, bars: input.bars,
    onUnexpectedError: input.onUnexpectedError });
  const service = new ParallelPaperService({ profileId: input.profileId,
    database: input.database, clock: input.clock,
    ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    preparation: market.preparation, refreshFor: market.refresh,
    killSwitchEngaged: () => resolveKillSwitch(input.profileId, input.database).engaged,
    ...(input.mlSignal === undefined ? {} : { mlSignal: input.mlSignal.current }) });
  return { service,
    async tick(): Promise<void> {
      await this.refreshIfActive(input.clock.nowMs());
      await service.tick();
      // Research acquisition cannot delay the authoritative paper pass.
      // Fetch the completed hour before the point-in-time frame timestamps the slot.
      void (async () => { await input.breakout?.refresh(); await input.widerUniverse?.refresh();
        await input.breakout?.refresh();
        await input.rangeRotation?.refresh(); await input.marketSelector?.refresh(); })()
        .catch((error: unknown) => input.onUnexpectedError('paper_research_refresh', error));
    },
    async refreshIfActive(nowMs: number): Promise<void> {
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
        try { await market.refresh(nowMs); } finally { record('market_refresh_finished'); }

        // Historical backfill and training never hold up the daily paper order window.
        void input.mlSignal?.refresh(nowMs);
      }
    },
  };
}
